export type FlightRecord = {
  agency_id: string;
  source_flight_id: string;
  takeoff_utc: string | null;
  flight_date_local: string | null;
  landing_utc: string | null;
  duration_min: number | null;
  purpose: string | null;
  description: string | null;
  case_number: string | null;
  extra: Record<string, string | number | null>;
  data_quality: string | null;
};

export const FORBIDDEN_FIELDS = ['user_email', 'vehicle_serial', 'dock_serial', 'operation_id', 'pilot_email'] as const;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

function isNullOrString(v: unknown): boolean { return v === null || typeof v === 'string'; }

export function validateRecord(input: unknown): string[] {
  const p: string[] = [];
  if (typeof input !== 'object' || input === null) return ['record must be an object'];
  const r = input as Record<string, unknown>;

  for (const f of FORBIDDEN_FIELDS) if (f in r) p.push(`forbidden field present: ${f}`);

  if (typeof r.agency_id !== 'string' || r.agency_id.length === 0) p.push('agency_id must be a non-empty string');
  if (typeof r.source_flight_id !== 'string' || r.source_flight_id.length === 0) p.push('source_flight_id must be a non-empty string');

  if (!(r.takeoff_utc === null || (typeof r.takeoff_utc === 'string' && ISO_UTC.test(r.takeoff_utc)))) p.push('takeoff_utc must be ISO 8601 UTC or null');
  if (!(r.landing_utc === null || (typeof r.landing_utc === 'string' && ISO_UTC.test(r.landing_utc)))) p.push('landing_utc must be ISO 8601 UTC or null');
  if (!(r.flight_date_local === null || (typeof r.flight_date_local === 'string' && YMD.test(r.flight_date_local)))) p.push('flight_date_local must be YYYY-MM-DD or null');

  if (!(r.duration_min === null || (typeof r.duration_min === 'number' && Number.isFinite(r.duration_min) && r.duration_min >= 0))) p.push('duration_min must be a non-negative number or null');

  for (const f of ['purpose', 'description', 'case_number', 'data_quality'] as const) {
    if (!isNullOrString(r[f])) p.push(`${f} must be a string or null`);
  }
  if (typeof r.extra !== 'object' || r.extra === null || Array.isArray(r.extra)) p.push('extra must be an object');
  return p;
}
