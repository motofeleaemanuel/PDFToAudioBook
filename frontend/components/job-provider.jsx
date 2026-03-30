"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { getAuthHeaders } from "@/lib/api-auth";

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const API_BASE = rawApiUrl.endsWith("/api") ? rawApiUrl : `${rawApiUrl.replace(/\/$/, "")}/api`;

const POLL_INTERVAL = 5000;
const MAX_POLL_RETRIES = 12;
const STORAGE_KEY = "pdfaudio_active_jobs";

const JobContext = createContext(null);

export function useJobs() {
  const ctx = useContext(JobContext);
  if (!ctx) throw new Error("useJobs must be used within <JobProvider>");
  return ctx;
}

// ─── localStorage helpers ───
function saveActiveJobs(jobs) {
  try {
    const active = jobs
      .filter(j => j.jobId && !["completed", "error", "cancelled"].includes(j.status))
      .map(j => ({ id: j.id, jobId: j.jobId, filename: j.file?.name || j.filename || "Unknown" }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  } catch {}
}

function loadActiveJobs() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function clearStoredJob(localId) {
  try {
    const stored = loadActiveJobs();
    const filtered = stored.filter(j => j.id !== localId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {}
}

export function JobProvider({ children }) {
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef(jobs);
  const hasRestoredRef = useRef(false);
  
  // Keep jobsRef in sync with jobs state
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  
  const pollTimers = useRef({});   // { [localId]: timeoutId }
  const failCounts = useRef({});   // { [localId]: number }
  const abortCtrls = useRef({});   // { [localId]: AbortController }

  // ─── helpers to update a single job by its local id ───
  const updateJob = useCallback((localId, patch) => {
    setJobs(prev => prev.map(j => j.id === localId ? { ...j, ...patch } : j));
  }, []);

  // ─── add files (just creates pending entries) ───
  const addJobs = useCallback((files) => {
    if (!files || files.length === 0) return;
    const newJobs = Array.from(files)
      .filter(f => f.name.toLowerCase().endsWith(".pdf"))
      .map(f => ({
        id: Math.random().toString(36).substr(2, 9),
        file: f,
        jobId: null,       // backend job_id (set after upload)
        status: "pending",
        progress: 0,
        message: "",
        error: null,
        details: null,     // jobDetails from polling
      }));
    if (newJobs.length > 0) {
      setJobs(prev => [...newJobs, ...prev]);
    }
  }, []);

  // ─── polling loop (runs globally, survives navigation) ───
  const startPolling = useCallback((localId, backendJobId) => {
    if (pollTimers.current[localId]) clearTimeout(pollTimers.current[localId]);
    failCounts.current[localId] = 0;

    const poll = async () => {
      try {
        const response = await fetch(`${API_BASE}/status/${backendJobId}`, {
          headers: await getAuthHeaders(),
        });

        // True 404 = job genuinely doesn't exist in backend → fatal
        if (response.status === 404) {
          updateJob(localId, { status: "error", error: "Job not found on server." });
          clearStoredJob(localId);
          return;
        }

        // Transient errors (401 DNS fail, 502/503 Gunicorn restart, etc.) → retry
        if (!response.ok) {
          failCounts.current[localId] = (failCounts.current[localId] || 0) + 1;
          console.warn(`Poll ${backendJobId}: HTTP ${response.status}, attempt ${failCounts.current[localId]}/${MAX_POLL_RETRIES}`);
          if (failCounts.current[localId] >= MAX_POLL_RETRIES) {
            updateJob(localId, { status: "error", error: "Server stopped responding." });
            clearStoredJob(localId);
            return;
          }
          // Exponential backoff: 5s, 10s, 15s...
          const backoff = POLL_INTERVAL * (1 + failCounts.current[localId] * 0.5);
          pollTimers.current[localId] = setTimeout(poll, backoff);
          return;
        }

        failCounts.current[localId] = 0;
        const data = await response.json();

        const patch = {
          progress: data.progress || 0,
          message: data.message || "",
          details: data,
        };

        if (data.status === "completed") {
          patch.status = "completed";
          patch.completedAt = Date.now();
          updateJob(localId, patch);
          clearStoredJob(localId);
        } else if (data.status === "error") {
          patch.status = "error";
          patch.error = data.message;
          patch.completedAt = Date.now();
          updateJob(localId, patch);
          clearStoredJob(localId);
        } else if (data.status === "cancelled") {
          patch.status = "cancelled";
          patch.completedAt = Date.now();
          updateJob(localId, patch);
          clearStoredJob(localId);
        } else {
          patch.status = "processing";
          updateJob(localId, patch);
          pollTimers.current[localId] = setTimeout(poll, POLL_INTERVAL);
        }
      } catch (err) {
        failCounts.current[localId] = (failCounts.current[localId] || 0) + 1;
        console.warn(`Poll ${backendJobId}: network error, attempt ${failCounts.current[localId]}/${MAX_POLL_RETRIES}`);
        if (failCounts.current[localId] >= MAX_POLL_RETRIES) {
          updateJob(localId, { status: "error", error: "Network connection lost." });
          clearStoredJob(localId);
          return;
        }
        const backoff = POLL_INTERVAL * (1 + failCounts.current[localId] * 0.5);
        pollTimers.current[localId] = setTimeout(poll, backoff);
      }
    };
    poll();
  }, [updateJob]);

  // ─── start conversion (upload + begin polling) ───
  const startJob = useCallback(async (localId) => {
    // securely get the current job state using the ref
    const targetJob = jobsRef.current.find(j => j.id === localId);
    if (!targetJob) return;

    updateJob(localId, { status: "uploading", progress: 0, message: "Uploading document...", error: null });

    const ctrl = new AbortController();
    abortCtrls.current[localId] = ctrl;

    try {
      const formData = new FormData();
      formData.append("file", targetJob.file);
      formData.append("original_filename", targetJob.file.name);

      const headers = await getAuthHeaders();
      delete headers["Content-Type"];

      const response = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        headers,
        body: formData,
        signal: ctrl.signal,
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Upload failed");
      }

      const data = await response.json();
      updateJob(localId, { jobId: data.job_id, status: "processing", filename: targetJob.file.name });

      // Persist to localStorage so we can resume after refresh
      setJobs(prev => {
        const updated = prev.map(j => j.id === localId ? { ...j, jobId: data.job_id, status: "processing", filename: targetJob.file.name } : j);
        saveActiveJobs(updated);
        return updated;
      });

      startPolling(localId, data.job_id);
    } catch (err) {
      if (err.name === "AbortError") return;
      updateJob(localId, { status: "error", error: err.message || "Failed to start conversion." });
    }
  }, [updateJob, startPolling]);

  // ─── restore jobs from localStorage on mount ───
  useEffect(() => {
    if (hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    const stored = loadActiveJobs();
    if (stored.length === 0) return;

    console.log(`[JobProvider] Restoring ${stored.length} active job(s) from localStorage`);
    const restoredJobs = stored.map(s => ({
      id: s.id,
      file: null,
      jobId: s.jobId,
      filename: s.filename,
      status: "processing",
      progress: 0,
      message: "Reconnecting...",
      error: null,
      details: null,
    }));

    setJobs(prev => [...restoredJobs, ...prev]);

    // Resume polling for each restored job
    for (const s of stored) {
      startPolling(s.id, s.jobId);
    }
  }, [startPolling]);

  // ─── cancel a job ───
  const cancelJob = useCallback(async (localId) => {
    const targetJob = jobsRef.current.find(j => j.id === localId);
    if (!targetJob) return;

    // Clean up polling immediately
    if (pollTimers.current[localId]) {
      clearTimeout(pollTimers.current[localId]);
      delete pollTimers.current[localId];
    }
    clearStoredJob(localId);

    try {
      if (targetJob.jobId) {
        await fetch(`${API_BASE}/jobs/${targetJob.jobId}`, {
          method: "DELETE",
          headers: await getAuthHeaders(),
        });
      } else if (abortCtrls.current[localId]) {
        abortCtrls.current[localId].abort();
      }
    } catch (e) {
      console.error("Cancel error:", e);
    }
  }, []);

  // ─── remove a job from the list ───
  const removeJob = useCallback((localId) => {
    // Also cancel polling if it's still running
    if (pollTimers.current[localId]) {
      clearTimeout(pollTimers.current[localId]);
      delete pollTimers.current[localId];
    }
    clearStoredJob(localId);
    // fire-and-forget backend delete for non-terminal jobs
    setJobs(prev => {
      const job = prev.find(j => j.id === localId);
      if (job?.jobId && !["completed", "error", "cancelled"].includes(job.status)) {
        getAuthHeaders().then(headers =>
          fetch(`${API_BASE}/jobs/${job.jobId}`, { method: "DELETE", headers }).catch(() => {})
        );
      }
      return prev.filter(j => j.id !== localId);
    });
  }, []);

  // ─── computed helpers ───
  const activeJobs = jobs.filter(j => j.status === "uploading" || j.status === "processing");
  
  // Jobs visible in sidebar: active + recently finished (completed/error within last 15s)
  const SIDEBAR_LINGER_MS = 15000;
  const sidebarJobs = jobs.filter(j => {
    if (j.status === "uploading" || j.status === "processing") return true;
    if (["completed", "error", "cancelled"].includes(j.status) && j.completedAt) {
      return Date.now() - j.completedAt < SIDEBAR_LINGER_MS;
    }
    return false;
  });

  // Auto-refresh to dismiss lingering sidebar entries
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const hasLingering = jobs.some(j => 
      ["completed", "error", "cancelled"].includes(j.status) && j.completedAt && Date.now() - j.completedAt < SIDEBAR_LINGER_MS
    );
    if (!hasLingering) return;
    const timer = setTimeout(() => forceUpdate(n => n + 1), SIDEBAR_LINGER_MS);
    return () => clearTimeout(timer);
  }, [jobs]);

  return (
    <JobContext.Provider value={{ jobs, activeJobs, sidebarJobs, addJobs, startJob, cancelJob, removeJob, updateJob }}>
      {children}
    </JobContext.Provider>
  );
}
