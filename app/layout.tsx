import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';
import { loadManifest } from '@/lib/data';
import { fmtDate } from '@/lib/format';

export const metadata: Metadata = { title: 'Police Drone Flight Logs', description: 'Published drone flight logs from police and public-safety agencies, by agency.' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const m = loadManifest();
  return (
    <html lang="en"><body>
      <div className="wrap">
        <header className="masthead">
          <h1><Link href="/">Police Drone Flight Logs</Link></h1>
          <nav><Link href="/">Agencies</Link><Link href="/about">About the data</Link></nav>
        </header>
        <main>{children}</main>
        <footer className="footer">Data as of {m.run_utc ? fmtDate(m.run_utc.slice(0, 10)) : 'n/a'}. Agencies publish only the flights they choose to publish. Skydio-sourced agencies show Skydio flights only.</footer>
      </div>
    </body></html>
  );
}
