import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolvePlaces, type ResolveTarget } from '../pipeline/places.js';

/**
 * Find a point for every agency that does not have one yet.
 *
 * Run after new dashboards are added. It is cached and additive: agencies
 * already located are skipped, so re-running costs nothing and never asks a
 * geocoder for a place it has seen before.
 */

const DATA = 'data';
const read = <T,>(p: string): T => JSON.parse(readFileSync(join(DATA, p), 'utf8')) as T;

function targets(): ResolveTarget[] {
  const out: ResolveTarget[] = [];

  for (const a of read<{ agencies: any[] }>('registry.json').agencies) {
    if (a.status === 'needs_review') continue;
    out.push({
      agency_id: a.agency_id,
      display_name: a.display_name,
      state: a.state ?? null,
      skydio_org_uuid: a.source === 'skydio_arcgis' ? (a.source_config.orgs?.[0]?.org_uuid ?? null) : null,
      flock_host: null,
    });
  }
  for (const s of read<{ sites: any[] }>('flock_sites.json').sites) {
    out.push({ agency_id: s.agency_id, display_name: s.display_name, state: s.state ?? null, skydio_org_uuid: null, flock_host: s.host });
  }
  for (const f of ['airdata_sites.json', 'cape_sites.json', 'selfpub_sites.json']) {
    for (const s of read<{ sites: any[] }>(f).sites) {
      out.push({ agency_id: s.agency_id, display_name: s.display_name, state: s.state ?? null, skydio_org_uuid: null, flock_host: null });
    }
  }
  return out;
}

await resolvePlaces(targets());
