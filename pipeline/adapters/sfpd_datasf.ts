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
  const dq = ['no_takeoff_time'];
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
    data_quality: dq.join(';'),
  };
}

export const sfpdAdapter: Adapter = {
  source: 'sfpd_datasf',
  async pull(agency: RegistryAgency, fetchJson: FetchJson): Promise<FlightRecord[]> {
    if (agency.source !== 'sfpd_datasf') throw new Error(`${agency.agency_id} is not an sfpd_datasf agency`);
    const cfg = agency.source_config as SfpdConfig;
    const out: FlightRecord[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const params = new URLSearchParams({ $select: FIELDS.join(','), $order: ':id', $limit: String(PAGE), $offset: String(offset) });
      const rows: SfpdRow[] = await fetchJson(`https://${cfg.domain}/resource/${cfg.dataset_id}.json?${params.toString()}`);
      if (!Array.isArray(rows)) throw new Error(`Socrata returned non-array: ${JSON.stringify(rows).slice(0, 200)}`);
      for (const r of rows) out.push(mapSfpdRow(r, agency.agency_id));
      if (rows.length < PAGE) break;
    }
    return out;
  },
};
