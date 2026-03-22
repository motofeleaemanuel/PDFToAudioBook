import "./globals.css";

export const metadata = {
  title: "PDF to Audiobook | Convertor Român",
  description: "Transformă orice fișier PDF într-un audiobook în limba română. Upload drag-and-drop, conversie automată și descărcare MP3.",
  keywords: "PDF, audiobook, text to speech, română, TTS, convertor",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ro">
      <body>
        <div className="background-glow" />
        {children}
      </body>
    </html>
  );
}
