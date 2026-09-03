import 'server-only';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFlightFile, type FlightFile } from '@/pipeline/flightfile';
import type { FlightRecord } from '@/pipeline/schema';
import type { SiteAgency } from '@/pipeline/build';
import { suppressionReason } from '@/lib/aggregate';
import type { Manifest } from '@/pipeline/pull';

const DATA = join(process.cwd(), 'data');
const SITE = join(DATA, 'site');

export type SiteData = {
  built_utc: string;
  collected_utc: string | null;
  agency_count: number;
  flight_count: number;
  overlap_count: number;
  by_source: Record<string, number>;
  agencies: SiteAgency[];
};

let cached: SiteData | null = null;
/** The merged view the pipeline builds: one entry per agency, not per dashboard. */
export function loadSite(): SiteData {
  cached ??= JSON.parse(readFileSync(join(SITE, 'agencies.json'), 'utf8')) as SiteData;
  return cached;
}

export function loadManifest(): Manifest { return JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8')); }

/**
 * When the data was last collected, across every source.
 *
 * Not the Skydio manifest's timestamp, which the site used to show: the five
 * collectors run on their own schedules, so that date was already a day behind
 * Flock and AirData by the time a refresh finished.
 */
export function collectedAt(): Date {
  const site = loadSite();
  if (site.collected_utc) return new Date(site.collected_utc);
  const m = loadManifest();
  return m.run_utc ? new Date(m.run_utc) : new Date();
}

const suppressed = new Map<string, string | null>();
/** Memoised: reads each agency's flight file once per build, not once per page. */
export function suppressionFor(id: string): string | null {
  if (!suppressed.has(id)) suppressed.set(id, suppressionReason(loadFlights(id)));
  return suppressed.get(id)!;
}

/** Agencies collected but deliberately not shown, with the reason for each. */
export function suppressedAgencies(): { agency: SiteAgency; reason: string }[] {
  return collectedAgencies()
    .map(a => ({ agency: a, reason: suppressionFor(a.agency_id) }))
    .filter((x): x is { agency: SiteAgency; reason: string } => x.reason !== null);
}

/** Everything the pipeline collected and curated, including records too thin to show. */
export function collectedAgencies(): SiteAgency[] {
  return loadSite().agencies;
}

/** Agencies the site actually shows. */
export function publicAgencies(): SiteAgency[] {
  return collectedAgencies().filter(a => suppressionFor(a.agency_id) === null);
}

export function getAgency(id: string): SiteAgency | undefined { return publicAgencies().find(a => a.agency_id === id); }

export function loadFlights(id: string): FlightRecord[] {
  const p = join(SITE, 'flights', `${id}.json`);
  if (!existsSync(p)) return [];
  return decodeFlightFile(JSON.parse(readFileSync(p, 'utf8')) as FlightFile);
}
