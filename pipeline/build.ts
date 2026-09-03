import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { FlightRecord } from './schema.js';
import { decodeFlightFile, encodeSourcedFlightFile, summarize, type FlightFile } from './flightfile.js';
import { groupAgencies, agencyKind, type Aliases, type Candidate } from './identity.js';
import { mergeSources, type SourcedRecord } from './merge.js';
import { localDate } from './time.js';
import { guessOrgType, type OrgType, type Status } from './registry.js';
import { extractFlights as extractFlock, toRecord as flockRecord } from './flock/parse.js';
import { parseFlights as parseAirData, toRecord as airDataRecord, type AirDataFlight } from './airdata/parse.js';
import { toRecord as capeRecord, type CapeFlight } from './cape/parse.js';

/**
 * Builds the view the site reads.
 *
 * Each collector owns its own store and never writes outside it: Skydio and
 * SFPD keep per-agency flight files, Flock, AirData and Motorola keep raw
 * payloads as collected. This step is the only thing that reads all of them,
 * decides which dashboards belong to the same department, merges their flights,
 * and writes one file per agency for the site.
 *
 * It is a pure rebuild — nothing here fetches, so it can be re-run after any
 * change to the matching rules without touching a single source.
 */

const DATA = 'data';
const SITE_DIR = join(DATA, 'site');
const SITE_FLIGHTS = join(SITE_DIR, 'flights');

export type SourceRef = {
  source: string;
  source_agency_id: string;
  official_url: string;
  flight_count: number;
  first_flight: string | null;
  last_flight: string | null;
};

export type SiteAgency = {
  agency_id: string;
  display_name: string;
  state: string | null;
  org_type: OrgType;
  timezone: string;
  sources: SourceRef[];
  official_url: string;
  status: Status;
  first_flight: string | null;
  last_flight: string | null;
  flight_count: number;
  total_hours: number;
  /** Flights that two platforms both published, counted once here. */
  overlap_count: number;
  notes: string | null;
};

type Entry = Candidate & {
  source: string;
  displayName: string;
  timezone: string;
  orgType: OrgType;
  officialUrl: string;
  notes: string | null;
  load: () => FlightRecord[];
};

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line) as T); } catch { /* truncated final line */ }
  }
  return out;
}

const TZ_BY_STATE: Record<string, string> = {
  CA: 'America/Los_Angeles', WA: 'America/Los_Angeles', OR: 'America/Los_Angeles', NV: 'America/Los_Angeles',
  AZ: 'America/Phoenix',
  CO: 'America/Denver', UT: 'America/Denver', NM: 'America/Denver', MT: 'America/Denver', WY: 'America/Denver', ID: 'America/Denver',
  TX: 'America/Chicago', IL: 'America/Chicago', MN: 'America/Chicago', WI: 'America/Chicago', MO: 'America/Chicago',
  IA: 'America/Chicago', KS: 'America/Chicago', NE: 'America/Chicago', OK: 'America/Chicago', AR: 'America/Chicago',
  LA: 'America/Chicago', MS: 'America/Chicago', AL: 'America/Chicago', TN: 'America/Chicago', ND: 'America/Chicago', SD: 'America/Chicago',
};

function timezoneForState(state: string | null): string {
  return (state && TZ_BY_STATE[state]) || 'America/New_York';
}

/** Every published dashboard in the census, with how to read its flights. */
export function collectEntries(): Entry[] {
  const entries: Entry[] = [];

  for (const a of readJson<{ agencies: any[] }>(join(DATA, 'registry.json')).agencies) {
    if (a.status === 'needs_review') continue;
    entries.push({
      key: a.agency_id, name: a.display_name, state: a.state, source: a.source,
      displayName: a.display_name, timezone: a.timezone, orgType: a.org_type,
      officialUrl: a.official_url, notes: a.notes ?? null,
      load: () => {
        const p = join(DATA, 'flights', `${a.agency_id}.json`);
        return existsSync(p) ? decodeFlightFile(readJson<FlightFile>(p)) : [];
      },
    });
  }

  for (const s of readJson<{ sites: any[] }>(join(DATA, 'flock_sites.json')).sites) {
    const tz = timezoneForState(s.state);
    entries.push({
      key: s.agency_id, name: s.display_name, state: s.state, source: 'flock_aerodome',
      displayName: titleCase(s.display_name), timezone: tz, orgType: orgTypeFor(s.display_name),
      officialUrl: s.url, notes: null,
      load: () => readJsonl<Parameters<typeof flockRecord>[2]>(join(DATA, 'raw', 'flock', `${s.agency_id}.jsonl`))
        .map(f => flockRecord(s.agency_id, tz, f))
        .filter((r): r is FlightRecord => r !== null),
    });
  }

  for (const s of readJson<{ sites: any[] }>(join(DATA, 'airdata_sites.json')).sites) {
    entries.push({
      key: s.agency_id, name: s.display_name, state: s.state, source: 'airdata',
      displayName: s.display_name, timezone: s.timezone, orgType: orgTypeFor(s.display_name),
      officialUrl: `https://app.airdata.com/u/${s.slug}`, notes: null,
      load: () => readJsonl<AirDataFlight>(join(DATA, 'raw', 'airdata', `${s.agency_id}.jsonl`))
        .map(f => airDataRecord(s.agency_id, s.timezone, f))
        .filter((r): r is FlightRecord => r !== null),
    });
  }

  for (const s of readJson<{ sites: any[] }>(join(DATA, 'cape_sites.json')).sites) {
    entries.push({
      key: s.agency_id, name: s.display_name, state: s.state, source: 'motorola_cape',
      displayName: s.display_name, timezone: s.timezone, orgType: orgTypeFor(s.display_name),
      officialUrl: `https://www.aerial.motorolasolutions.com/transparency/${s.slug}`, notes: null,
      load: () => readJsonl<CapeFlight>(join(DATA, 'raw', 'cape', `${s.agency_id}.jsonl`))
        .map(f => capeRecord(s.agency_id, s.timezone, f, localDate))
        .filter((r): r is FlightRecord => r !== null),
    });
  }

  return entries;
}

function orgTypeFor(name: string): OrgType {
  const kind = agencyKind(name);
  if (kind === 'fire') return 'fire_ems';
  if (kind === 'university') return 'university';
  if (kind === 'police' || kind === 'sheriff' || kind === 'port') return 'law_enforcement';
  return guessOrgType(name);
}

/** Vendors write dashboard titles in capitals; the site does not shout. */
export function titleCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase())
    .replace(/\bPd\b/g, 'PD').replace(/\bSo\b/g, 'SO').replace(/\bTx\b/g, 'TX')
    .replace(/\bSo\b/g, 'SO').replace(/\bUs\b/g, 'US').replace(/\bRtic\b/g, 'RTIC');
}

/**
 * The agency's canonical record. The longest display name usually carries the
 * most information ("Everett Police Department" over "EVERETT PD"), and the id
 * of whichever source has been published longest keeps existing links working.
 */
export function chooseIdentity(group: Entry[]): { key: string; displayName: string; state: string | null; timezone: string; orgType: OrgType } {
  const order = ['skydio_arcgis', 'sfpd_datasf', 'flock_aerodome', 'airdata', 'motorola_cape'];
  const primary = [...group].sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))[0];
  const displayName = [...group].map(e => e.displayName).sort((a, b) => b.length - a.length)[0];
  return {
    key: primary.key,
    displayName,
    state: group.find(e => e.state)?.state ?? null,
    timezone: primary.timezone,
    orgType: group.map(e => e.orgType).find(t => t === 'law_enforcement') ?? primary.orgType,
  };
}

export function statusFor(lastFlight: string | null, today: string): Status {
  if (!lastFlight) return 'stale';
  const days = Math.floor((Date.parse(today) - Date.parse(lastFlight)) / 86_400_000);
  return days <= 60 ? 'ok' : 'stale';
}

export function build(log: (m: string) => void = console.log): void {
  const aliases = existsSync(join(DATA, 'agency_aliases.json'))
    ? readJson<Aliases>(join(DATA, 'agency_aliases.json'))
    : { link: [], separate: [] };

  const entries = collectEntries();
  const groups = groupAgencies(entries, aliases);
  log(`${entries.length} published dashboards, ${groups.length} agencies after merging`);

  mkdirSync(SITE_FLIGHTS, { recursive: true });
  for (const f of readdirSync(SITE_FLIGHTS)) rmSync(join(SITE_FLIGHTS, f));

  const today = new Date().toISOString().slice(0, 10);
  const agencies: SiteAgency[] = [];
  let totalOverlaps = 0;

  for (const group of groups) {
    const identity = chooseIdentity(group);
    const bySource: Record<string, FlightRecord[]> = {};
    const refs: SourceRef[] = [];

    for (const entry of group) {
      const records = entry.load();
      bySource[entry.source] = [...(bySource[entry.source] ?? []), ...records];
      const s = summarize(records);
      refs.push({
        source: entry.source, source_agency_id: entry.key, official_url: entry.officialUrl,
        flight_count: s.flight_count, first_flight: s.first_flight, last_flight: s.last_flight,
      });
    }

    const merged = mergeSources(bySource);
    const summary = summarize(merged.records);
    totalOverlaps += merged.overlaps;

    writeFileSync(
      join(SITE_FLIGHTS, `${identity.key}.json`),
      JSON.stringify(encodeSourcedFlightFile(identity.key, merged.records as SourcedRecord[])),
    );

    agencies.push({
      agency_id: identity.key,
      display_name: identity.displayName,
      state: identity.state,
      org_type: identity.orgType,
      timezone: identity.timezone,
      sources: refs.sort((a, b) => b.flight_count - a.flight_count),
      official_url: refs.reduce((best, r) => (r.flight_count > best.flight_count ? r : best), refs[0]).official_url,
      status: statusFor(summary.last_flight, today),
      first_flight: summary.first_flight,
      last_flight: summary.last_flight,
      flight_count: summary.flight_count,
      total_hours: summary.total_hours,
      overlap_count: merged.overlaps,
      notes: group.map(e => e.notes).find(Boolean) ?? null,
    });
  }

  agencies.sort((a, b) => b.flight_count - a.flight_count);
  const bySourceTotals: Record<string, number> = {};
  for (const a of agencies) for (const s of a.sources) bySourceTotals[s.source] = (bySourceTotals[s.source] ?? 0) + s.flight_count;

  writeFileSync(join(SITE_DIR, 'agencies.json'), JSON.stringify({
    built_utc: new Date().toISOString(),
    agency_count: agencies.length,
    flight_count: agencies.reduce((t, a) => t + a.flight_count, 0),
    overlap_count: totalOverlaps,
    by_source: bySourceTotals,
    agencies,
  }, null, 1) + '\n');

  const multi = agencies.filter(a => a.sources.length > 1);
  log(`${agencies.reduce((t, a) => t + a.flight_count, 0)} distinct flights`);
  log(`${multi.length} agencies publish on more than one platform; ${totalOverlaps} flights were published twice and are counted once`);
  for (const a of multi) {
    log(`    ${a.display_name}: ${a.sources.map(s => `${s.source} ${s.flight_count}`).join(', ')} -> ${a.flight_count} (${a.overlap_count} shared)`);
  }
  log('per platform, before merging: ' + Object.entries(bySourceTotals).map(([k, v]) => `${k} ${v}`).join(', '));
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pipeline/build.ts');
if (isMain) build();
