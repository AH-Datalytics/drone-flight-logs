import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchJson } from './http.js';
import { discoverSkydioDashboards, layerExtentCenter } from './adapters/skydio_arcgis.js';
import { timezoneForPoint } from './time.js';
import { cleanTitle, stateFromTitle, guessOrgType, slugify, dashboardUrl, saveRegistry, saveExcluded, type Registry, type RegistryAgency, type ExcludedOrg, type DiscoveredDashboard, type OrgType } from './registry.js';

export type SeedRow = { agency: string; org_type: OrgType; state_hint: string; vanity_url: string; vanity_page_enabled: string; dashboard_url: string; skydio_org_id: string };

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseSeedCsv(text: string): Map<string, SeedRow> {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  const header = parseCsvLine(lines[0]);
  const idx = (n: string) => header.indexOf(n);
  const m = new Map<string, SeedRow>();
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    const row: SeedRow = { agency: c[idx('agency')], org_type: c[idx('org_type')] as OrgType, state_hint: c[idx('state_hint')], vanity_url: c[idx('vanity_url')], vanity_page_enabled: c[idx('vanity_page_enabled')], dashboard_url: c[idx('dashboard_url')], skydio_org_id: c[idx('skydio_org_id')] };
    if (row.skydio_org_id) m.set(row.skydio_org_id, row);
  }
  return m;
}

const INTERNAL = [
  /^\s*\[?(int|lnt)\b/i, /^int-/i, /\[paraverse\]/i, /^paraverse -/i, /\[template\]/i, /\[vincent/i, /vincent prototype/i,
  /dfr summit/i, /synthetic transparency/i, /dev test/i, /^skydio transparency dashboard/i, /axon demo sim/i, /^new dashboard:/i,
  /^jp-int/i, /^joejoe/i, /dfr 2025 ascend/i, /^digital systems \(mx\)/i,
];
export function isInternalTitle(title: string): boolean {
  const t = title.trim();
  return INTERNAL.some(re => re.test(t));
}

// cleanTitle only strips a "(XX)" state parenthetical when it sits at the very end of the string.
// A few CSV/dashboard names carry it mid-string instead (e.g. "Glendale Police Department (CA) -
// Trial", "Lewisville Police Department (TX) DFR") — cleanTitle correctly leaves those alone since
// it can't know (CA) is the same value as the separately-derived `state` rather than a meaningful
// part of the name (contrast "Tennessee Department of Transportation (TDOT)", which must NOT be
// touched). Once `state` is known, though, any literal "(STATE)" left in the name is provably
// redundant with it, so it is safe to remove here.
function stripRedundantStateParen(name: string, state: string | null): string {
  if (!state) return name;
  return name.replace(new RegExp(`\\s*\\(${state}\\)\\s*`, 'g'), ' ').replace(/\s+/g, ' ').trim();
}

export function buildSeedRegistry(discovered: DiscoveredDashboard[], seed: Map<string, SeedRow>, extents: Map<string, { lon: number; lat: number } | null>, now: Date): { registry: Registry; excluded: ExcludedOrg[] } {
  const agencies: RegistryAgency[] = [];
  const excluded: ExcludedOrg[] = [];
  const taken = new Set<string>(['sfpd']);
  const byOrg = new Map<string, RegistryAgency>();

  for (const d of discovered) {
    if (isInternalTitle(d.title)) { excluded.push({ dashboard_item_id: d.item_id, org_uuid: d.org_uuid, title: d.title.trim(), reason: 'skydio internal or demo (title pattern)' }); continue; }
    if (!d.org_uuid) { excluded.push({ dashboard_item_id: d.item_id, org_uuid: null, title: d.title.trim(), reason: 'no feature service resolvable from dashboard' }); continue; }
    const existing = byOrg.get(d.org_uuid);
    if (existing && existing.source === 'skydio_arcgis') { (existing.source_config as any).orgs.push({ org_uuid: d.org_uuid, dashboard_item_id: d.item_id, title: d.title.trim() }); continue; }

    const s = seed.get(d.org_uuid);
    // cleanTitle strips a trailing "(XX)" state parenthetical (among other suffixes). The CSV's
    // `agency` column already carries that parenthetical for many rows, so it must go through the
    // same strip as a discovered dashboard title does — otherwise the state gets appended a second
    // time below (slugify(name + ' ' + state)), producing doubled-state slugs like `-wi-wi` and
    // display names like "Appleton Police Department (WI)".
    const state = (s?.state_hint || stateFromTitle(d.title)) || null;
    const name = stripRedundantStateParen(cleanTitle(s?.agency ?? d.title), state);
    const id = slugify(state ? `${name} ${state}` : name, taken);
    const ext = extents.get(d.org_uuid) ?? null;
    const tz = ext ? timezoneForPoint(ext.lon, ext.lat) : null;
    const vanity = s?.vanity_url?.match(/dashboard\/([^/?#]+)/)?.[1] ?? null;
    const notes: string[] = [];
    if (!tz) notes.push('timezone not detected automatically; set manually');
    if (s?.vanity_page_enabled === 'false') notes.push('Skydio vanity page is toggled off by the agency; ArcGIS dashboard remains public');
    const a: RegistryAgency = {
      agency_id: id, display_name: name, state, org_type: s?.org_type ?? guessOrgType(name), timezone: tz ?? 'UTC',
      source: 'skydio_arcgis', source_config: { orgs: [{ org_uuid: d.org_uuid, dashboard_item_id: d.item_id, title: d.title.trim() }], vanity_slug: vanity },
      official_url: vanity && s?.vanity_page_enabled === 'true' ? s.vanity_url : dashboardUrl(d.item_id),
      status: s ? 'ok' : 'needs_review',
      first_flight: null, last_flight: null, flight_count: 0, total_hours: 0, last_pulled_utc: null, notes: notes.length ? notes.join('. ') + '.' : null,
    };
    agencies.push(a); byOrg.set(d.org_uuid, a);
  }

  agencies.push({
    agency_id: 'sfpd', display_name: 'San Francisco Police Department', state: 'CA', org_type: 'law_enforcement', timezone: 'America/Los_Angeles',
    source: 'sfpd_datasf', source_config: { domain: 'data.sfgov.org', dataset_id: 'giw5-ttjs' },
    official_url: 'https://www.sanfranciscopolice.org/your-sfpd/explore-department/drones', status: 'ok',
    first_flight: null, last_flight: null, flight_count: 0, total_hours: 0, last_pulled_utc: null,
    notes: 'Published by the city under its surveillance ordinance, not through a vendor. Covers SFPD\'s whole fleet (DJI, Skydio, Flock Safety and others), whereas Skydio-sourced agencies show Skydio flights only. Dates only; no takeoff times.',
  });
  return { registry: { agencies }, excluded };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  (async () => {
    const dataDir = join(process.cwd(), 'data');
    mkdirSync(join(dataDir, 'flights'), { recursive: true });
    const seed = parseSeedCsv(readFileSync(join(dataDir, 'seed', 'skydio-agency-summary-2026-09-01.csv'), 'utf8'));
    console.log(`seed rows: ${seed.size}`);
    const discovered = await discoverSkydioDashboards(fetchJson);
    console.log(`discovered dashboards: ${discovered.length}`);
    const extents = new Map<string, { lon: number; lat: number } | null>();
    for (const d of discovered) if (d.org_uuid && !extents.has(d.org_uuid) && !isInternalTitle(d.title)) extents.set(d.org_uuid, await layerExtentCenter(fetchJson, d.org_uuid).catch(() => null));
    const { registry, excluded } = buildSeedRegistry(discovered, seed, extents, new Date());
    saveRegistry(join(dataDir, 'registry.json'), registry);
    saveExcluded(join(dataDir, 'excluded_orgs.json'), excluded);
    const counts = registry.agencies.reduce((m, a) => (m[a.status] = (m[a.status] ?? 0) + 1, m), {} as Record<string, number>);
    console.log(`registry: ${registry.agencies.length} agencies ${JSON.stringify(counts)}; excluded: ${excluded.length}`);
    console.log('UTC-fallback agencies:', registry.agencies.filter(a => a.timezone === 'UTC').map(a => a.agency_id).join(', ') || 'none');
    writeFileSync(join(dataDir, 'manifest.json'), JSON.stringify({ run_utc: null, agencies: {}, added: [], retired: [], unresolved_dashboards: [] }, null, 2) + '\n');
  })().catch(e => { console.error(e); process.exit(1); });
}
