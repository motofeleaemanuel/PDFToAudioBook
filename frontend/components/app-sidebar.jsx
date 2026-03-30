"use client";

import { 
  Headphones, Home, Upload, Library, CreditCard, 
  LogOut, Loader2, FileText, CheckCircle2, 
  AlertCircle, Download, ExternalLink 
} from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { useJobs } from "@/components/job-provider";
import { useTheme, themes } from "@/components/theme-provider";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarFooter,
  SidebarHeader,
  SidebarSeparator,
} from "@/components/ui/sidebar";

const items = [
  { title: "Overview", url: "/dashboard", icon: Home },
  { title: "Convert PDF", url: "/dashboard/upload", icon: Upload },
  { title: "My Audiobooks", url: "/dashboard/audiobooks", icon: Library },
  { title: "Billing", url: "/dashboard/billing", icon: CreditCard },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { sidebarJobs } = useJobs();
  const { theme, setTheme } = useTheme();

  const handleDownload = (e, job) => {
    e.stopPropagation();
    const cloudUrls = job.details?.cloud_urls || [];
    if (cloudUrls.length > 1) {
      router.push("/dashboard/audiobooks");
      return;
    }
    const cloudUrl = job.details?.cloud_url;
    if (cloudUrl) {
      window.open(cloudUrl, "_blank");
    }
  };

  const displayName = user?.user_metadata?.full_name || user?.email?.split("@")[0] || "User";
  const email = user?.email || "";
  const initials = displayName.charAt(0).toUpperCase();
  const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;

  return (
    <Sidebar variant="inset">
      {/* ── Brand ─────────────── */}
      <SidebarHeader className="p-5 pb-4">
        <div
          className="flex items-center gap-3 cursor-pointer group"
          onClick={() => router.push('/dashboard')}
        >
          <div className="bg-primary w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shadow-primary/30 group-hover:shadow-primary/50 group-hover:scale-105 transition-all">
            <Headphones className="h-5 w-5 text-white" />
          </div>
          <div>
            <h2 className="font-bold text-sm tracking-tight">PDF To Audiobook</h2>
            <p className="text-[10px] text-muted-foreground font-medium tracking-widest uppercase">AI Audio Engine</p>
          </div>
        </div>
      </SidebarHeader>

      <SidebarSeparator className="opacity-50" />

      {/* ── Navigation ────────── */}
      <SidebarContent className="p-3">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {items.map((item) => {
                const isActive = pathname === item.url;
                return (
                  <SidebarMenuItem key={item.title}>
                    <button
                      onClick={() => router.push(item.url)}
                      className={`
                        w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200
                        ${isActive
                          ? "bg-primary/10 text-white border border-primary/20 shadow-sm shadow-primary/10"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                        }
                      `}
                    >
                      <item.icon className={`h-[18px] w-[18px] ${isActive ? "text-primary" : ""}`} />
                      <span>{item.title}</span>
                      {isActive && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                      )}
                    </button>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── Active & Recent Jobs ────────── */}
        {pathname !== "/dashboard/upload" && sidebarJobs.length > 0 && (
          <>
            <SidebarSeparator className="opacity-30 my-2" />
            <SidebarGroup className="p-0">
              <p className="text-[10px] text-muted-foreground font-semibold tracking-widest uppercase px-3 mb-1">
                Conversions
              </p>
              <SidebarGroupContent>
                <div className="space-y-0.5 px-2">
                  {sidebarJobs.map((job) => {
                    const isProcessing = job.status === "uploading" || job.status === "processing";
                    const isCompleted = job.status === "completed";
                    const isError = job.status === "error";
                    const isMultiPart = (job.details?.cloud_urls?.length || 0) > 1;

                    return (
                      <button
                        key={job.id}
                        onClick={() => router.push("/dashboard/upload")}
                        className={`
                          w-full flex items-center gap-2.5 p-2 rounded-lg transition-all text-left group/job
                          ${isCompleted ? 'bg-green-500/5 hover:bg-green-500/10' : 
                            isError ? 'bg-red-500/5 hover:bg-red-500/10' : 
                            'hover:bg-white/5'}
                        `}
                      >
                        {isProcessing && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />}
                        {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" />}
                        {isError && <AlertCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />}
                        
                        <div className="flex-1 min-w-0">
                          <p className={`text-xs font-medium truncate ${isCompleted ? 'text-green-500/90' : isError ? 'text-red-500/90' : 'text-white/80'}`}>
                            {job.file?.name || job.filename || "Document"}
                          </p>
                          
                          {isProcessing ? (
                            <div className="flex items-center gap-2 mt-1">
                              <div className="flex-1 h-1 bg-black/30 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary transition-all duration-300"
                                  style={{ width: `${Math.min(100, Math.max(0, job.progress || 0))}%` }}
                                />
                              </div>
                              <span className="text-[9px] font-medium text-white/50 shrink-0">
                                {job.progress || 0}%
                              </span>
                            </div>
                          ) : isCompleted ? (
                            <span className="text-[10px] text-green-600 font-bold tracking-tight">FINISHED</span>
                          ) : isError ? (
                            <span className="text-[10px] text-red-600 font-bold tracking-tight">FAILED</span>
                          ) : null}
                        </div>

                        {isCompleted && (
                          <div 
                            onClick={(e) => handleDownload(e, job)}
                            className="bg-white/10 hover:bg-white/20 p-1.5 rounded-md transition-colors"
                          >
                            {isMultiPart ? (
                              <ExternalLink className="h-3 w-3 text-white/70" />
                            ) : (
                              <Download className="h-3 w-3 text-white/70" />
                            )}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter className="p-3 pt-0">
        <SidebarSeparator className="opacity-50 mb-4" />
        
        {/* ── Theme Switcher ────────── */}
        <div className="px-2 mb-4">
          <p className="text-[10px] text-muted-foreground font-semibold tracking-widest uppercase mb-3">
            Choose Theme
          </p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(themes).map(([key, t]) => (
              <button
                key={key}
                onClick={() => setTheme(key)}
                className={`
                  w-6 h-6 rounded-full border-2 transition-all p-0.5 shrink-0
                  ${theme === key ? "border-white scale-110 shadow-[0_0_12px_var(--primary-glow)]" : "border-transparent opacity-50 hover:opacity-100 hover:scale-105"}
                `}
                title={t.name}
              >
                <div 
                  className="w-full h-full rounded-full shadow-inner" 
                  style={{ backgroundColor: t.primary }}
                />
              </button>
            ))}
          </div>
        </div>

        <SidebarSeparator className="opacity-50 mb-3" />
        <div className="flex items-center gap-3 px-2">
          {avatarUrl ? (
            <img 
              src={avatarUrl} 
              alt={displayName} 
              className="w-9 h-9 rounded-lg object-cover shrink-0 border border-white/5"
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm shrink-0 shadow-lg shadow-primary/20">
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{displayName}</p>
            <p className="text-[11px] text-muted-foreground truncate">{email}</p>
          </div>
          <button
            onClick={signOut}
            className="p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </SidebarFooter>

    </Sidebar>
  );
}

