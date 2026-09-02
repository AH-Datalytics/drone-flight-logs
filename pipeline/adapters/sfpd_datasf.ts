import type { FlightRecord } from '../schema.js';
import type { FetchJson } from '../http.js';
import type { RegistryAgency, SfpdConfig } from '../registry.js';
import type { Adapter } from './types.js';

const PAGE = 5000;
const FIELDS = [':id', 'date', 'case_cad_event_number', 'call_type_original_desc', 'flight_duration_minutes', 'reason_for_flight', 'geocoded_location', 'analysis_neighborhood', 'supervisor_district'];

export type SfpdRow = { ':id': string; date?: string; case_cad_event_number?: string; call_type_original_desc?: string; flight_duration_minutes?: string; reason_for_flight?: string; geocoded_location?: string; analysis_neighborhood?: string; supervisor_district?: string };

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

export function mapSfpdRow(row: SfpdRow, agencyId: string): FlightRecord {
  const date = str(row.date)?.slice(0, 10) ?? null;
  const durRaw = str(row.flight_duration_minutes);
  const dur = durRaw !== null && Number.isFinite(Number(durRaw)) ? Number(durRaw) : null;
  // SFPD publishes a date without a time for every record — that is a property
  // of the whole source (documented in the agency's registry `notes`), not a
  // defect in any individual record, so it must not be flagged per-record here
  // (spec §4.1: a field null for every record of a source by design is a
  // source-level caveat, not a per-record `data_quality` code). A genuinely
  // missing duration is a real per-record gap and is still flagged.
  const dq: string[] = [];
  if (dur === null) dq.push('missing_duration');
  return {
    agency_id: agencyId,
    source_flight_id: row[':id'],
    takeoff_utc: null,
    flight_date_local: date,
    landing_utc: null,
    duration_min: dur,
    purpose: str(row.reason_for_flight),
    description: str(row.call_type_original_desc),
    case_number: str(row.case_cad_event_number),
    extra: { analysis_neighborhood: str(row.analysis_neighborhood), supervisor_district: str(row.supervisor_district), geocoded_location: str(row.geocoded_location) },
    data_quality: dq.length ? dq.join(';') : null,
  };
}

async function countRows(fetchJson: FetchJson, domain: string, datasetId: string): Promise<number> {
  const url = `https://${domain}/resource/${datasetId}.json?${new URLSearchParams({ $select: 'count(*)' }).toString()}`;
  const rows = await fetchJson(url);
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0] !== 'object' || rows[0] === null) {
    throw new Error(`Socrata count error from ${url}: malformed response ${JSON.stringify(rows).slice(0, 200)}`);
  }
  const n = Number((rows[0] as Record<string, unknown>).count);
  if (!Number.isFinite(n)) throw new Error(`Socrata count error from ${url}: non-numeric count ${JSON.stringify(rows[0])}`);
  return n;
}

export const sfpdAdapter: Adapter = {
  source: 'sfpd_datasf',
  // Pagination is self-verifying rather than heuristic, for the same reason as
  // the Skydio adapter: a short page must never be indistinguishable from
  // end-of-data. Socrata is stricter about honoring $limit than ArcGIS is
  // about resultRecordCount, so this is prevention rather than a known live
  // bug, but the shape has to match — a mismatch throws instead of returning
  // a partial result.
  async pull(agency: RegistryAgency, fetchJson: FetchJson): Promise<FlightRecord[]> {
    if (agency.source !== 'sfpd_datasf') throw new Error(`${agency.agency_id} is not an sfpd_datasf agency`);
    const cfg = agency.source_config as SfpdConfig;
    const url = `https://${cfg.domain}/resource/${cfg.dataset_id}.json`;
    const expected = await countRows(fetchJson, cfg.domain, cfg.dataset_id);
    const out: FlightRecord[] = [];
    let offset = 0;
    while (out.length < expected) {
      const params = new URLSearchParams({ $select: FIELDS.join(','), $order: ':id', $limit: String(PAGE), $offset: String(offset) });
      const rows: SfpdRow[] = await fetchJson(`${url}?${params.toString()}`);
      if (!Array.isArray(rows)) throw new Error(`Socrata returned non-array: ${JSON.stringify(rows).slice(0, 200)}`);
      for (const r of rows) out.push(mapSfpdRow(r, agency.agency_id));
      if (rows.length === 0) break;
      offset += rows.length;
    }
    if (out.length !== expected) {
      throw new Error(`Socrata pagination mismatch from ${url}: expected ${expected} rows, got ${out.length}`);
    }
    return out;
  },
};
