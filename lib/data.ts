import 'server-only';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Registry, RegistryAgency } from '@/pipeline/registry';
import { decodeFlightFile, type FlightFile } from '@/pipeline/flightfile';
import type { FlightRecord } from '@/pipeline/schema';
import { suppressionReason } from '@/lib/aggregate';
import type { Manifest } from '@/pipeline/pull';

const DATA = join(process.cwd(), 'data');

export function loadRegistry(): Registry { return JSON.parse(readFileSync(join(DATA, 'registry.json'), 'utf8')); }
export function loadManifest(): Manifest { return JSON.parse(readFileSync(join(DATA, 'manifest.json'), 'utf8')); }
const suppressed = new Map<string, string | null>();
/** Memoised: reads each agency's flight file once per build, not once per page. */
export function suppressionFor(id: string): string | null {
  if (!suppressed.has(id)) suppressed.set(id, suppressionReason(loadFlights(id)));
  return suppressed.get(id)!;
}

/** Agencies collected but deliberately not shown, with the reason for each. */
export function suppressedAgencies(): { agency: RegistryAgency; reason: string }[] {
  return collectedAgencies()
    .map(a => ({ agency: a, reason: suppressionFor(a.agency_id) }))
    .filter((x): x is { agency: RegistryAgency; reason: string } => x.reason !== null);
}

/** Everything the pipeline collected and curated, including records too thin to show. */
export function collectedAgencies(): RegistryAgency[] {
  return loadRegistry().agencies.filter(a => a.status !== 'needs_review');
}

/** Agencies the site actually shows. */
export function publicAgencies(): RegistryAgency[] {
  return collectedAgencies().filter(a => suppressionFor(a.agency_id) === null);
}
export function getAgency(id: string): RegistryAgency | undefined { return publicAgencies().find(a => a.agency_id === id); }
export function loadFlights(id: string): FlightRecord[] {
  const p = join(DATA, 'flights', `${id}.json`);
  if (!existsSync(p)) return [];
  return decodeFlightFile(JSON.parse(readFileSync(p, 'utf8')) as FlightFile);
}
