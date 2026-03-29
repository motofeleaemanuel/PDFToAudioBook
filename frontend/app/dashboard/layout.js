import { SidebarProvider, SidebarTrigger, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { AmbientBackground } from "@/components/ambient-background";
import { AuthProvider } from "@/components/auth-provider";
import { JobProvider } from "@/components/job-provider";

export default function DashboardLayout({ children }) {
  return (
    <AuthProvider>
      <JobProvider>
        <SidebarProvider>
          <AmbientBackground />
          <AppSidebar />
          <SidebarInset className="bg-transparent">
            <header className="flex h-12 shrink-0 items-center border-b border-white/5 bg-background/30 backdrop-blur-xl px-4 sticky top-0 z-20">
              <SidebarTrigger className="-ml-1" />
            </header>
            <main className="flex-1 overflow-auto p-4 md:p-6 relative z-10">
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </JobProvider>
    </AuthProvider>
  );
}

