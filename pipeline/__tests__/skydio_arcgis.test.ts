import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapSkydioAttributes, fetchAllFeatures, featureLayerUrl, discoverSkydioDashboards, layerExtentCenter, skydioAdapter } from '../adapters/skydio_arcgis.js';
import type { RegistryAgency } from '../registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n: string) => JSON.parse(readFileSync(join(here, 'fixtures', n), 'utf8'));
const ORG = 'b438cee6-dca6-4104-ac75-c9b5f4c9c567';

describe('mapSkydioAttributes', () => {
  const rows = fx('skydio_page.json').features.map((f: any) => f.attributes);
  it('maps a complete row', () => {
    const r = mapSkydioAttributes(rows[0], 'milwaukee-pd', 'America/Chicago');
    expect(r).toEqual({
      agency_id: 'milwaukee-pd', source_flight_id: '83700711-b12a-451b-a114-d4281b4c26da',
      takeoff_utc: '2025-03-09T05:58:09.198Z', flight_date_local: '2025-03-08', landing_utc: '2025-03-09T06:17:27.260Z',
      duration_min: 19.3, purpose: 'Event Management', description: 'Shamrock Shuffle', case_number: 'P2503080355',
      extra: {}, data_quality: null,
    });
  });
  it('flags epoch-zero takeoff and blank strings become null', () => {
    const r = mapSkydioAttributes(rows[1], 'milwaukee-pd', 'America/Chicago');
    expect(r.takeoff_utc).toBeNull(); expect(r.flight_date_local).toBeNull(); expect(r.landing_utc).toBeNull(); expect(r.duration_min).toBeNull();
    expect(r.case_number).toBeNull();
    expect(r.data_quality).toBe('missing_takeoff;missing_landing');
  });
  it('never carries identity fields', () => {
    const r = mapSkydioAttributes({ ...rows[0], user_email: 'pilot@city.gov' }, 'x', 'UTC') as any;
    expect(r.user_email).toBeUndefined(); expect(JSON.stringify(r)).not.toMatch(/pilot@/);
  });
});

describe('fetchAllFeatures', () => {
  it('paginates until a short page and forwards ArcGIS errors', async () => {
    const page = fx('skydio_page.json');
    const full = { features: Array.from({ length: 1000 }, (_, i) => ({ attributes: { ...page.features[0].attributes, ObjectId: i, flight_id: 'f' + i } })) };
    const urls: string[] = [];
    const fj = async (u: string) => { urls.push(u); return u.includes('resultOffset=0&') ? full : page; };
    const rows = await fetchAllFeatures(fj, featureLayerUrl(ORG));
    expect(rows.length).toBe(1002);
    expect(urls.length).toBe(2);
    expect(urls[0]).toContain('returnGeometry=false');
    expect(urls[0]).toContain(`${ORG}-production/FeatureServer/0/query`);
    expect(urls[1]).toContain('resultOffset=1000&');
    await expect(fetchAllFeatures(async () => ({ error: { code: 400, message: 'bad' } }), featureLayerUrl(ORG))).rejects.toThrow(/ArcGIS error/);
  });
});

describe('discoverSkydioDashboards', () => {
  it('lists dashboards in the Skydio org and resolves org uuids through the web map', async () => {
    const fj = async (u: string) => {
      if (u.includes('/sharing/rest/search')) return fx('arcgis_search.json');
      if (u.includes('/items/81fc8f0745944ddfbf773850cf28eca8/data')) return fx('arcgis_dashboard_data.json');
      if (u.includes('/items/46c00955a6a34935879f71a87f5934e0/data')) return { widgets: [] };
      if (u.includes('/items/978dcbe2ba40406aa545ba2abc25bc5f?')) return fx('arcgis_webmap_item.json');
      throw new Error('unexpected ' + u);
    };
    const d = await discoverSkydioDashboards(fj);
    const MOD = new Date(1756300000000).toISOString();
    expect(d).toEqual([
      { item_id: '81fc8f0745944ddfbf773850cf28eca8', title: 'Milwaukee Police Department', org_uuid: ORG, modified: MOD },
      { item_id: '46c00955a6a34935879f71a87f5934e0', title: '[TEMPLATE] Skydio Transparency Dashboard', org_uuid: null, modified: MOD },
    ]);
  });
});

describe('layerExtentCenter', () => {
  it('returns the center of a 4326 extent, null when missing', async () => {
    expect(await layerExtentCenter(async () => fx('skydio_layer_meta.json'), ORG)).toEqual({ lon: -87.955, lat: 43.055 });
    expect(await layerExtentCenter(async () => ({ name: 'Operation' }), ORG)).toBeNull();
    expect(await layerExtentCenter(async () => ({ extent: { xmin: 'NaN', ymin: 'NaN', xmax: 'NaN', ymax: 'NaN', spatialReference: { wkid: 4326 } } }), ORG)).toBeNull();
  });
});

describe('skydioAdapter.pull', () => {
  const agency: RegistryAgency = {
    agency_id: 'okc-pd', display_name: 'OKC', state: 'OK', org_type: 'law_enforcement', timezone: 'America/Chicago', source: 'skydio_arcgis',
    source_config: { orgs: [{ org_uuid: 'u1', dashboard_item_id: 'd1', title: 'a' }, { org_uuid: 'u2', dashboard_item_id: 'd2', title: 'b' }], vanity_slug: null },
    official_url: '', status: 'ok', first_flight: null, last_flight: null, flight_count: 0, total_hours: 0, last_pulled_utc: null, notes: null,
  };
  it('merges multiple orgs and de-duplicates on flight_id', async () => {
    const page = fx('skydio_page.json');
    const fj = async () => page; // both orgs return the same two flights
    const recs = await skydioAdapter.pull(agency, fj);
    expect(recs.length).toBe(2);
    expect(recs.every(r => r.agency_id === 'okc-pd')).toBe(true);
  });
});
