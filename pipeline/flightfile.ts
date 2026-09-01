import type { FlightRecord } from './schema.js';

export const COLUMNS = ['source_flight_id', 'takeoff_utc', 'flight_date_local', 'landing_utc', 'duration_min', 'purpose', 'description', 'case_number', 'data_quality', 'extra'] as const;
export type Column = typeof COLUMNS[number];
export type FlightFile = { agency_id: string; columns: typeof COLUMNS; rows: unknown[][] };

function cmp(a: FlightRecord, b: FlightRecord): number {
  if (a.takeoff_utc === null && b.takeoff_utc !== null) return 1;
  if (a.takeoff_utc !== null && b.takeoff_utc === null) return -1;
  if (a.takeoff_utc !== null && b.takeoff_utc !== null && a.takeoff_utc !== b.takeoff_utc) return a.takeoff_utc < b.takeoff_utc ? -1 : 1;
  return a.source_flight_id < b.source_flight_id ? -1 : a.source_flight_id > b.source_flight_id ? 1 : 0;
}

export function encodeFlightFile(agencyId: string, records: FlightRecord[]): FlightFile {
  const rows = [...records].sort(cmp).map(r => COLUMNS.map(c => r[c]));
  return { agency_id: agencyId, columns: COLUMNS, rows };
}

export function decodeFlightFile(file: FlightFile): FlightRecord[] {
  return file.rows.map(row => {
    const r: Record<string, unknown> = { agency_id: file.agency_id };
    file.columns.forEach((c, i) => { r[c] = row[i]; });
    return r as FlightRecord;
  });
}

export function summarize(records: FlightRecord[]) {
  let first: string | null = null, last: string | null = null, minutes = 0;
  for (const r of records) {
    if (r.flight_date_local) {
      if (first === null || r.flight_date_local < first) first = r.flight_date_local;
      if (last === null || r.flight_date_local > last) last = r.flight_date_local;
    }
    if (typeof r.duration_min === 'number') minutes += r.duration_min;
  }
  return { flight_count: records.length, first_flight: first, last_flight: last, total_hours: Math.round(minutes / 6) / 10 };
}
