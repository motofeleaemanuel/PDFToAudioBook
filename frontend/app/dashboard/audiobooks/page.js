"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Headphones, Download, Trash2, Calendar, FileAudio, Play, ChevronLeft, ChevronRight, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from "@/components/ui/dialog";
import { getAuthHeaders } from "@/lib/api-auth";

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
const API_BASE = rawApiUrl.endsWith("/api") ? rawApiUrl : `${rawApiUrl.replace(/\/$/, "")}/api`;

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  return parseFloat((bytes / (1024 * 1024 * 1024)).toFixed(2)) + " GB";
}

async function fetchLibraryData() {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_BASE}/audiobooks`, { headers });
  if (!response.ok) throw new Error("Failed to fetch library");
  return response.json();
}

export default function AudiobooksLibraryPage() {
  const queryClient = useQueryClient();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(5);
  const [downloadingId, setDownloadingId] = useState(null);
  const [pendingDeleteBook, setPendingDeleteBook] = useState(null);

  const { data: libraryData, isLoading: loading } = useQuery({
    queryKey: ["audiobooksLibrary"],
    queryFn: fetchLibraryData,
  });

  const audiobooks = libraryData?.audiobooks || [];
  const storageUsage = libraryData?.storage || null;

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`${API_BASE}/audiobooks/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!response.ok) throw new Error("Failed to delete");
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["audiobooksLibrary"] });
      queryClient.invalidateQueries({ queryKey: ["dashboardStats"] });
    }
  });

  const deleteBook = (id) => {
    setPendingDeleteBook(null);
    deleteMutation.mutate(id);
  };
  const deletingId = deleteMutation.isPending ? deleteMutation.variables : null;

  const playAudiobook = (id) => {
    // We can open the streaming URL or embed an audio player.
    const url = `${API_BASE}/audiobooks/${id}/stream`;
    window.open(url, '_blank');
  };

  return (
    <>
      <div className="p-4 md:p-8 max-w-6xl mx-auto w-full space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2 flex items-center gap-3 bg-clip-text text-transparent bg-gradient-to-r from-primary to-blue-400">
            <Headphones className="h-8 w-8 text-primary" />
            My Library
          </h1>
          <p className="text-muted-foreground">Manage and listen to your generated audiobooks.</p>
        </div>

        {/* Storage Quota Card */}
        {storageUsage && (
          <Card className="bg-background/60 backdrop-blur-xl border-primary/20 shadow-lg shadow-primary/5">
            <CardHeader className="py-4">
              <CardTitle className="text-sm">Storage Quota</CardTitle>
              <CardDescription className="text-xs">
                {formatBytes(storageUsage.used_bytes)} / {formatBytes(storageUsage.limit_bytes)} ({storageUsage.percentage}%)
              </CardDescription>
            </CardHeader>
            <CardContent className="pb-4">
              <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted/30">
                <div
                  className={`h-full transition-all duration-500 ease-in-out ${storageUsage.percentage > 90 ? "bg-destructive shadow-[0_0_10px_rgba(239,68,68,0.5)]" : "bg-primary shadow-[0_0_10px_rgba(139,92,246,0.5)]"}`}
                  style={{ width: `${Math.min(100, Math.max(0, storageUsage.percentage || 0))}%` }}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Table Section */}
        <Card className="bg-background/60 backdrop-blur-xl border-white/5 shadow-2xl">
          <CardHeader>
            <CardTitle>Generated Files</CardTitle>
            <CardDescription>All your converted PDFs will appear here.</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-4">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : audiobooks.length === 0 ? (
              <div className="text-center py-12 border border-dashed rounded-lg bg-muted/50">
                <FileAudio className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-4" />
                <h3 className="text-lg font-medium">No audiobooks yet</h3>
                <p className="text-sm text-muted-foreground mt-1 mb-6">Convert your first PDF to see it here.</p>
                <Button onClick={() => window.location.href = '/dashboard/upload'}>
                  Start Converting
                </Button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {audiobooks.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((book) => {
                  const title = book.original_name || book.filename || book.name || "Audiobook";
                  const pages = book.total_pages ? `${book.total_pages} pag` : "1 pag";
                  const duration = book.duration_minutes ? `~${book.duration_minutes} min` : "~0 min";
                  const size = formatBytes(book.size_bytes);

                  // Handle both SQLite unix timestamps and Supabase ISO strings
                  const dateObj = typeof book.created_at === 'number'
                    ? new Date(book.created_at * 1000)
                    : new Date(book.created_at);
                  const dateStr = dateObj.toLocaleDateString("ro-RO", {
                    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
                  }).replace(",", "");

                  return (
                    <div
                      key={book.id}
                      className={`group flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-xl border bg-background/40 hover:bg-white/[0.02] transition-all duration-300 overflow-hidden origin-top ${deletingId === book.id
                        ? 'opacity-0 h-0 p-0 mb-0 border-transparent scale-95'
                        : 'opacity-100 h-auto p-4 mb-0 border-white/5'
                        }`}
                    >
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="bg-primary/10 p-2.5 rounded-lg text-primary flex-shrink-0">
                          <Headphones className="h-5 w-5" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          <h4 className="font-semibold text-[15px] tracking-tight leading-tight truncate text-foreground">{title}</h4>
                          <div className="flex items-center flex-wrap gap-1.5 text-[13px] text-muted-foreground mt-1">
                            <span>{pages}</span>
                            <span className="opacity-40 text-[10px]">●</span>
                            <span>{duration}</span>
                            <span className="opacity-40 text-[10px]">●</span>
                            <span>{size}</span>
                            <span className="opacity-40 text-[10px]">●</span>
                            <span>{dateStr}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 sm:opacity-70 group-hover:opacity-100 transition-opacity pl-14 sm:pl-0">
                        {/* Play */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 border border-white/5 bg-background/50 hover:bg-primary/20 hover:text-primary hover:border-primary/30 transition-all rounded-lg"
                          onClick={() => playAudiobook(book.id)}
                          title="Ascultă audiobook"
                        >
                          <Play className="h-[18px] w-[18px] fill-current" />
                        </Button>

                        {/* Download */}
                        <a 
                          href={book.public_url || `${API_BASE}/download/${book.job_id || book.id}?token=${typeof window !== 'undefined' ? localStorage.getItem("audiobook_access_code") : ""}&ngrok-skip-browser-warning=1`}
                          download={`${title.replace(".pdf", "")}.mp3`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Descarcă MP3"
                          className="inline-flex shrink-0 items-center justify-center h-9 w-9 border border-primary/20 bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground hover:border-primary transition-all rounded-lg shadow-sm"
                        >
                          <Download className="h-4 w-4" />
                        </a>

                        {/* Delete */}
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 border border-white/5 bg-background/50 hover:bg-destructive/10 hover:text-destructive hover:border-destructive/30 transition-all rounded-lg"
                          onClick={() => setPendingDeleteBook(book)}
                          disabled={deletingId === book.id}
                          title="Șterge"
                        >
                          {deletingId === book.id ? (
                            <div className="h-4 w-4 rounded-full border-2 border-destructive border-t-transparent animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}

                {/* Pagination Controls */}
                {audiobooks.length > 5 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 mt-2 border-t border-white/5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground font-medium">Show</span>
                      <select
                        className="bg-transparent border border-white/10 rounded-md text-sm py-1 px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                        value={itemsPerPage}
                        onChange={(e) => {
                          setItemsPerPage(Number(e.target.value));
                          setCurrentPage(1);
                        }}
                      >
                        <option value={5} className="bg-[#0a0a14]">5</option>
                        <option value={10} className="bg-[#0a0a14]">10</option>
                        <option value={25} className="bg-[#0a0a14]">25</option>
                      </select>
                    </div>

                    <div className="flex items-center gap-4">
                      <span className="text-sm text-muted-foreground font-medium">
                        Page {currentPage} of {Math.max(1, Math.ceil(audiobooks.length / itemsPerPage))}
                      </span>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 border-white/10 hover:bg-white/5 disabled:opacity-30"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 border-white/10 hover:bg-white/5 disabled:opacity-30"
                          onClick={() => setCurrentPage(p => Math.min(Math.ceil(audiobooks.length / itemsPerPage), p + 1))}
                          disabled={currentPage >= Math.ceil(audiobooks.length / itemsPerPage)}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!pendingDeleteBook} onOpenChange={(open) => { if (!open) setPendingDeleteBook(null); }}>
        <DialogContent className="bg-background/95 backdrop-blur-xl border-white/10 sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <DialogTitle className="text-center text-lg">Delete Audiobook</DialogTitle>
            <DialogDescription className="text-center">
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                {pendingDeleteBook?.original_name || pendingDeleteBook?.filename || "this audiobook"}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:flex-row">
            <DialogClose render={<Button variant="outline" className="flex-1 border-white/10 hover:bg-white/5" />}>
              Cancel
            </DialogClose>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => pendingDeleteBook && deleteBook(pendingDeleteBook.id)}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
