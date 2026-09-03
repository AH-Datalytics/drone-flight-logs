import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { loadManifest } from '@/lib/data';
import { fmtDate } from '@/lib/format';

// An engineering typeface pairing -- IBM Plex Sans for body/UI text, IBM Plex Mono for
// numerals and instrument-panel labels -- wired through CSS variables so globals.css
// stays the single source of truth for the font stack (see --sans / --mono there).
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = { title: 'Police Drone Flight Logs', description: 'Published drone flight logs from police and public-safety agencies, by agency.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const m = loadManifest();
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}><body>
      <div className="wrap">
        <header className="masthead">
          <h1><Link href="/">Police Drone Flight Logs</Link></h1>
          <nav><Link href="/">Agencies</Link><Link href="/about">About the data</Link></nav>
        </header>
        <main>{children}</main>
        <footer className="footer">Collected {m.run_utc ? fmtDate(m.run_utc.slice(0, 10)) : 'n/a'}. A monthly snapshot, not a live feed. Agencies publish only the flights they choose to.</footer>
      </div>
    </body></html>
  );
}
