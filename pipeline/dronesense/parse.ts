import type { FlightRecord } from '../schema.js';
import { localDate } from '../time.js';

/**
 * DroneSense public dashboards.
 *
 * The census wrote this platform off as dead, which was wrong and worth
 * recording: its dashboards open on the current month, so an agency that flew
 * nothing this week renders "0-0 of 0 Flights" while holding years of history.
 * Asking the API for a wide date range instead shows six live agencies and
 * several thousand flights.
 *
 * The flight list carries a full-resolution JPEG of the scene inline, as
 * base64, on every record. It is never stored: it is imagery of an incident,
 * it is not a flight log, and it would be tens of megabytes per agency.
 */

export type DroneSenseFlight = {
  id?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  address?: string | null;
  description?: string | null;
  /** The agency's own reference for the call. */
  name?: string | null;
  priority?: string | null;
  flightType?: string | null;
  type?: string | null;
};

/** Everything worth keeping, and nothing else. Drops the inline imagery. */
export function slim(raw: Record<string, unknown>): DroneSenseFlight {
  const pick = (k: string): string | null => {
    const v = raw[k];
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t.length ? t : null;
  };
  return {
    id: pick('id'),
    startDate: pick('startDate'),
    endDate: pick('endDate'),
    address: pick('address'),
    description: pick('description'),
    name: pick('name'),
    priority: pick('priority'),
    flightType: pick('flightType'),
    type: pick('type'),
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

export function toRecord(agencyId: string, timezone: string, f: DroneSenseFlight): FlightRecord | null {
  const id = str(f.id);
  if (!id) return null;

  const takeoff = iso(f.startDate);
  const landing = iso(f.endDate);
  const duration = takeoff && landing
    ? Math.max(0, Math.round(((Date.parse(landing) - Date.parse(takeoff)) / 60_000) * 10) / 10)
    : null;

  const extra: Record<string, string | number | null> = {};
  const priority = str(f.priority);
  const flightType = str(f.flightType);
  if (priority) extra.priority = priority;
  if (flightType) extra.flight_type = flightType;

  return {
    agency_id: agencyId,
    source_flight_id: id,
    takeoff_utc: takeoff,
    flight_date_local: takeoff ? localDate(Date.parse(takeoff), timezone) : null,
    landing_utc: landing,
    duration_min: duration,
    // The description is what the flight was sent to; the type is how the
    // agency categorises it. Prefer the category, fall back to the description.
    purpose: str(f.type) ?? str(f.description),
    description: str(f.address),
    case_number: str(f.name),
    extra,
    data_quality: null,
  };
}
