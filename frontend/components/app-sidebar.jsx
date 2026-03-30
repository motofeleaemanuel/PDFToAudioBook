"use client";

import { Headphones, Home, Upload, Library, CreditCard, LogOut, Loader2, FileText } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { useJobs } from "@/components/job-provider";

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
  const { activeJobs } = useJobs();

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
          <div className="bg-gradient-to-br from-violet-500 to-blue-500 w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shadow-violet-500/30 group-hover:shadow-violet-500/50 group-hover:scale-105 transition-all">
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
                          ? "bg-gradient-to-r from-violet-600/20 to-blue-600/15 text-white border border-violet-500/20 shadow-sm shadow-violet-500/10"
                          : "text-muted-foreground hover:text-foreground hover:bg-white/5"
                        }
                      `}
                    >
                      <item.icon className={`h-[18px] w-[18px] ${isActive ? "text-violet-400" : ""}`} />
                      <span>{item.title}</span>
                      {isActive && (
                        <div className="ml-auto w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                      )}
                    </button>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* ── Active Jobs ────────── */}
        {pathname !== "/dashboard/upload" && activeJobs.length > 0 && (
          <>
            <SidebarSeparator className="opacity-30 my-2" />
            <SidebarGroup className="p-0">
              <p className="text-[10px] text-muted-foreground font-semibold tracking-widest uppercase px-3 mb-1">
                Active Conversions
              </p>
              <SidebarGroupContent>
                <div className="space-y-0.5 px-2">
                  {activeJobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => router.push("/dashboard/upload")}
                      className="w-full flex items-center gap-2.5 p-2 rounded-lg hover:bg-white/5 transition-all text-left"
                    >
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-white/80 truncate">
                          {job.file?.name || job.filename || "Document"}
                        </p>
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
                      </div>
                    </button>
                  ))}
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      {/* ── User Profile ────────── */}
      <SidebarFooter className="p-3 pt-0">
        <SidebarSeparator className="opacity-50 mb-3" />
        <div className="flex items-center gap-3 px-2">
          {avatarUrl ? (
            <img 
              src={avatarUrl} 
              alt={displayName} 
              className="w-9 h-9 rounded-lg object-cover shrink-0 border border-white/5"
            />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-blue-500 flex items-center justify-center text-white font-bold text-sm shrink-0">
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

