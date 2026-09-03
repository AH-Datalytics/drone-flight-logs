import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { feature } from 'topojson-client';
import { geoContains } from 'd3-geo';
import type { FeatureCollection, Geometry } from 'geojson';

/**
 * A point on the map for each agency, and the state it sits in.
 *
 * The site stores no flight geometry, so there was nothing to put on a map.
 * This derives one coarse point per agency instead — where the department is,
 * not where any drone went — and caches it, so a run never re-fetches a
 * location it already knows.
 *
 * Three ways to find it, in order of how much they can be trusted:
 *
 *   1. Skydio publishes each dashboard as a map service whose extent is the
 *      box its flights fall inside. The center of that box is the agency's own
 *      account of where it operates, and it costs one request to nobody else.
 *   2. A Flock dashboard's hostname carries the municipality and state, which
 *      geocodes cleanly.
 *   3. Otherwise the agency's name and state are geocoded.
 *
 * The state is then read off the point rather than the name, which is how the
 * eighty-one agencies whose dashboard titles never mentioned a state get one:
 * a title like "Rochester Police Department - MN" is easy, but "Aurora PD"
 * could be Colorado or Illinois and the coordinate settles it.
 */

export type Place = {
  agency_id: string;
  lat: number;
  lon: number;
  state: string | null;
  /** How the point was found, so a wrong dot can be traced to its cause. */
  via: 'skydio_extent' | 'geocode_host' | 'geocode_name' | 'manual';
  query: string | null;
  resolved_utc: string;
};

export type PlaceFile = { note: string; places: Place[] };

const PLACES_PATH = join('data', 'agency_places.json');
const STATES_PATH = join('data', 'us-states-10m.json');

/** Two-letter codes, since the outline file names states in full. */
const STATE_CODES: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT',
  Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
  'Puerto Rico': 'PR',
};

let statesCache: FeatureCollection<Geometry, { name: string }> | null = null;

export function statesGeo(): FeatureCollection<Geometry, { name: string }> {
  if (!statesCache) {
    const topo = JSON.parse(readFileSync(STATES_PATH, 'utf8'));
    statesCache = feature(topo, topo.objects.states) as unknown as FeatureCollection<Geometry, { name: string }>;
  }
  return statesCache;
}

/** The state a coordinate falls in, or null for a point outside the country. */
export function stateForPoint(lon: number, lat: number): string | null {
  for (const f of statesGeo().features) {
    if (geoContains(f, [lon, lat])) return STATE_CODES[f.properties.name] ?? null;
  }
  return null;
}

export function loadPlaces(): Map<string, Place> {
  if (!existsSync(PLACES_PATH)) return new Map();
  const file = JSON.parse(readFileSync(PLACES_PATH, 'utf8')) as PlaceFile;
  return new Map(file.places.map(p => [p.agency_id, p]));
}

export function savePlaces(places: Map<string, Place>): void {
  const sorted = [...places.values()].sort((a, b) => a.agency_id.localeCompare(b.agency_id));
  writeFileSync(PLACES_PATH, JSON.stringify({
    note: 'One coarse point per agency, for the map. Derived from each Skydio dashboard\'s own published extent where possible, otherwise geocoded from the municipality. Not flight geometry: no flight path or per-flight location is stored anywhere in this project. Cached so a run never re-fetches a location it already has.',
    places: sorted,
  }, null, 1) + '\n');
}

/** The bounding box of a Skydio dashboard's map service, centerd. */
export async function skydioExtentCenter(orgUuid: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://services7.arcgis.com/mnhQTdIYDA7UoY2l/arcgis/rest/services/${orgUuid}-production/FeatureServer/0?f=json`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'police-drone-logs pipeline', accept: 'application/json' } });
    if (!res.ok) return null;
    const j = await res.json() as { extent?: { xmin: number; ymin: number; xmax: number; ymax: number; spatialReference?: { wkid?: number } } };
    const e = j.extent;
    if (!e || e.spatialReference?.wkid !== 4326) return null;
    if (![e.xmin, e.ymin, e.xmax, e.ymax].every(Number.isFinite)) return null;
    const lon = (e.xmin + e.xmax) / 2, lat = (e.ymin + e.ymax) / 2;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
    // A dashboard with no flights reports a degenerate or world-sized extent.
    if (e.xmax - e.xmin > 60 || e.ymax - e.ymin > 40) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

/**
 * The place part of an agency's name: what is left after the words every
 * department shares. "Elk Grove Police Department" gives "Elk Grove".
 */
export function placeFromName(name: string): string {
  return name
    .replace(/\bpolice department\b|\bpolice dept\b|\bpolice dpt\b|\bpolice\b/gi, '')
    .replace(/\bsheriff'?s? office\b|\bsheriff'?s? department\b|\bsheriff\b/gi, '')
    .replace(/\bfire district\b|\bfire department\b|\bfire rescue\b|\bfire\b/gi, '')
    .replace(/\b(pd|so|dps|uas|suas|dfr|rtic|beta|unit|division|bureau|department|dept)\b/gi, '')
    .replace(/\breal-?time crime cent(er|re)\b/gi, '')
    .replace(/\bemergency services\b/gi, '')
    .replace(/\b(city|town|village|county) of\b/gi, '')
    .replace(/\s*-\s*[A-Z]{2}\s*$/, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[^A-Za-z0-9\s'.-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The municipality a Flock dashboard hostname is issued for. */
export function placeFromFlockHost(host: string): { place: string; state: string | null } {
  const parts = host.split('.');
  const place = (parts[1] ?? '').replace(/-/g, ' ').replace(/\d+$/, '').trim();
  const st = (parts[2] ?? '').toUpperCase();
  return { place, state: /^[A-Z]{2}$/.test(st) ? st : null };
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Geocode one place through OpenStreetMap's Nominatim.
 *
 * Its usage policy asks for an identifiable client and no more than one
 * request a second, both of which this honors. Results are cached to disk, so
 * the service is asked once per agency for the life of the project.
 */
export async function geocode(query: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'police-drone-logs/1.0 (public drone flight log explorer)', accept: 'application/json' },
    });
    if (!res.ok) return null;
    const j = await res.json() as { lat: string; lon: string }[];
    if (!Array.isArray(j) || j.length === 0) return null;
    const lat = Number(j[0].lat), lon = Number(j[0].lon);
    return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  } catch {
    return null;
  }
}

export type ResolveTarget = {
  agency_id: string;
  display_name: string;
  state: string | null;
  skydio_org_uuid: string | null;
  flock_host: string | null;
};

export async function resolvePlaces(targets: ResolveTarget[], log: (m: string) => void = console.log): Promise<Map<string, Place>> {
  const places = loadPlaces();
  const todo = targets.filter(t => !places.has(t.agency_id));
  log(`${places.size} agencies already located, ${todo.length} to resolve`);

  let viaExtent = 0, viaGeocode = 0, unresolved: string[] = [];

  for (const [i, t] of todo.entries()) {
    let found: { lat: number; lon: number } | null = null;
    let via: Place['via'] = 'geocode_name';
    let query: string | null = null;

    if (t.skydio_org_uuid) {
      found = await skydioExtentCenter(t.skydio_org_uuid);
      if (found) { via = 'skydio_extent'; viaExtent++; }
    }

    if (!found && t.flock_host) {
      const { place, state } = placeFromFlockHost(t.flock_host);
      query = [place, state, 'USA'].filter(Boolean).join(', ');
      found = await geocode(query);
      if (found) { via = 'geocode_host'; viaGeocode++; }
      await sleep(1100);
    }

    if (!found) {
      const place = placeFromName(t.display_name);
      query = [place, t.state, 'USA'].filter(Boolean).join(', ');
      if (place) {
        found = await geocode(query);
        if (found) { via = 'geocode_name'; viaGeocode++; }
        await sleep(1100);
      }
    }

    if (!found) { unresolved.push(`${t.agency_id} (${t.display_name})`); continue; }

    places.set(t.agency_id, {
      agency_id: t.agency_id,
      lat: Math.round(found.lat * 1e5) / 1e5,
      lon: Math.round(found.lon * 1e5) / 1e5,
      state: stateForPoint(found.lon, found.lat) ?? t.state ?? null,
      via, query, resolved_utc: new Date().toISOString(),
    });

    if ((i + 1) % 25 === 0) { savePlaces(places); log(`  ${i + 1} of ${todo.length} resolved`); }
  }

  savePlaces(places);
  log(`located ${places.size} agencies: ${viaExtent} from a dashboard's own extent, ${viaGeocode} geocoded`);
  if (unresolved.length) log(`could not locate ${unresolved.length}: ${unresolved.slice(0, 12).join(', ')}${unresolved.length > 12 ? ' …' : ''}`);
  return places;
}
