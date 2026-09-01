import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export type OrgType = 'law_enforcement' | 'fire_ems' | 'university' | 'government_other' | 'corporate_utility' | 'vendor_partner';
export type Status = 'ok' | 'stale' | 'unreachable' | 'retired' | 'needs_review';
export type SkydioOrg = { org_uuid: string; dashboard_item_id: string; title: string };
export type SkydioConfig = { orgs: SkydioOrg[]; vanity_slug: string | null };
export type SfpdConfig = { domain: string; dataset_id: string };
export type RegistryAgency = {
  agency_id: string; display_name: string; state: string | null; org_type: OrgType; timezone: string;
  source: 'skydio_arcgis' | 'sfpd_datasf'; source_config: SkydioConfig | SfpdConfig; official_url: string;
  status: Status; first_flight: string | null; last_flight: string | null; flight_count: number; total_hours: number;
  last_pulled_utc: string | null; notes: string | null;
};
export type Registry = { agencies: RegistryAgency[] };
export type ExcludedOrg = { dashboard_item_id: string; org_uuid: string | null; title: string; reason: string };
export type DiscoveredDashboard = { item_id: string; title: string; org_uuid: string | null; modified: string };

export function isSkydio(a: RegistryAgency): a is RegistryAgency & { source_config: SkydioConfig } { return a.source === 'skydio_arcgis'; }

export function cleanTitle(title: string): string {
  return title
    .replace(/\s*-\s*skydio\s*$/i, '')
    .replace(/\s*(drone as first responder( flights)?|dfr( drone)? flights|drone flights|suas flights|uas flights|flights)\s*$/i, '')
    .replace(/\s*\([A-Z]{2}\)\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stateFromTitle(title: string): string | null {
  const m = title.match(/\(([A-Z]{2})\)/);
  return m ? m[1] : null;
}

export function guessOrgType(name: string): OrgType {
  if (/fire|\bems\b|emergency services|rescue/i.test(name)) return 'fire_ems';
  if (/police|sheriff|marshal|constab|law enforcement|crime center|\bpd\b|\bdfr\b/i.test(name)) return 'law_enforcement';
  if (/universit|college|\bcsu\b|\bfsu\b|vanderbilt/i.test(name)) return 'university';
  if (/\bdot\b|dot&pf|department of transportation|county government|metro government|\bgovernment\b/i.test(name)) return 'government_other';
  if (/axon/i.test(name)) return 'vendor_partner';
  return 'corporate_utility';
}

export function slugify(name: string, taken: Set<string>): string {
  let s = name.toLowerCase()
    .replace(/police department/g, 'pd')
    .replace(/sheriff'?s? office/g, 'so')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!s) s = 'agency';
  let out = s, n = 2;
  while (taken.has(out)) out = `${s}-${n++}`;
  taken.add(out);
  return out;
}

export function dashboardUrl(itemId: string): string { return `https://www.arcgis.com/apps/dashboards/${itemId}`; }

export function mergeDiscovered(reg: Registry, discovered: DiscoveredDashboard[], excluded: ExcludedOrg[]) {
  const knownOrgs = new Set<string>();
  const knownItems = new Set<string>();
  for (const a of reg.agencies) if (isSkydio(a)) for (const o of a.source_config.orgs) { knownOrgs.add(o.org_uuid); knownItems.add(o.dashboard_item_id); }
  const excludedOrgs = new Set(excluded.map(e => e.org_uuid).filter((x): x is string => !!x));
  const excludedItems = new Set(excluded.map(e => e.dashboard_item_id));
  const taken = new Set(reg.agencies.map(a => a.agency_id));
  const added: string[] = [], unresolved: DiscoveredDashboard[] = [];
  const seenItems = new Set(discovered.map(d => d.item_id));

  for (const d of discovered) {
    if (excludedItems.has(d.item_id) || (d.org_uuid && excludedOrgs.has(d.org_uuid))) continue;
    if (knownItems.has(d.item_id) || (d.org_uuid && knownOrgs.has(d.org_uuid))) continue;
    if (!d.org_uuid) { unresolved.push(d); continue; }
    const name = cleanTitle(d.title);
    const state = stateFromTitle(d.title);
    const id = slugify(state ? `${name} ${state}` : name, taken);
    reg.agencies.push({
      agency_id: id, display_name: name, state, org_type: guessOrgType(name), timezone: 'UTC',
      source: 'skydio_arcgis', source_config: { orgs: [{ org_uuid: d.org_uuid, dashboard_item_id: d.item_id, title: d.title.trim() }], vanity_slug: null },
      official_url: dashboardUrl(d.item_id), status: 'needs_review',
      first_flight: null, last_flight: null, flight_count: 0, total_hours: 0, last_pulled_utc: null, notes: null,
    });
    knownOrgs.add(d.org_uuid); knownItems.add(d.item_id); added.push(id);
  }

  const retired: string[] = [];
  for (const a of reg.agencies) {
    if (!isSkydio(a) || a.status === 'retired' || a.status === 'needs_review') continue;
    if (a.source_config.orgs.length > 0 && a.source_config.orgs.every(o => !seenItems.has(o.dashboard_item_id))) { a.status = 'retired'; retired.push(a.agency_id); }
  }
  return { added, retired, unresolved };
}

export function mergeAgencies(reg: Registry, keepId: string, absorbId: string): void {
  const keep = reg.agencies.find(a => a.agency_id === keepId);
  const absorb = reg.agencies.find(a => a.agency_id === absorbId);
  if (!keep || !absorb) throw new Error(`mergeAgencies: missing ${!keep ? keepId : absorbId}`);
  if (!isSkydio(keep) || !isSkydio(absorb)) throw new Error('mergeAgencies: both must be skydio_arcgis');
  keep.source_config.orgs.push(...absorb.source_config.orgs);
  reg.agencies = reg.agencies.filter(a => a.agency_id !== absorbId);
}

export function loadRegistry(path: string): Registry {
  if (!existsSync(path)) return { agencies: [] };
  return JSON.parse(readFileSync(path, 'utf8')) as Registry;
}
export function saveRegistry(path: string, reg: Registry): void {
  const sorted = { agencies: [...reg.agencies].sort((a, b) => a.agency_id.localeCompare(b.agency_id)) };
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n');
}
export function loadExcluded(path: string): ExcludedOrg[] {
  if (!existsSync(path)) return [];
  return JSON.parse(readFileSync(path, 'utf8')) as ExcludedOrg[];
}
export function saveExcluded(path: string, list: ExcludedOrg[]): void {
  const sorted = [...list].sort((a, b) => a.title.localeCompare(b.title));
  writeFileSync(path, JSON.stringify(sorted, null, 2) + '\n');
}
