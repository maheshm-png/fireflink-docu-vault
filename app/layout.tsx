import "./globals.css";
import type { ReactNode } from "react";
import { Inter } from "next/font/google";

// tailwind.config.ts declared "Inter" as the sans stack, but nothing ever
// actually loaded it — the browser silently fell back to the OS default
// (Segoe UI on Windows), which read as plain/unpolished rather than the
// clean typeface the design intended. next/font self-hosts the font files
// at build time (no external request at runtime, no layout shift) and
// exposes them through this CSS variable, which font-sans below now points
// at for real.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata = {
  title: "FireFlink Docu Vault",
  description: "Case studies, competitor comparisons, demo videos — all in one place.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
