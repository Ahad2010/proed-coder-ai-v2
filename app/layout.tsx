import "./globals.css";
import type { Metadata } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { NavTabs } from "./nav-tabs";

// Force dynamic rendering app-wide. This avoids a Next.js 16 Turbopack bug
// where static prerendering of the auto-generated /_not-found page crashes
// with "Cannot read properties of null (reading 'useContext')" during build.
export const dynamic = "force-dynamic";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ProEd Coder AI",
  description: "AI-powered medical coding & policy assistant — by AXCEL",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <div className="min-h-screen">
          <header className="border-b border-line bg-paper-panel">
            <div className="mx-auto max-w-6xl px-6 pt-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-8 w-8 place-items-center rounded-[3px] border border-brand-700 bg-brand-600 font-mono text-sm font-semibold text-paper-panel">
                    P
                  </div>
                  <div>
                    <div className="text-sm font-semibold leading-none text-ink">ProEd Coder AI</div>
                    <div className="label-eyebrow mt-1">Chart · Code · Query</div>
                  </div>
                </div>
                <div className="label-eyebrow">Built by AXCEL</div>
              </div>
              <NavTabs />
            </div>
          </header>
          <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
        </div>
      </body>
    </html>
  );
}