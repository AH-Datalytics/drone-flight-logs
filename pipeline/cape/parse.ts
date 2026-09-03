import type { FlightRecord } from '../schema.js';

/**
 * Motorola's CAPE transparency portals expose a plain JSON flight list, which
 * makes them the easiest source in the census to read and the most fragile to
 * rely on. Most agencies configure a rolling public window — thirty or sixty
 * days — after which a flight disappears from the feed for good. Collection is
 * therefore additive: what has been seen is kept, because the source will not
 * show it again.
 *
 * The stated purpose is free text the pilot types, so it carries the agency's
 * own vocabulary along with its typos and stray notes. It is stored verbatim.
 */

export type CapeFlight = {
  id?: string | null;
  take_off_time?: string | null;
  time_added?: string | null;
  session_duration?: string | null;
  flight_reason?: string | null;
  flight_name?: string | null;
  incident_location?: string | null;
  flight_type?: string | null;
  is_complete?: boolean;
};

/** "01:23:45" or "00:06:53" to minutes. */
export function durationMinutes(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = v.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  if (!m) return null;
  const minutes = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 60;
  return Math.round(minutes * 10) / 10;
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

export function toRecord(
  agencyId: string,
  timezone: string,
  f: CapeFlight,
  localDate: (utcMs: number, tz: string) => string,
): FlightRecord | null {
  const id = str(f.id);
  if (!id) return null;

  const takeoff = iso(f.take_off_time) ?? iso(f.time_added);
  const duration = durationMinutes(f.session_duration);
  const landing = takeoff && duration !== null ? new Date(Date.parse(takeoff) + duration * 60_000).toISOString() : null;

  const extra: Record<string, string | number | null> = {};
  const typeId = str(f.flight_type);
  if (typeId) extra.flight_type_id = typeId;
  if (f.is_complete === false) extra.flight_incomplete = 1;

  return {
    agency_id: agencyId,
    source_flight_id: id,
    takeoff_utc: takeoff,
    flight_date_local: takeoff ? localDate(Date.parse(takeoff), timezone) : null,
    landing_utc: landing,
    duration_min: duration,
    purpose: str(f.flight_reason),
    description: str(f.incident_location),
    case_number: str(f.flight_name),
    extra,
    data_quality: null,
  };
}
