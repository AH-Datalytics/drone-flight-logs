import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One row for every place drone flight data is published, or might be.
 *
 * The point of this file is the second half of that sentence. A list of what
 * has been collected is easy; what is useful to anyone extending this work is
 * the full picture, including the dashboards that exist but publish nothing,
 * the ones whose owner could not be identified, and the leads that press
 * coverage names but that no search has yet located. Those are the rows that
 * say where to look next.
 *
 * Regenerate with: npx tsx scripts/census-csv.ts
 */

type Row = {
  agency: string;
  state: string;
  platform: string;
  status: string;
  flights: string;
  first_flight: string;
  last_flight: string;
  url: string;
  notes: string;
};

const DATA = 'data';
const read = <T,>(p: string, fallback: T): T => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) as T : fallback);

/**
 * Status vocabulary, chosen so a reader can sort the file by how much work a
 * row still needs:
 *   collected              — data is in the site
 *   live, nothing yet      — the dashboard works but publishes no flights
 *   provisioned, not live  — the vendor issued a hostname that does not resolve
 *   owner unidentified     — a real dashboard whose agency could not be named
 *   retired                — the dashboard existed and is gone
 *   lead, not located      — named in press or vendor material, URL not found
 *   out of scope           — real data, deliberately not collected
 */
function rows(): Row[] {
  const out: Row[] = [];
  const site = read<{ agencies: any[] }>(join(DATA, 'site', 'agencies.json'), { agencies: [] });
  const bySourceAgency = new Map<string, any>();
  for (const a of site.agencies) for (const s of a.sources) bySourceAgency.set(`${s.source}:${s.source_agency_id}`, s);

  const lookup = (source: string, id: string) => bySourceAgency.get(`${source}:${id}`);

  // --- Skydio, and San Francisco's own open-data publication ---
  for (const a of read<{ agencies: any[] }>(join(DATA, 'registry.json'), { agencies: [] }).agencies) {
    const s = lookup(a.source, a.agency_id);
    const platform = a.source === 'sfpd_datasf' ? 'City open data (DataSF)' : 'Skydio';
    out.push({
      agency: a.display_name,
      state: a.state ?? '',
      platform,
      status: a.status === 'needs_review' ? 'owner unidentified' : a.status === 'retired' ? 'retired' : (s?.flight_count ?? a.flight_count) > 0 ? 'collected' : 'live, nothing yet',
      flights: String(s?.flight_count ?? a.flight_count ?? 0),
      first_flight: s?.first_flight ?? a.first_flight ?? '',
      last_flight: s?.last_flight ?? a.last_flight ?? '',
      url: a.official_url,
      notes: a.status === 'needs_review'
        ? 'Dashboard is real; which agency publishes it is unconfirmed, so it is not shown on the site.'
        : platform === 'Skydio' ? 'Skydio aircraft only.' : 'Whole fleet. Date but no time of day.',
    });
  }

  // --- Flock Aerodome: live dashboards, then hostnames that never came up ---
  const flockState = read<{ agencies: Record<string, any> }>(join(DATA, 'raw', 'flock', '_state.json'), { agencies: {} });
  const flockSites = read<{ sites: any[] }>(join(DATA, 'flock_sites.json'), { sites: [] }).sites;
  for (const s of flockSites) {
    const st = flockState.agencies[s.agency_id];
    const merged = lookup('flock_aerodome', s.agency_id);
    const stored = st?.total_flights ?? 0;
    out.push({
      agency: s.display_name,
      state: s.state ?? '',
      platform: 'Flock Aerodome',
      status: stored > 0 ? 'collected' : st ? 'live, nothing yet' : 'collected',
      flights: String(merged?.flight_count ?? stored),
      first_flight: merged?.first_flight ?? '',
      last_flight: merged?.last_flight ?? '',
      url: s.url,
      notes: 'Richest source: call type, case number, priority, block-level address. Default view shows about a month; history reachable by date range.',
    });
  }
  for (const host of read<string[]>(join('research', 'census', 'flock-dead-hosts.json'), [])) {
    out.push({
      agency: hostToName(host), state: stateFromHost(host), platform: 'Flock Aerodome',
      status: 'provisioned, not live', flights: '', first_flight: '', last_flight: '',
      url: `https://${host}/`,
      notes: 'The vendor issued a certificate for this hostname but it does not resolve or returns not-found. Worth re-checking later: it may be a dashboard that has not launched.',
    });
  }

  // --- AirData ---
  const airState = read<{ agencies: Record<string, any> }>(join(DATA, 'raw', 'airdata', '_state.json'), { agencies: {} });
  for (const s of read<{ sites: any[] }>(join(DATA, 'airdata_sites.json'), { sites: [] }).sites) {
    const st = airState.agencies[s.agency_id];
    const merged = lookup('airdata', s.agency_id);
    const months = st ? Object.keys(st.months ?? {}) : [];
    const published = st ? Object.values(st.months ?? {}).reduce((t: number, m: any) => t + (m.published ?? 0), 0) : 0;
    out.push({
      agency: s.display_name, state: s.state ?? '', platform: 'AirData',
      status: (st?.total_flights ?? 0) > 0 ? 'collected' : 'live, nothing yet',
      flights: String(merged?.flight_count ?? st?.total_flights ?? 0),
      first_flight: merged?.first_flight ?? (months.length ? months.sort()[0] : ''),
      last_flight: merged?.last_flight ?? '',
      url: `https://app.airdata.com/u/${s.slug}`,
      notes: `No flight durations published.${published ? ` Portal states ${published.toLocaleString('en-US')} flights across ${months.length} months.` : ''}`,
    });
  }

  // --- Motorola CAPE ---
  const capeState = read<{ agencies: Record<string, any> }>(join(DATA, 'raw', 'cape', '_state.json'), { agencies: {} });
  for (const s of read<{ sites: any[] }>(join(DATA, 'cape_sites.json'), { sites: [] }).sites) {
    const st = capeState.agencies[s.agency_id];
    const merged = lookup('motorola_cape', s.agency_id);
    const window = st?.window_days === null ? 'Publishes full history.' : st ? `Rolling ${st.window_days}-day window: flights age out of the source permanently.` : '';
    out.push({
      agency: s.display_name, state: s.state ?? '', platform: 'Motorola CAPE',
      status: (st?.total_flights ?? 0) > 0 ? 'collected' : 'live, nothing yet',
      flights: String(merged?.flight_count ?? st?.total_flights ?? 0),
      first_flight: merged?.first_flight ?? '', last_flight: merged?.last_flight ?? '',
      url: `https://www.aerial.motorolasolutions.com/transparency/${s.slug}`,
      notes: window + (st && st.total_flights === 0 ? ' Feed is currently empty; a future run will pick up new flights.' : ''),
    });
  }

  return [...out, ...CURATED];
}

function hostToName(host: string): string {
  const city = host.split('.')[1] ?? host;
  return city.replace(/-/g, ' ').replace(/\b[a-z]/g, c => c.toUpperCase());
}
function stateFromHost(host: string): string {
  const part = host.split('.')[2] ?? '';
  return /^[a-z]{2}$/.test(part) ? part.toUpperCase() : '';
}

/**
 * Sources found during the census that no data file describes: agencies that
 * publish their own flight logs outside any vendor, and leads that are named
 * somewhere but whose dashboard has not been located.
 */
const CURATED: Row[] = [
  { agency: 'Bloomington Police Department', state: 'IL', platform: 'Self-published (ArcGIS)', status: 'not yet collected', flights: '458', first_flight: '', last_flight: '', url: 'https://services3.arcgis.com/8EQ1HhogM827boPC/arcgis/rest/services/Police_Drone_Flights/FeatureServer/0', notes: 'Per-flight rows with start and end times. Also publishes on Skydio, so this would merge into the existing agency.' },
  { agency: 'Scott County (multi-agency)', state: 'IA', platform: 'Self-published (ArcGIS)', status: 'not yet collected', flights: '334', first_flight: '', last_flight: '', url: 'https://services.arcgis.com/ovln19YRWV44nBqV/arcgis/rest/services/SC_Drone_Flights/FeatureServer/0', notes: 'County-wide, several agencies in one table with a Department column. Includes training hours.' },
  { agency: 'City of Yuma', state: 'AZ', platform: 'Self-published (ArcGIS)', status: 'not yet collected', flights: '222', first_flight: '', last_flight: '', url: 'https://services1.arcgis.com/tzW2OKwR84ufoH3y/arcgis/rest/services/City_of_Yuma_Drone_Flights_2_view/FeatureServer/0', notes: 'City-wide including police; a Department column separates them. Carries operator names, which would be dropped.' },
  { agency: 'Medford Police Department', state: 'OR', platform: 'Self-published (ArcGIS)', status: 'not yet collected', flights: '', first_flight: '', last_flight: '', url: 'https://www.arcgis.com/apps/dashboards/ebd0652bbefd420ea390974eb0a0047a', notes: 'Per-flight rows: case number, date, incident type.' },
  { agency: 'Roselle Police Department', state: 'IL', platform: 'Self-published (ArcGIS)', status: 'not yet collected', flights: '', first_flight: '', last_flight: '', url: 'https://www.arcgis.com/apps/dashboards/4850e50ec6a24f20bad3bf18c387e09b', notes: 'Per-flight rows including total flight duration and type of call.' },
  { agency: 'Sedona Fire District', state: 'AZ', platform: 'Self-published (ArcGIS)', status: 'not yet collected', flights: '', first_flight: '', last_flight: '', url: 'https://www.arcgis.com/home/item.html?id=sedona-fire-uav', notes: 'Fire, not police. Last updated 2022. Contains pilot names, which would have to be dropped.' },
  { agency: 'City of Bloomington', state: 'IN', platform: 'Self-published (Socrata)', status: 'not yet collected', flights: '', first_flight: '', last_flight: '', url: 'https://data.bloomington.in.gov/resource/3a7f-6kb4.json', notes: 'City-wide, mostly IT and GIS rather than police. 2020 era.' },
  { agency: 'City and County of Denver', state: 'CO', platform: 'Self-published (ArcGIS)', status: 'not yet collected', flights: '25', first_flight: '', last_flight: '', url: 'https://www.arcgis.com/home/item.html?id=denver-uas-missions', notes: 'City GIS mission log, low volume. Denver PD proper publishes on Skydio and Flock.' },
  { agency: 'Ohio Department of Transportation', state: 'OH', platform: 'Self-published (Power BI)', status: 'out of scope', flights: '1912', first_flight: '', last_flight: '', url: 'https://app.powerbi.com/view?r=eyJrIjoiMWE0MzdkMWItMTRkZi00NmRkLWFiYmEtYWJmOTdhNzk5ZTQwIiwidCI6IjZhYmJlNDI1LTkzYjYtNDUxMi04MzQ5LWI1MmE1MWYzMzUyMSJ9', notes: 'Fully readable per-flight data, but a transportation agency flying bridge inspections. Excluded by decision, not by difficulty.' },
  { agency: 'Huntsville Police Department', state: 'AL', platform: 'AirData (reported)', status: 'lead, not located', flights: '', first_flight: '', last_flight: '', url: '', notes: 'Named in press coverage as publishing through AirData. Twenty-two slug guesses all returned empty pages.' },
  { agency: 'Reno Police Department', state: 'NV', platform: 'Unknown', status: 'lead, not located', flights: '', first_flight: '', last_flight: '', url: '', notes: 'Press reports a live transparency dashboard with over 11,000 deployments and flight-path maps promised. No public URL found on the city site yet. High value: re-check.' },
  { agency: 'Salt Lake City Police Department', state: 'UT', platform: 'Unknown', status: 'lead, not located', flights: '', first_flight: '', last_flight: '', url: '', notes: 'Department page says a drone dashboard is coming soon.' },
  { agency: 'Metropolitan Police Department', state: 'DC', platform: 'Unknown', status: 'lead, not located', flights: '', first_flight: '', last_flight: '', url: '', notes: 'Publishes a UAS program page; no per-flight log located.' },
  { agency: 'Santa Clara Police Department', state: 'CA', platform: 'Unknown', status: 'lead, not located', flights: '', first_flight: '', last_flight: '', url: '', notes: 'Publishes UAS deployment summaries; no per-flight log located.' },
  { agency: 'Montgomery County Police Department', state: 'MD', platform: 'DroneSense', status: 'retired', flights: '', first_flight: '', last_flight: '', url: 'https://dashboard.dronesense.com/MCPDDFR', notes: 'DroneSense dashboards are dead across every known slug. This agency now publishes on Skydio instead.' },
  { agency: 'Campbell Police Department', state: 'CA', platform: 'DroneSense', status: 'retired', flights: '', first_flight: '', last_flight: '', url: 'https://dashboard.dronesense.com/campbellpddfr', notes: 'Page not found; no data.' },
  { agency: 'Fremont Police Department', state: 'CA', platform: 'DroneSense', status: 'retired', flights: '', first_flight: '', last_flight: '', url: 'https://dashboard.dronesense.com/fremontpublicsafetydfr', notes: 'Page not found; no data.' },
  { agency: 'Oswego County', state: 'NY', platform: 'DroneSense', status: 'retired', flights: '', first_flight: '', last_flight: '', url: 'https://dashboard.dronesense.com/oswegocountyuas', notes: 'Page not found; no data.' },
  { agency: 'Any agency using Flock Safety transparency', state: '', platform: 'Flock Safety (flocksafety.com)', status: 'lead, not located', flights: '', first_flight: '', last_flight: '', url: 'https://transparency.flocksafety.com/', notes: 'Separate from Aerodome and behind a login. Mostly license-plate reader data rather than drone flights.' },
  { agency: 'Any agency using Fusus', state: '', platform: 'Fusus (Axon)', status: 'lead, not located', flights: '', first_flight: '', last_flight: '', url: 'https://trust.fusus.com/', notes: 'Transparency portals exist but are not publicly enumerable and did not expose per-flight drone logs.' },
];

const CSV_HEADERS: (keyof Row)[] = ['agency', 'state', 'platform', 'status', 'flights', 'first_flight', 'last_flight', 'url', 'notes'];

function quote(v: string): string {
  return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

const STATUS_ORDER = ['collected', 'not yet collected', 'live, nothing yet', 'owner unidentified', 'provisioned, not live', 'lead, not located', 'retired', 'out of scope'];

function main(): void {
  const all = rows().sort((a, b) => {
    const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (s !== 0) return s;
    const f = Number(b.flights || 0) - Number(a.flights || 0);
    if (f !== 0) return f;
    return a.agency.localeCompare(b.agency);
  });

  const lines = [CSV_HEADERS.join(','), ...all.map(r => CSV_HEADERS.map(h => quote(r[h] ?? '')).join(','))];
  mkdirSync(join('research', 'census'), { recursive: true });
  const path = join('research', 'census', 'drone-data-sources.csv');
  writeFileSync(path, lines.join('\r\n') + '\r\n');

  const counts: Record<string, number> = {};
  for (const r of all) counts[r.status] = (counts[r.status] ?? 0) + 1;
  console.log(`${path}: ${all.length} rows`);
  for (const s of STATUS_ORDER) if (counts[s]) console.log(`  ${s}: ${counts[s]}`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/census-csv.ts');
if (isMain) main();
