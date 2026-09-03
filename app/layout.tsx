import './globals.css';
import Link from 'next/link';
import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import { collectedAt } from '@/lib/data';
import { fmtDate } from '@/lib/format';

// An engineering typeface pairing -- IBM Plex Sans for body/UI text, IBM Plex Mono for
// numerals and instrument-panel labels -- wired through CSS variables so globals.css
// stays the single source of truth for the font stack (see --sans / --mono there).
const plexSans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-sans', display: 'swap' });
const plexMono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-mono', display: 'swap' });

const SITE_NAME = 'Law Enforcement Drone Flight Log';
const DESCRIPTION =
  'What law-enforcement drone programmes actually do, agency by agency: how often they fly, for how long, at what hours, and for what stated reason. Built from the flight logs agencies publish themselves.';

export const metadata: Metadata = {
  title: { default: SITE_NAME, template: `%s — ${SITE_NAME}` },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  // Absolute URLs for social cards. Set NEXT_PUBLIC_SITE_URL for the
  // deployment; Vercel's own URL is the fallback on previews.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL
      ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000'),
  ),
  openGraph: { title: SITE_NAME, description: DESCRIPTION, siteName: SITE_NAME, type: 'website', locale: 'en_US' },
  twitter: { card: 'summary', title: SITE_NAME, description: DESCRIPTION },
  robots: { index: true, follow: true },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const collected = collectedAt();
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}><body>
      <div className="wrap">
        <header className="masthead">
          <h1><Link href="/">{SITE_NAME}</Link></h1>
          <nav><Link href="/">Map</Link><Link href="/agencies">All agencies</Link><Link href="/about">About the data</Link></nav>
        </header>
        <main>{children}</main>
        <footer className="footer">
          <span>
            Collected {fmtDate(collected.toISOString().slice(0, 10))}. A monthly snapshot, not a live
            feed. Agencies publish only the flights they choose to.
          </span>
          <span>
            A project of <a href="https://ahdatalytics.com" target="_blank" rel="noopener noreferrer">AH Datalytics</a>.
            {' '}<Link href="/about">How this was built</Link>.
            {' '}<a href="https://www.flaticon.com/free-icons/drone-case" title="drone case icons" target="_blank" rel="noopener noreferrer">Drone case icons created by Magnific &ndash; Flaticon</a>.
          </span>
        </footer>
      </div>
    </body></html>
  );
}
