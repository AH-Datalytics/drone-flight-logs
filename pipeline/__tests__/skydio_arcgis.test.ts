import { describe, it, expect, vi } from 'vitest';
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
  const isCountUrl = (u: string) => u.includes('returnCountOnly=true');
  const attrOf = (page: any) => page.features[0].attributes;
  const featuresOf = (attr: any, n: number, startId: number) =>
    Array.from({ length: n }, (_, i) => ({ attributes: { ...attr, ObjectId: startId + i, flight_id: 'f' + (startId + i) } }));

  it('issues a count query before paging, and pages by resultOffset', async () => {
    const page = fx('skydio_page.json');
    const urls: string[] = [];
    const fj = async (u: string) => { urls.push(u); return isCountUrl(u) ? { count: 2 } : page; };
    const rows = await fetchAllFeatures(fj, featureLayerUrl(ORG));
    expect(rows.length).toBe(2);
    expect(urls[0]).toContain('returnCountOnly=true');
    expect(urls[1]).toContain('returnGeometry=false');
    expect(urls[1]).toContain(`${ORG}-production/FeatureServer/0/query`);
    expect(urls[1]).toContain('resultOffset=0&');
  });

  it('regression: a short mid-stream page that is not the end still collects everything', async () => {
    // Total is 2002: a full 1000-row page, then a SHORT 500-row page
    // mid-stream (which the old "short page means done" rule would have
    // wrongly treated as end-of-data), then a final 502-row page that
    // completes the counted total. All 2002 rows must be collected.
    const attr = attrOf(fx('skydio_page.json'));
    const urls: string[] = [];
    const fj = async (u: string) => {
      urls.push(u);
      if (isCountUrl(u)) return { count: 2002 };
      if (u.includes('resultOffset=0&')) return { features: featuresOf(attr, 1000, 0) };
      if (u.includes('resultOffset=1000&')) return { features: featuresOf(attr, 500, 1000) };
      if (u.includes('resultOffset=1500&')) return { features: featuresOf(attr, 502, 1500) };
      throw new Error('unexpected ' + u);
    };
    const rows = await fetchAllFeatures(fj, featureLayerUrl(ORG));
    expect(rows.length).toBe(2002);
    expect(urls.filter(u => !isCountUrl(u)).length).toBe(3);
  });

  it('a genuinely empty dataset (count 0) succeeds with zero rows and no data query', async () => {
    const urls: string[] = [];
    const fj = async (u: string) => { urls.push(u); return isCountUrl(u) ? { count: 0 } : { features: [] }; };
    const rows = await fetchAllFeatures(fj, featureLayerUrl(ORG));
    expect(rows).toEqual([]);
    expect(urls.length).toBe(1); // the count query alone was enough to know there's nothing to page
  });

  it('a data query genuinely running out (empty page) before reaching the counted total throws instead of returning a partial result', async () => {
    const attr = attrOf(fx('skydio_page.json'));
    const fj = async (u: string) => {
      if (isCountUrl(u)) return { count: 1000 };
      if (u.includes('resultOffset=0&')) return { features: featuresOf(attr, 1, 0) };
      return { features: [] };
    };
    await expect(fetchAllFeatures(fj, featureLayerUrl(ORG))).rejects.toThrow(/pagination mismatch.*expected 1000.*got 1/);
  });

  it('forwards ArcGIS errors from the count query and the data query', async () => {
    await expect(fetchAllFeatures(async (u: string) => (isCountUrl(u) ? { error: { code: 400, message: 'bad' } } : { features: [] }), featureLayerUrl(ORG)))
      .rejects.toThrow(/ArcGIS count error/);
    await expect(fetchAllFeatures(async (u: string) => (isCountUrl(u) ? { count: 1 } : { error: { code: 400, message: 'bad' } }), featureLayerUrl(ORG)))
      .rejects.toThrow(/ArcGIS error/);
  });
  it('rejects rather than silently returning zero rows when the data response is null', async () => {
    await expect(fetchAllFeatures(async (u: string) => (isCountUrl(u) ? { count: 1 } : null), featureLayerUrl(ORG))).rejects.toThrow(/ArcGIS error/);
  });
  it('rejects a data response that omits features entirely, distinct from a genuinely empty page', async () => {
    await expect(fetchAllFeatures(async (u: string) => (isCountUrl(u) ? { count: 1 } : {}), featureLayerUrl(ORG))).rejects.toThrow(/ArcGIS error/);
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

describe('discoverSkydioDashboards item resolution isolation', () => {
  it('records org_uuid: null for an item whose resolution throws, without aborting the rest of discovery', async () => {
    const BAD_ITEM = 'c46f310a21a44968a55418aacedf1581';
    const search = { total: 2, start: 1, num: 100, nextStart: -1, results: [
      { id: '81fc8f0745944ddfbf773850cf28eca8', title: 'Milwaukee Police Department', type: 'Dashboard', access: 'public', modified: 1756300000000 },
      { id: BAD_ITEM, title: 'FlightsDashboard', type: 'Dashboard', access: 'public', modified: 1756300000000 },
    ] };
    const fj = async (u: string) => {
      if (u.includes('/sharing/rest/search')) return search;
      if (u.includes('/items/81fc8f0745944ddfbf773850cf28eca8/data')) return fx('arcgis_dashboard_data.json');
      if (u.includes('/items/978dcbe2ba40406aa545ba2abc25bc5f?')) return fx('arcgis_webmap_item.json');
      if (u.includes(`/items/${BAD_ITEM}/data`)) throw new Error(`Unparsable JSON from ${u}: `);
      throw new Error('unexpected ' + u);
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = await discoverSkydioDashboards(fj);
    const MOD = new Date(1756300000000).toISOString();
    expect(d).toEqual([
      { item_id: '81fc8f0745944ddfbf773850cf28eca8', title: 'Milwaukee Police Department', org_uuid: ORG, modified: MOD },
      { item_id: BAD_ITEM, title: 'FlightsDashboard', org_uuid: null, modified: MOD },
    ]);
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toMatch(new RegExp(BAD_ITEM));
    warn.mockRestore();
  });
});

describe('discoverSkydioDashboards failure-rate circuit breaker', () => {
  const DIRECT_FIXTURE = fx('arcgis_dashboard_data_direct.json');
  const DIRECT_ORG = 'c1a2b3c4-d5e6-47f8-a9b0-c1d2e3f4a5b6';
  const TOTAL = 60; // threshold = max(5, round(60 * 0.10)) = 6

  function makeBatch(total: number, failCount: number) {
    const results = Array.from({ length: total }, (_, i) => ({
      id: `item-${i}`, title: `Agency ${i}`, type: 'Dashboard', access: 'public', modified: 1756300000000,
    }));
    const failIds = new Set(results.slice(0, failCount).map(r => r.id));
    const search = { total, start: 1, num: 100, nextStart: -1, results };
    const fj = async (u: string) => {
      if (u.includes('/sharing/rest/search')) return search;
      const m = u.match(/\/items\/([^/]+)\/data/);
      if (m) {
        if (failIds.has(m[1])) throw new Error(`Unparsable JSON from ${u}: `);
        return DIRECT_FIXTURE;
      }
      throw new Error('unexpected ' + u);
    };
    return fj;
  }

  // Case 1 (a single failing item still returns every dashboard, with the failing one's org_uuid
  // null) is the pre-existing 'discoverSkydioDashboards item resolution isolation' test above —
  // 1 unresolved of 2 items is well under this threshold (max(5, round(2*0.10)) = 5), so it must
  // and does still pass unchanged.

  it('failures above the threshold throw, and the error names both counts', async () => {
    const fj = makeBatch(TOTAL, 7); // threshold is 6; 7 exceeds it
    await expect(discoverSkydioDashboards(fj)).rejects.toThrow(/7 of 60.*threshold of 6/s);
  });

  it('failures at the threshold do not throw (the boundary that keeps the fix from over-correcting)', async () => {
    const fj = makeBatch(TOTAL, 6); // exactly at threshold
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const d = await discoverSkydioDashboards(fj);
    expect(d).toHaveLength(TOTAL);
    expect(d.filter(x => x.org_uuid === null)).toHaveLength(6);
    warn.mockRestore();
  });
});

describe('discoverSkydioDashboards direct-URL shortcut', () => {
  it('resolves org_uuid from a feature-service URL embedded directly in the dashboard payload, without ever fetching a web map', async () => {
    const DIRECT_ITEM = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const DIRECT_ORG = 'c1a2b3c4-d5e6-47f8-a9b0-c1d2e3f4a5b6';
    const search = { total: 1, start: 1, num: 100, nextStart: -1, results: [
      { id: DIRECT_ITEM, title: 'Direct PD', type: 'Dashboard', access: 'public', modified: 1756300000000 },
    ] };
    const fj = async (u: string) => {
      if (u.includes('/sharing/rest/search')) return search;
      if (u.includes(`/items/${DIRECT_ITEM}/data`)) return fx('arcgis_dashboard_data_direct.json');
      throw new Error('unexpected ' + u); // any web-map item fetch lands here and fails the test
    };
    const d = await discoverSkydioDashboards(fj);
    expect(d).toEqual([
      { item_id: DIRECT_ITEM, title: 'Direct PD', org_uuid: DIRECT_ORG, modified: new Date(1756300000000).toISOString() },
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
    const fj = async (u: string) => (u.includes('returnCountOnly=true') ? { count: 2 } : page); // both orgs report and return the same two flights
    const recs = await skydioAdapter.pull(agency, fj);
    expect(recs.length).toBe(2);
    expect(recs.every(r => r.agency_id === 'okc-pd')).toBe(true);
  });
});
