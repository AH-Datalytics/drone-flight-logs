import type { FlightRecord } from '../schema.js';
import type { FetchJson } from '../http.js';
import { localDate } from '../time.js';
import { isSkydio, type RegistryAgency, type DiscoveredDashboard } from '../registry.js';
import type { Adapter } from './types.js';

export const ARCGIS_ORG_ID = 'mnhQTdIYDA7UoY2l';
const ARCGIS = 'https://www.arcgis.com/sharing/rest';
const PAGE = 1000;

export type SkydioAttributes = {
  ObjectId: number; flight_id: string; takeoff: number | null; landing: number | null;
  external_id: string | null; description: string | null; flight_purpose: string | null;
  [k: string]: unknown;
};

export function featureLayerUrl(orgUuid: string): string {
  return `https://services7.arcgis.com/${ARCGIS_ORG_ID}/arcgis/rest/services/${orgUuid}-production/FeatureServer/0`;
}

const emptyToNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const validMs = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function mapSkydioAttributes(a: SkydioAttributes, agencyId: string, tz: string): FlightRecord {
  const hasT = validMs(a.takeoff), hasL = validMs(a.landing);
  const dq: string[] = [];
  if (!hasT) dq.push('missing_takeoff');
  if (!hasL) dq.push('missing_landing');
  return {
    agency_id: agencyId,
    source_flight_id: String(a.flight_id),
    takeoff_utc: hasT ? new Date(a.takeoff as number).toISOString() : null,
    flight_date_local: hasT ? localDate(a.takeoff as number, tz) : null,
    landing_utc: hasL ? new Date(a.landing as number).toISOString() : null,
    duration_min: hasT && hasL ? Math.round(((a.landing as number) - (a.takeoff as number)) / 600) / 100 : null,
    purpose: emptyToNull(a.flight_purpose),
    description: emptyToNull(a.description),
    case_number: emptyToNull(a.external_id),
    extra: {},
    data_quality: dq.length ? dq.join(';') : null,
  };
}

export async function fetchAllFeatures(fetchJson: FetchJson, layerUrl: string): Promise<SkydioAttributes[]> {
  const out: SkydioAttributes[] = [];
  let offset = 0;
  for (;;) {
    const url = `${layerUrl}/query?where=1%3D1&outFields=*&returnGeometry=false&orderByFields=${encodeURIComponent('takeoff ASC,ObjectId ASC')}&resultOffset=${offset}&resultRecordCount=${PAGE}&f=json`;
    const j = await fetchJson(url);
    if (j?.error) throw new Error(`ArcGIS error from ${layerUrl}: ${JSON.stringify(j.error)}`);
    if (typeof j !== 'object' || j === null || !Array.isArray(j.features)) {
      throw new Error(`ArcGIS error from ${layerUrl}: malformed response ${JSON.stringify(j)}`);
    }
    const feats: Array<{ attributes: SkydioAttributes }> = j.features;
    for (const f of feats) out.push(f.attributes);
    if (feats.length < PAGE) break;
    offset += feats.length;
  }
  return out;
}

async function resolveOrgUuid(fetchJson: FetchJson, itemId: string): Promise<string | null> {
  const data = await fetchJson(`${ARCGIS}/content/items/${itemId}/data?f=json`);
  const s = JSON.stringify(data ?? {});
  const direct = s.match(/services\/([0-9a-f-]{36})-production\/FeatureServer/);
  if (direct) return direct[1];
  const ids = [...new Set([...s.matchAll(/"itemId":"([a-f0-9]{32})"/g)].map(m => m[1]))];
  for (const id of ids) {
    const item = await fetchJson(`${ARCGIS}/content/items/${id}?f=json`);
    const m = String(item?.title ?? '').match(/^([0-9a-f-]{36})-production/);
    if (m) return m[1];
  }
  return null;
}

export async function discoverSkydioDashboards(fetchJson: FetchJson): Promise<DiscoveredDashboard[]> {
  const q = encodeURIComponent(`orgid:${ARCGIS_ORG_ID} AND type:Dashboard`);
  const items: Array<{ id: string; title: string; modified: number }> = [];
  let start = 1;
  for (;;) {
    const j = await fetchJson(`${ARCGIS}/search?q=${q}&f=json&num=100&start=${start}&sortField=title&sortOrder=asc`);
    if (j?.error) throw new Error(`ArcGIS search error: ${JSON.stringify(j.error)}`);
    items.push(...(j.results ?? []));
    if (!j.nextStart || j.nextStart === -1) break;
    start = j.nextStart;
  }
  const out: DiscoveredDashboard[] = [];
  for (const it of items) {
    out.push({ item_id: it.id, title: it.title.trim(), org_uuid: await resolveOrgUuid(fetchJson, it.id), modified: new Date(it.modified).toISOString() });
  }
  return out;
}

export async function layerExtentCenter(fetchJson: FetchJson, orgUuid: string): Promise<{ lon: number; lat: number } | null> {
  const j = await fetchJson(`${featureLayerUrl(orgUuid)}?f=json`);
  const e = j?.extent;
  if (!e) return null;
  const wk = e.spatialReference?.latestWkid ?? e.spatialReference?.wkid;
  const nums = [e.xmin, e.ymin, e.xmax, e.ymax].map(Number);
  if (wk !== 4326 || nums.some(n => !Number.isFinite(n))) return null;
  return { lon: Math.round(((nums[0] + nums[2]) / 2) * 1e6) / 1e6, lat: Math.round(((nums[1] + nums[3]) / 2) * 1e6) / 1e6 };
}

export const skydioAdapter: Adapter = {
  source: 'skydio_arcgis',
  async pull(agency: RegistryAgency, fetchJson: FetchJson): Promise<FlightRecord[]> {
    if (!isSkydio(agency)) throw new Error(`${agency.agency_id} is not a skydio_arcgis agency`);
    const seen = new Set<string>();
    const out: FlightRecord[] = [];
    for (const org of agency.source_config.orgs) {
      const rows = await fetchAllFeatures(fetchJson, featureLayerUrl(org.org_uuid));
      for (const a of rows) {
        const r = mapSkydioAttributes(a, agency.agency_id, agency.timezone);
        if (seen.has(r.source_flight_id)) continue;
        seen.add(r.source_flight_id);
        out.push(r);
      }
    }
    return out;
  },
};
