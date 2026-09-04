import type { FlightRecord } from '../schema.js';
import { localDate } from '../time.js';

/**
 * BRINC LiveOps public dashboards.
 *
 * A sixth platform, found through the DRONERESPONDERS registry rather than by
 * searching for it: agencies sit on paths under one host, so nothing about the
 * vendor's certificates reveals who its customers are.
 *
 * A flight can answer more than one call, so the API nests calls inside the
 * flight. The first is used for the purpose and case number and the rest are
 * counted, the same way Flock's are, so an agency that pairs calls does not
 * look like it flew twice.
 *
 * Every mission carries a signed link to its telemetry — the full flight path
 * as coordinates. It is not stored and not followed.
 */

export type BrincMission = { call_type?: string | null; start_time?: string | null; case_id?: string | null };

export type BrincFlight = {
  flight_id?: string | null;
  /** Seconds. */
  flight_time?: number | null;
  start_time?: string | null;
  missions?: Record<string, BrincMission> | null;
};

/** Everything worth keeping. Drops the signed telemetry link. */
export function slim(raw: Record<string, unknown>): BrincFlight {
  const missions: Record<string, BrincMission> = {};
  const src = raw.missions;
  if (src && typeof src === 'object' && !Array.isArray(src)) {
    for (const [k, v] of Object.entries(src as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const m = v as Record<string, unknown>;
      missions[k] = {
        call_type: typeof m.call_type === 'string' ? m.call_type : null,
        start_time: typeof m.start_time === 'string' ? m.start_time : null,
        case_id: typeof m.case_id === 'string' ? m.case_id : null,
      };
    }
  }
  return {
    flight_id: typeof raw.flight_id === 'string' ? raw.flight_id : null,
    flight_time: typeof raw.flight_time === 'number' ? raw.flight_time : null,
    start_time: typeof raw.start_time === 'string' ? raw.start_time : null,
    missions,
  };
}

function iso(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

export function toRecord(agencyId: string, timezone: string, f: BrincFlight): FlightRecord | null {
  const id = str(f.flight_id);
  if (!id) return null;

  const takeoff = iso(f.start_time);
  const duration = typeof f.flight_time === 'number' && Number.isFinite(f.flight_time) && f.flight_time >= 0
    ? Math.round((f.flight_time / 60) * 10) / 10
    : null;
  const landing = takeoff && duration !== null
    ? new Date(Date.parse(takeoff) + duration * 60_000).toISOString()
    : null;

  const calls = Object.values(f.missions ?? {});
  const first = calls[0] ?? null;

  const extra: Record<string, string | number | null> = { calls_for_service: calls.length };
  if (calls.length > 1) {
    const others = calls.slice(1).map(c => str(c.call_type)).filter(Boolean).join(' | ');
    if (others) extra.other_call_types = others;
  }

  return {
    agency_id: agencyId,
    source_flight_id: id,
    takeoff_utc: takeoff,
    flight_date_local: takeoff ? localDate(Date.parse(takeoff), timezone) : null,
    landing_utc: landing,
    duration_min: duration,
    purpose: str(first?.call_type),
    description: null,
    case_number: str(first?.case_id),
    extra,
    data_quality: null,
  };
}
