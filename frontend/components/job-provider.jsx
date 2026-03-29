"use client";

import { createContext, useContext, useState, useRef, useCallback, useEffect } from "react";
import { getAuthHeaders } from "@/lib/api-auth";

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const API_BASE = rawApiUrl.endsWith("/api") ? rawApiUrl : `${rawApiUrl.replace(/\/$/, "")}/api`;

const POLL_INTERVAL = 5000;
const MAX_POLL_RETRIES = 12;

const JobContext = createContext(null);

export function useJobs() {
  const ctx = useContext(JobContext);
  if (!ctx) throw new Error("useJobs must be used within <JobProvider>");
  return ctx;
}

export function JobProvider({ children }) {
  const [jobs, setJobs] = useState([]);
  const jobsRef = useRef(jobs);
  
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
          return;
        }

        // Transient errors (401 DNS fail, 502/503 Gunicorn restart, etc.) → retry
        if (!response.ok) {
          failCounts.current[localId] = (failCounts.current[localId] || 0) + 1;
          console.warn(`Poll ${backendJobId}: HTTP ${response.status}, attempt ${failCounts.current[localId]}/${MAX_POLL_RETRIES}`);
          if (failCounts.current[localId] >= MAX_POLL_RETRIES) {
            updateJob(localId, { status: "error", error: "Server stopped responding." });
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
          updateJob(localId, patch);
        } else if (data.status === "error") {
          patch.status = "error";
          patch.error = data.message;
          updateJob(localId, patch);
        } else if (data.status === "cancelled") {
          patch.status = "cancelled";
          updateJob(localId, patch);
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
      updateJob(localId, { jobId: data.job_id, status: "processing" });
      startPolling(localId, data.job_id);
    } catch (err) {
      if (err.name === "AbortError") return;
      updateJob(localId, { status: "error", error: err.message || "Failed to start conversion." });
    }
  }, [updateJob, startPolling]);

  // ─── cancel a job ───
  const cancelJob = useCallback(async (localId) => {
    const targetJob = jobsRef.current.find(j => j.id === localId);
    if (!targetJob) return;

    // Clean up polling immediately
    if (pollTimers.current[localId]) {
      clearTimeout(pollTimers.current[localId]);
      delete pollTimers.current[localId];
    }

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

  return (
    <JobContext.Provider value={{ jobs, activeJobs, addJobs, startJob, cancelJob, removeJob, updateJob }}>
      {children}
    </JobContext.Provider>
  );
}
