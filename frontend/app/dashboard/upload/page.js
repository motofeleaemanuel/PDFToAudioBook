"use client";

import { useState, useRef, useCallback } from "react";
import Link from "next/link";
import { UploadCloud, FileText, CheckCircle2, AlertCircle, Loader2, Download, Trash2, InfoIcon, Play, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getAuthHeaders } from "@/lib/api-auth";
import { useJobs } from "@/components/job-provider";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const API_BASE = rawApiUrl.endsWith("/api") ? rawApiUrl : `${rawApiUrl.replace(/\/$/, "")}/api`;

async function fetchUserCredits() {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return 1; // Fallback for legacy
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits_hours")
      .eq("id", user.id)
      .single();
    if (profile) return parseFloat(profile.credits_hours || 0);
  } catch (err) {
    console.error("Failed to fetch credits", err);
  }
  return 1;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function ConversionJobCard({ job, onStart, onCancel, onRemove, hasCredits = true }) {
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const { status, progress, message, error, details: jobDetails, jobId } = job;

  const downloadAudiobook = () => {

    // Use the Supabase cloud URL directly (fast CDN) instead of proxying through the Pi
    const cloudUrl = jobDetails?.cloud_url;
    if (cloudUrl) {
      window.open(cloudUrl, "_blank");
      return;
    }
    // Fallback: proxy through backend (slow, but works if cloud_url is missing)
    if (jobId) {
      window.open(`${API_BASE}/download/${jobId}`, "_blank");
    }
  };

  const attemptRemove = () => {
    if (status === "uploading" || status === "processing") {
      setShowCancelDialog(true);
    } else {
      onRemove(job.id);
    }
  };

  const confirmForceStop = async () => {
    setIsCancelling(true);
    try {
      await onCancel(job.id);
    } catch (e) {
      console.error(e);
    } finally {
      setIsCancelling(false);
      setShowCancelDialog(false);
      setTimeout(() => onRemove(job.id), 150);
    }
  };

  return (
    <>
      <div className="mt-4 overflow-hidden relative transition-all duration-300 backdrop-blur-xl shadow-2xl rounded-2xl border border-white/10 bg-white/5 hover:border-white/20 p-4">
        
        {/* Dynamic Highlight Glow based on status */}
        <div className={`absolute -inset-1 opacity-20 blur-xl transition-all duration-700
          ${status === 'processing' || status === 'uploading' ? 'bg-primary' : 
            status === 'completed' ? 'bg-green-500' : 
            status === 'error' ? 'bg-red-500' : 'bg-transparent'}`} 
        />

        <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          
          {/* LEFT: File Info */}
          <div className="flex items-center gap-4 min-w-0 pr-4">
            <div className={`p-3 rounded-xl border flex-shrink-0 flex items-center justify-center transition-colors
              ${status === 'completed' ? 'bg-green-500/10 border-green-500/20 shadow-[0_0_15px_rgba(34,197,94,0.2)]' : 
                status === 'error' ? 'bg-red-500/10 border-red-500/20' : 
                'bg-gradient-to-br from-primary/20 to-indigo-500/10 border-primary/20 shadow-inner'}`}
            >
              {status === 'completed' ? (
                <CheckCircle2 className="h-6 w-6 text-green-400" />
              ) : status === 'error' ? (
                <AlertCircle className="h-6 w-6 text-red-500" />
              ) : (
                <FileText className="h-6 w-6 text-primary" />
              )}
            </div>
            
            <div className="flex flex-col min-w-0">
              <span className="text-base font-bold tracking-tight text-white truncate">
                {job.file?.name || job.filename || "Unknown file"}
              </span>
              <div className="flex items-center gap-2 mt-0.5">
                {job.file?.size && (
                  <span className="text-xs font-medium text-white/50 bg-white/10 px-2 py-0.5 rounded-full">
                    {formatFileSize(job.file.size)}
                  </span>
                )}
                {status === "pending" && <span className="text-xs text-yellow-500/80 font-medium">Ready</span>}
                {status === "completed" && <span className="text-xs text-green-400 font-medium">Done</span>}
                {status === "error" && <span className="text-xs text-red-400 font-medium truncate max-w-[200px]">{error}</span>}
              </div>
            </div>
          </div>

          {/* MIDDLE: Progress Bar (Only visible when processing) */}
          {(status === "uploading" || status === "processing") && (
            <div className="flex-1 w-full sm:mx-4 max-w-md">
              <div className="flex justify-between items-end mb-1.5">
                <span className="text-xs font-medium text-white/80 flex items-center gap-2 truncate pr-4">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  {message}
                </span>
                <span className="text-xs font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-indigo-400">
                  {progress}%
                </span>
              </div>
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/40 border border-white/5">
                <div 
                  className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary via-indigo-500 to-primary bg-[length:200%_100%] animate-[shimmer_2s_linear_infinite] transition-all duration-300 ease-out shadow-[0_0_10px_rgba(139,92,246,0.5)]"
                  style={{ width: `${Math.min(100, Math.max(0, progress || 0))}%` }}
                />
              </div>
              {jobDetails && (
                <div className="flex gap-3 text-[10px] font-medium text-white/40 mt-1.5">
                  {jobDetails.total_pages > 0 && <span>📄 {jobDetails.total_pages} pg</span>}
                  {jobDetails.total_chunks > 0 && <span>🧩 {jobDetails.current_chunk}/{jobDetails.total_chunks}</span>}
                  {jobDetails.estimated_duration > 0 && <span>⏱️ ~{jobDetails.estimated_duration}m</span>}
                </div>
              )}
            </div>
          )}

          {/* RIGHT: Actions */}
          <div className="flex items-center gap-2 self-end sm:self-center w-full sm:w-auto justify-end mt-2 sm:mt-0">
            {status === "pending" && (
              <Button 
                onClick={() => onStart(job.id)} 
                size="sm"
                disabled={!hasCredits}
                className="bg-gradient-to-r from-primary to-indigo-600 hover:from-primary/90 hover:to-indigo-500 text-white shadow-lg shadow-primary/25 transition-all text-xs h-9 px-4 disabled:from-gray-500 disabled:to-gray-600 disabled:shadow-none"
              >
                <Play className="mr-1.5 h-3.5 w-3.5 fill-white" /> {hasCredits ? "Convert" : "No Credits"}
              </Button>
            )}

            {(status === "uploading" || status === "processing") && (
              <Button 
                variant="outline"
                size="sm"
                className="border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors h-9 px-3"
                onClick={attemptRemove}
              >
                Cancel
              </Button>
            )}

            {status === "completed" && (jobDetails?.cloud_urls?.length > 1 ? (
              <Button 
                asChild
                size="sm"
                className="bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/50 transition-colors h-9 px-4"
              >
                <Link href="/dashboard/audiobooks">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  View All Parts
                </Link>
              </Button>
            ) : (
              <Button 
                onClick={downloadAudiobook} 
                size="sm"
                className="bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/50 transition-colors h-9 px-4"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download
              </Button>
            ))}

            {/* Trash Button for all states except processing */}
            {status !== "uploading" && status !== "processing" && (
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-9 w-9 rounded-full bg-white/5 hover:bg-red-500/20 hover:text-red-400 text-white/50 transition-all ml-1"
                onClick={attemptRemove}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>

        </div>
      </div>

      {/* Cancel Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent className="glass-card border-white/10 max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">Stop Generation?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/70">
              Are you sure you want to stop generating this audiobook? You will not be fully refunded; any credits already spent on processing the current sections will still be permanently deducted from your account. 
              <br/><br/>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="mt-4">
            <AlertDialogCancel disabled={isCancelling} className="bg-white/5 border-white/10 hover:bg-white/10">Resume</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => { e.preventDefault(); confirmForceStop(); }} 
              disabled={isCancelling}
              className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              {isCancelling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Force Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function UploadPage() {
  const { jobs, addJobs, startJob, cancelJob, removeJob } = useJobs();
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const { data: credits = 1, isLoading } = useQuery({
    queryKey: ["userCredits"],
    queryFn: fetchUserCredits,
  });
  
  const hasCredits = credits > 0 || isLoading;

  const handleFileSelect = useCallback((files) => {
    addJobs(files);
  }, [addJobs]);

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto w-full">
      <div className="mb-4">
        <h1 className="text-3xl font-bold tracking-tight mb-2">Convert to Audiobook</h1>
        <p className="text-muted-foreground">Upload standard or scanned PDFs to generate high-quality MP3 audiobooks.</p>
      </div>

      <Alert className="mb-8 border-white/10 bg-white/5 text-white/80">
        <InfoIcon className="h-4 w-4 text-blue-400" />
        <AlertTitle className="text-blue-200">Billing Notice</AlertTitle>
        <AlertDescription className="text-sm">
          Server errors will <span className="text-white font-semibold">not consume</span> your credits. However, manually cancelling an active generation will instantly consume credits proportional to the parts already processed by our AI.
        </AlertDescription>
      </Alert>

      {!hasCredits && (
        <Alert variant="destructive" className="mb-8 border-red-500/50 bg-red-500/10 text-red-200">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Insufficient Credits</AlertTitle>
          <AlertDescription>
            Your current credit balance is roughly 0.0 hours. You must add more credits to your account via the Billing page before generating new audiobooks.
          </AlertDescription>
        </Alert>
      )}

      <div
        className={`
          relative overflow-hidden border-2 border-dashed rounded-xl p-10 text-center transition-all duration-200 ease-in-out
          ${dragOver ? "border-primary bg-primary/5 scale-[1.01]" : "border-border hover:border-primary/50 hover:bg-muted/50"}
          ${!hasCredits ? "opacity-50 cursor-not-allowed pointer-events-none" : "cursor-pointer"}
        `}
        onDragOver={(e) => { e.preventDefault(); if (hasCredits) setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (hasCredits) handleFileSelect(e.dataTransfer.files); }}
        onClick={() => { if (hasCredits) fileInputRef.current?.click(); }}
      >
        <input 
          type="file" 
          ref={fileInputRef} 
          accept=".pdf" 
          multiple 
          className="hidden" 
          onChange={(e) => {
            handleFileSelect(e.target.files);
            e.target.value = null;
          }} 
        />
        
        <div className="mx-auto w-16 h-16 mb-4 rounded-full bg-primary/10 flex items-center justify-center">
          <UploadCloud className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-lg font-semibold mb-1">Click or drag PDFs here</h3>
        <p className="text-sm text-muted-foreground mx-auto max-w-sm">
          You can queue multiple files. We process the text using standard extraction, falling back to Vision AI for scanned images.
        </p>
      </div>

      <div className="mt-8 space-y-4">
        {jobs.map((job) => (
          <ConversionJobCard 
            key={job.id} 
            job={job} 
            onStart={startJob}
            onCancel={cancelJob}
            onRemove={removeJob}
            hasCredits={hasCredits}
          />
        ))}
      </div>
    </div>
  );
}
