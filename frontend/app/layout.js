import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Providers } from "@/components/providers";

export const metadata = {
  title: "PDF to Audiobook | Convertor Român",
  description: "Transformă orice fișier PDF într-un audiobook în limba română. Upload drag-and-drop, conversie automată și descărcare MP3.",
  keywords: "PDF, audiobook, text to speech, română, TTS, convertor",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                try {
                  const theme = localStorage.getItem('app-theme') || 'purple';
                  const themes = {
                    purple: { primary: "#8b5cf6", glow: "rgba(139, 92, 246, 0.4)" },
                    indigo: { primary: "#6366f1", glow: "rgba(99, 102, 241, 0.4)" },
                    blue: { primary: "#3b82f6", glow: "rgba(59, 130, 246, 0.4)" },
                    cyan: { primary: "#06b6d4", glow: "rgba(6, 182, 212, 0.4)" },
                    teal: { primary: "#14b8a6", glow: "rgba(20, 184, 166, 0.4)" },
                    green: { primary: "#4ade80", glow: "rgba(74, 222, 128, 0.4)" },
                    lime: { primary: "#84cc16", glow: "rgba(132, 204, 22, 0.4)" },
                    yellow: { primary: "#facc15", glow: "rgba(250, 204, 21, 0.4)" },
                    orange: { primary: "#f97316", glow: "rgba(249, 115, 22, 0.4)" },
                    pink: { primary: "#ff007f", glow: "rgba(255, 0, 127, 0.4)" },
                    red: { primary: "#ef4444", glow: "rgba(239, 68, 68, 0.4)" }
                  };
                  const current = themes[theme] || themes.purple;
                  const root = document.documentElement;
                  root.style.setProperty('--primary', current.primary);
                  root.style.setProperty('--sidebar-primary', current.primary);
                  root.style.setProperty('--ring', current.primary);
                  root.style.setProperty('--primary-glow', current.glow);
                } catch (e) {}
              })();
            `,
          }}
        />
      </head>
      <body className="antialiased font-sans bg-background text-foreground" suppressHydrationWarning>
        <Providers>
          <TooltipProvider>
            {children}
          </TooltipProvider>
        </Providers>
      </body>
    </html>
  );
}
