import "./globals.css";

export const metadata = {
  title: "PDF to Audiobook | Convertor Român",
  description: "Transformă orice fișier PDF într-un audiobook în limba română. Upload drag-and-drop, conversie automată și descărcare MP3.",
  keywords: "PDF, audiobook, text to speech, română, TTS, convertor",
};

import { TooltipProvider } from "@/components/ui/tooltip";
import { Providers } from "@/components/providers";

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
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
