"use client";

import { useState, useRef, useCallback, useEffect } from "react";

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const API_BASE = rawApiUrl.endsWith("/api") ? rawApiUrl : `${rawApiUrl.replace(/\/$/, "")}/api`;

export default function Home() {
  // ── Auth state ──────────────────────────────────
  const [isInitializing, setIsInitializing] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessCode, setAccessCode] = useState("");
  const [authError, setAuthError] = useState(null);
  const [authLoading, setAuthLoading] = useState(false);

  // ── App state ───────────────────────────────────
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [jobId, setJobId] = useState(null);
  const [status, setStatus] = useState(null);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [jobDetails, setJobDetails] = useState(null);
  const [error, setError] = useState(null);

  // ── History state ──────────────────────────────────
  const [audiobooks, setAudiobooks] = useState([]);
  const [storageUsage, setStorageUsage] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const fileInputRef = useRef(null);
  const pollingRef = useRef(null);
  const storedCodeRef = useRef("");

  // ── Check stored auth on mount ──────────────────
  useEffect(() => {
    const stored = localStorage.getItem("audiobook_access_code");
    if (stored) {
      storedCodeRef.current = stored;
      setIsAuthenticated(true);
    }
    setIsInitializing(false);
  }, []);

  // ── Fetch audiobook history when authenticated ──
  const fetchAudiobooks = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const response = await fetch(`${API_BASE}/audiobooks`, {
        headers: { Authorization: `Bearer ${storedCodeRef.current}` },
      });
      if (response.ok) {
        const data = await response.json();
        // data looks like { audiobooks: [...], storage: { used_bytes: ..., percentage: ... } }
        if (data.audiobooks) {
          setAudiobooks(data.audiobooks);
          setStorageUsage(data.storage);
        } else {
          // Fallback if old backend response
          setAudiobooks(Array.isArray(data) ? data : []);
        }
      }
    } catch {
      // Silently fail — history is optional
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) fetchAudiobooks();
  }, [isAuthenticated, fetchAudiobooks]);

  // ── Auth headers helper ─────────────────────────
  const getAuthHeaders = useCallback(() => {
    return { Authorization: `Bearer ${storedCodeRef.current}` };
  }, []);

  // ── Login ───────────────────────────────────────
  const handleLogin = useCallback(
    async (e) => {
      e.preventDefault();
      setAuthLoading(true);
      setAuthError(null);

      try {
        const response = await fetch(`${API_BASE}/verify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code: accessCode }),
        });

        const data = await response.json();
        if (data.valid) {
          storedCodeRef.current = accessCode;
          localStorage.setItem("audiobook_access_code", accessCode);
          setIsAuthenticated(true);
        } else {
          setAuthError(data.error || "Cod de acces invalid.");
        }
      } catch {
        setAuthError(
          "Nu am putut contacta serverul. Verifică conexiunea."
        );
      } finally {
        setAuthLoading(false);
      }
    },
    [accessCode]
  );

  const handleLogout = useCallback(() => {
    localStorage.removeItem("audiobook_access_code");
    storedCodeRef.current = "";
    setIsAuthenticated(false);
    setAccessCode("");
    resetAll();
  }, []);

  // ── File handling ────────────────────────────────
  const handleFileSelect = useCallback((selectedFile) => {
    if (!selectedFile) return;
    if (!selectedFile.name.toLowerCase().endsWith(".pdf")) {
      setError("Doar fișiere PDF sunt acceptate.");
      return;
    }
    setFile(selectedFile);
    setError(null);
    setStatus(null);
    setJobId(null);
    setJobDetails(null);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setDragOver(false);
      const droppedFile = e.dataTransfer.files[0];
      handleFileSelect(droppedFile);
    },
    [handleFileSelect]
  );

  const handleInputChange = useCallback(
    (e) => {
      handleFileSelect(e.target.files[0]);
    },
    [handleFileSelect]
  );

  const removeFile = useCallback(() => {
    setFile(null);
    setError(null);
    setStatus(null);
    setJobId(null);
    setJobDetails(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Upload & Conversion ──────────────────────────
  const startConversion = useCallback(async () => {
    if (!file) return;

    setStatus("uploading");
    setProgress(0);
    setMessage("Se încarcă fișierul...");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(`${API_BASE}/upload`, {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });

      if (response.status === 401) {
        localStorage.removeItem("audiobook_access_code");
        setIsAuthenticated(false);
        setStatus(null);
        return;
      }

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Eroare la încărcare.");
      }

      const data = await response.json();
      setJobId(data.job_id);
      setStatus("processing");
      startPolling(data.job_id);
    } catch (err) {
      setStatus("error");
      setError(
        err.message ||
          "Nu am putut contacta serverul. Asigură-te că backend-ul rulează."
      );
    }
  }, [file, getAuthHeaders]);

  const startPolling = useCallback(
    (id) => {
      if (pollingRef.current) clearInterval(pollingRef.current);

      pollingRef.current = setInterval(async () => {
        try {
          const response = await fetch(`${API_BASE}/status/${id}`, {
            headers: getAuthHeaders(),
          });

          if (response.status === 404) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
            setStatus("error");
            setError(
              "Serverul a fost repornit și job-ul s-a pierdut. Te rog încearcă din nou."
            );
            return;
          }

          if (response.status === 401) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
            localStorage.removeItem("audiobook_access_code");
            setIsAuthenticated(false);
            return;
          }

          if (!response.ok)
            throw new Error("Eroare la verificarea stării.");

          const data = await response.json();
          setProgress(data.progress);
          setMessage(data.message);
          setJobDetails(data);

          if (data.status === "completed") {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
            setStatus("completed");
            fetchAudiobooks(); // Refresh history immediately
          } else if (data.status === "error") {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
            setStatus("error");
            setError(data.message);
          }
        } catch (err) {
          console.error("Polling error:", err);
        }
      }, 1500);
    },
    [getAuthHeaders, fetchAudiobooks]
  );

  const downloadAudiobook = useCallback(async () => {
    if (!jobId) return;
    // If we have a cloud URL (Supabase), use that directly
    const cloudUrl = jobDetails?.cloud_url;
    if (cloudUrl) {
      window.open(cloudUrl, "_blank");
      return;
    }
    // Fallback: download from backend
    try {
      const response = await fetch(`${API_BASE}/download/${jobId}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = jobDetails?.output_filename || "audiobook.mp3";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError("Eroare la descărcare. Încearcă din nou.");
    }
  }, [jobId, jobDetails, getAuthHeaders]);

  const deleteAudiobook = useCallback(
    async (id) => {
      try {
        const response = await fetch(`${API_BASE}/audiobooks/${id}`, {
          method: "DELETE",
          headers: getAuthHeaders(),
        });
        if (response.ok) {
          setAudiobooks((prev) => prev.filter((a) => a.id !== id));
          // Refresh storage state after delete
          fetchAudiobooks();
        }
      } catch {
        // Silently fail
      }
    },
    [getAuthHeaders, fetchAudiobooks]
  );

  const resetAll = useCallback(() => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    setFile(null);
    setJobId(null);
    setStatus(null);
    setProgress(0);
    setMessage("");
    setJobDetails(null);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // ── Helpers ──────────────────────────────────────
  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const isProcessing = status === "uploading" || status === "processing";

  // ── Render ──────────────────────────────────────
  if (isInitializing) {
    return (
      <main className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div className="loader loop" style={{ width: '48px', height: '48px', borderWidth: '4px', borderTopColor: 'var(--accent-primary)' }}></div>
      </main>
    );
  }

  // ── LOGIN SCREEN ─────────────────────────────────
  if (!isAuthenticated) {
    return (
      <main className="app-container">
        <header className="header">
          <span className="header-icon">🎧</span>
          <h1>PDF to Audiobook</h1>
          <p>Transformă orice PDF într-un audiobook în limba română</p>
        </header>

        <div className="glass-card">
          <div className="login-section">
            <span className="login-icon">🔒</span>
            <h2 className="login-title">Acces restricționat</h2>
            <p className="login-subtitle">
              Introdu codul de acces pentru a folosi aplicația
            </p>

            <form onSubmit={handleLogin} className="login-form">
              <input
                type="password"
                className="login-input"
                placeholder="Cod de acces..."
                value={accessCode}
                onChange={(e) => {
                  setAccessCode(e.target.value);
                  setAuthError(null);
                }}
                autoFocus
                id="access-code-input"
              />
              <button
                type="submit"
                className="convert-btn"
                disabled={!accessCode.trim() || authLoading}
                id="login-btn"
              >
                {authLoading ? "Se verifică..." : "🔓 Intră"}
              </button>
            </form>

            {authError && (
              <div className="error-section">
                <p className="error-message">
                  <span className="error-icon">⚠️</span>
                  <span>{authError}</span>
                </p>
              </div>
            )}
          </div>
        </div>

        <footer className="footer">
          <p>
            Powered by PyMuPDF & OpenAI •{" "}
            Limba română 🇷🇴
          </p>
        </footer>
      </main>
    );
  }

  return (
    <main className="app-container">
      {/* Header */}
      <header className="header">
        <span className="header-icon">🎧</span>
        <h1>PDF to Audiobook</h1>
        <p>Transformă orice PDF într-un audiobook în limba română</p>
        <button
          className="logout-btn"
          onClick={handleLogout}
          title="Deconectare"
          id="logout-btn"
        >
          🔓 Deconectare
        </button>
      </header>

      {/* Main Card */}
      <div className="glass-card">
        {/* Drop Zone (hidden during/after processing) */}
        {!isProcessing && status !== "completed" && (
          <>
            <div
              className={`drop-zone ${dragOver ? "drag-over" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              id="drop-zone"
            >
              <span className="drop-zone-icon">📄</span>
              <h3>Trage fișierul PDF aici</h3>
              <p>sau click pentru a selecta un fișier</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleInputChange}
                id="file-input"
              />
            </div>

            {/* Selected file info */}
            {file && (
              <div className="selected-file">
                <span className="selected-file-icon">📕</span>
                <div className="selected-file-info">
                  <div className="selected-file-name">{file.name}</div>
                  <div className="selected-file-size">
                    {formatFileSize(file.size)}
                  </div>
                </div>
                <button
                  className="remove-file-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile();
                  }}
                  title="Elimină fișierul"
                  id="remove-file-btn"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Convert button */}
            <button
              className="convert-btn"
              disabled={!file}
              onClick={startConversion}
              id="convert-btn"
            >
              <span>🎙️</span>
              Convertește în Audiobook
            </button>
          </>
        )}

        {/* Progress Section */}
        {isProcessing && (
          <div className="progress-section">
            <div className="progress-header">
              <span className="progress-status">{message}</span>
              <span className="progress-percent">{progress}%</span>
            </div>

            <div className="progress-bar-track">
              <div
                className="progress-bar-fill"
                style={{ width: `${progress}%` }}
              />
            </div>

            {jobDetails && (
              <div className="progress-details">
                {jobDetails.total_pages > 0 && (
                  <span className="progress-detail">
                    <span className="progress-detail-icon">📄</span>
                    {jobDetails.total_pages} pagini
                  </span>
                )}
                {jobDetails.total_chunks > 0 && (
                  <span className="progress-detail">
                    <span className="progress-detail-icon">🧩</span>
                    {jobDetails.current_chunk}/{jobDetails.total_chunks}{" "}
                    secțiuni
                  </span>
                )}
                {jobDetails.estimated_duration > 0 && (
                  <span className="progress-detail">
                    <span className="progress-detail-icon">⏱️</span>~
                    {jobDetails.estimated_duration} min durată estimată
                  </span>
                )}
              </div>
            )}

            {/* Audio waveform animation */}
            <div className="audio-wave">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="audio-wave-bar" />
              ))}
            </div>
          </div>
        )}

        {/* Success Section */}
        {status === "completed" && (
          <div className="success-section">
            <span className="success-icon">🎉</span>
            <h2 className="success-title">Audiobook-ul este gata!</h2>
            <p className="success-subtitle">
              {jobDetails?.output_filename || "audiobook.mp3"}
              {jobDetails?.estimated_duration > 0 &&
                ` • ~${jobDetails.estimated_duration} minute`}
            </p>

            <button
              className="download-btn"
              onClick={downloadAudiobook}
              id="download-btn"
            >
              <span>⬇️</span>
              Descarcă MP3
            </button>

            <br />

            <button
              className="new-conversion-btn"
              onClick={resetAll}
              id="new-conversion-btn"
            >
              <span>🔄</span>
              Conversie nouă
            </button>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="error-section">
            <p className="error-message">
              <span className="error-icon">⚠️</span>
              <span>{error}</span>
            </p>
          </div>
        )}
      </div>

      {/* Audiobook History */}
      <div className="glass-card history-card">
        <h2 className="history-title">📚 Audiobook-uri anterioare</h2>

          {/* Storage usage bar */}
          {storageUsage && (
            <div className="storage-section">
              <div className="storage-header">
                <span className="storage-label">Spațiu în cloud</span>
                <span className="storage-stats">
                  {formatFileSize(storageUsage.used_bytes)} / 1 GB (
                  {storageUsage.percentage}%)
                </span>
              </div>
              <div className="progress-bar-track storage-track">
                <div
                  className={`progress-bar-fill storage-fill ${
                    storageUsage.percentage > 90 ? "storage-critical" : ""
                  }`}
                  style={{ width: `${Math.min(100, storageUsage.percentage)}%` }}
                />
              </div>
            </div>
          )}

          {loadingHistory ? (
            <div className="history-empty" style={{ border: 'none' }}>
              <div className="loader loop" style={{ width: '32px', height: '32px', marginBottom: '16px', borderTopColor: 'var(--accent-primary)' }}></div>
              <p>Se încarcă istoricul...</p>
            </div>
          ) : audiobooks.length > 0 ? (
            <div className="history-list">
              {audiobooks.map((ab) => (
                <div key={ab.id} className="history-item">
                  <div className="history-item-info">
                    <span className="history-item-icon">🎧</span>
                    <div>
                      <div className="history-item-name">
                        {ab.original_name}
                      </div>
                      <div className="history-item-meta">
                        {ab.total_pages > 0 && `${ab.total_pages} pag • `}
                        {ab.duration_minutes > 0 &&
                          `~${ab.duration_minutes} min • `}
                        {ab.size_bytes > 0 &&
                          `${(ab.size_bytes / (1024 * 1024)).toFixed(1)} MB • `}
                        {ab.created_at &&
                          new Date(ab.created_at).toLocaleDateString("ro-RO", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                      </div>
                    </div>
                  </div>
                  <div className="history-item-actions">
                    <a
                      href={ab.public_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="history-download-btn"
                      title="Descarcă"
                    >
                      ⬇️
                    </a>
                    <button
                      className="history-delete-btn"
                      onClick={() => deleteAudiobook(ab.id)}
                      title="Șterge"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="history-empty">
              <span className="history-empty-icon">📭</span>
              <p>Nu ai salvat niciun audiobook încă.</p>
              <p className="history-empty-sub">Încarcă un PDF mai sus pentru a începe.</p>
            </div>
          )}
        </div>

      <footer className="footer">
        <p>
          Powered by PyMuPDF & OpenAI •{" "}
          Limba română 🇷🇴
        </p>
      </footer>
    </main>
  );
}
