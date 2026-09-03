import type { FlightRecord } from '../schema.js';
import { localDate } from '../time.js';

/**
 * Flock Aerodome community dashboards are a Next.js app. The flight list is
 * server-rendered, so the flight objects arrive inside an RSC payload — a
 * stream of numbered lines whose values are JSON, with the flight objects
 * embedded verbatim. There is no JSON API to call: the payload is the API.
 *
 * Parsing it means finding each `"flight":{...}` and reading a balanced
 * object, because the payload as a whole is not valid JSON.
 */

export type FlockCallForService = {
  cad_event_number?: string | null;
  cad_event_type?: string | null;
  priority?: number | string | null;
  address?: {
    street_address?: string | null;
    locality?: string | null;
    region?: string | null;
    postal_code?: string | null;
  } | null;
};

export type FlockFlight = {
  flight_number?: string | null;
  time_period?: { begin?: string | null; end?: string | null } | null;
  duration_seconds?: number | null;
  ce_hidden?: boolean;
  calls_for_service?: FlockCallForService[] | null;
};

const KEY = '"flight":';

/**
 * Read one balanced JSON object starting at `start` (which must index a `{`).
 * Returns the end index (exclusive), or -1 if the object never closes.
 */
export function balancedEnd(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Extract every flight object from one RSC payload.
 *
 * Telemetry is dropped here rather than downstream: the payload carries the
 * full flight path as lat/lng samples, this project does not store flight
 * geometry, and the safest place to discard it is before it can be written
 * to disk.
 */
export function extractFlights(payload: string): FlockFlight[] {
  const out: FlockFlight[] = [];
  const seen = new Set<string>();
  let i = 0;
  while ((i = payload.indexOf(KEY, i)) !== -1) {
    const open = payload.indexOf('{', i + KEY.length);
    if (open === -1) break;
    const end = balancedEnd(payload, open);
    if (end === -1) break;
    let obj: FlockFlight | null = null;
    try {
      obj = JSON.parse(payload.slice(open, end)) as FlockFlight;
    } catch {
      obj = null;
    }
    i = end;
    if (!obj || typeof obj.flight_number !== 'string' || obj.flight_number.length === 0) continue;
    if (seen.has(obj.flight_number)) continue;
    seen.add(obj.flight_number);
    const { flight_number, time_period, duration_seconds, ce_hidden, calls_for_service } = obj;
    out.push({ flight_number, time_period, duration_seconds, ce_hidden, calls_for_service });
  }
  return out;
}

function trimIso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length ? t : null;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

/**
 * One flight object to one FlightRecord.
 *
 * A flight can carry several calls for service. The first is used for the
 * purpose and case number, and the rest are counted in `extra` so a reader
 * can see that the flight covered more than one call rather than silently
 * losing them.
 */
export function toRecord(agencyId: string, timezone: string, f: FlockFlight): FlightRecord | null {
  const id = str(f.flight_number);
  if (!id) return null;

  const takeoff = trimIso(f.time_period?.begin);
  const landing = trimIso(f.time_period?.end);
  const cfs = Array.isArray(f.calls_for_service) ? f.calls_for_service.filter(Boolean) : [];
  const first = cfs[0] ?? null;
  const addr = first?.address ?? null;

  const duration =
    typeof f.duration_seconds === 'number' && Number.isFinite(f.duration_seconds) && f.duration_seconds >= 0
      ? Math.round((f.duration_seconds / 60) * 10) / 10
      : takeoff && landing
        ? Math.max(0, Math.round(((Date.parse(landing) - Date.parse(takeoff)) / 60000) * 10) / 10)
        : null;

  const place = [str(addr?.street_address), str(addr?.locality)].filter(Boolean).join(', ') || null;

  const extra: Record<string, string | number | null> = {
    priority: str(first?.priority),
    calls_for_service: cfs.length,
  };
  if (cfs.length > 1) {
    extra.other_call_types = cfs.slice(1).map(c => str(c?.cad_event_type)).filter(Boolean).join(' | ') || null;
  }

  return {
    agency_id: agencyId,
    source_flight_id: id,
    takeoff_utc: takeoff,
    flight_date_local: takeoff ? localDate(Date.parse(takeoff), timezone) : null,
    landing_utc: landing,
    duration_min: duration,
    purpose: str(first?.cad_event_type),
    description: place,
    case_number: str(first?.cad_event_number),
    extra,
    data_quality: null,
  };
}

/** The dashboard's own paging: eight flights per page, and the size is fixed. */
export const PAGE_SIZE = 8;

/** Flights whose date falls inside [from, to] in the agency's timezone. */
export function flightMonth(f: FlockFlight): string | null {
  const t = trimIso(f.time_period?.begin);
  return t ? t.slice(0, 7) : null;
}
