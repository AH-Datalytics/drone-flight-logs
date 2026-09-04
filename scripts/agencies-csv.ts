import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFlightFile, type FlightFile } from '../pipeline/flightfile.js';
import { suppressionReason } from '../lib/aggregate.js';

/**
 * Every agency on the site, as one CSV.
 *
 * One row per agency, not per dashboard, so an agency publishing to three
 * platforms appears once with all three named and its flights counted once.
 * Includes the agencies collected but hidden, with the reason, because "why
 * isn't my department here" is the question this file should answer.
 *
 * Regenerate with: npm run agencies:csv
 */

type SourceRef = { source: string; flight_count: number; official_url: string; first_flight: string | null; last_flight: string | null };
type Agency = {
  agency_id: string; display_name: string; state: string | null; org_type: string;
  flight_count: number; total_hours: number; first_flight: string | null; last_flight: string | null;
  status: string; overlap_count: number; lat: number | null; collected_utc: string | null;
  official_url: string; sources: SourceRef[];
};

const PLATFORM: Record<string, string> = {
  skydio_arcgis: 'Skydio',
  flock_aerodome: 'Flock Aerodome',
  airdata: 'AirData',
  motorola_cape: 'Motorola CAPE',
  sfpd_datasf: 'City open data',
  self_published: 'Self-published (ArcGIS)',
  dronesense: 'DroneSense',
  brinc: 'BRINC',
};

const site = JSON.parse(readFileSync(join('data', 'site', 'agencies.json'), 'utf8')) as { agencies: Agency[]; collected_utc: string | null };

const q = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const rows = site.agencies.map(a => {
  const p = join('data', 'site', 'flights', `${a.agency_id}.json`);
  const recs = existsSync(p) ? decodeFlightFile(JSON.parse(readFileSync(p, 'utf8')) as FlightFile) : [];
  const hidden = suppressionReason(recs);
  return {
    agency: a.display_name,
    state: a.state ?? '',
    type: a.org_type.replace(/_/g, ' '),
    reported_flights: a.flight_count,
    reported_hours: a.total_hours ? Math.round(a.total_hours) : '',
    first_flight: a.first_flight ?? '',
    last_flight: a.last_flight ?? '',
    platforms: a.sources.map(s => PLATFORM[s.source] ?? s.source).join(' + '),
    flights_per_platform: a.sources.map(s => `${PLATFORM[s.source] ?? s.source}: ${s.flight_count}`).join('; '),
    published_on_two_platforms: a.overlap_count || '',
    shown_on_site: hidden ? 'no' : 'yes',
    hidden_because: hidden ?? '',
    page: hidden ? '' : `https://drones.ahdatalytics.com/agency/${a.agency_id}`,
    agency_dashboards: a.sources.map(s => s.official_url).join(' | '),
  };
});

// Shown agencies first, largest first; hidden ones after, so the file opens on
// what the site actually publishes.
rows.sort((a, b) =>
  (a.shown_on_site === b.shown_on_site ? 0 : a.shown_on_site === 'yes' ? -1 : 1)
  || b.reported_flights - a.reported_flights);

const headers = Object.keys(rows[0]);
const csv = [headers.join(','), ...rows.map(r => headers.map(h => q((r as Record<string, unknown>)[h])).join(','))];

mkdirSync(join('research', 'census'), { recursive: true });
const out = join('research', 'census', 'agencies.csv');
writeFileSync(out, csv.join('\r\n') + '\r\n');

const shown = rows.filter(r => r.shown_on_site === 'yes');
const multi = rows.filter(r => r.platforms.includes('+'));
console.log(`${out}: ${rows.length} agencies — ${shown.length} shown, ${rows.length - shown.length} hidden`);
console.log(`${multi.length} publish on more than one platform`);
console.log(`${shown.reduce((t, r) => t + r.reported_flights, 0).toLocaleString('en-US')} reported flights on the site`);
