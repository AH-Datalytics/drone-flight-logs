import type { FlightRecord } from '../schema.js';
import { utcFromWallTime, localDate } from '../time.js';
import { keepOnlyLabels, labelled } from './labels.js';

/**
 * Agencies that publish their own flight log, outside any vendor.
 *
 * These are ArcGIS feature services a city or county runs itself. Each one
 * invents its own field names for the same handful of ideas, so the mapping
 * lives in data/selfpub_sites.json and this module does the reading.
 *
 * Two things make them different from the vendor sources. They often expose
 * fields this project refuses to store — pilot names, pilot email addresses,
 * employee numbers, takeoff coordinates — so the mapping is an allow-list:
 * nothing reaches a record unless it was asked for by name. And their free-text
 * fields sometimes carry a pilot's name inside prose, which no field-level rule
 * would catch, so text that is kept is scrubbed of the labelled lines that name
 * people.
 */

export type FieldMap = {
  /** Epoch-milliseconds date field. */
  date: string;
  /** Optional wall-clock time to pair with it, e.g. "8:58 PM". */
  time?: string;
  case_number?: string;
  purpose?: string;
  location?: string;
  /** Minutes, as a number. */
  duration_minutes?: string;
  /** Hours, as a number — multiplied up. */
  duration_hours?: string;
  /** Free text that states a duration, e.g. "15 mins", "2 hours of training". */
  duration_text?: string;
  /**
   * Take one labelled value out of a prose field rather than the whole thing:
   * { field: 'Notes', label: 'Reason' } reads "Reason: Training" and keeps
   * "Training". Used where the prose also names people in forms no rule
   * catches, so publishing the text itself is not safe.
   */
  purpose_labelled?: { field: string; label: string };
  /** Kept in extra, verbatim. */
  extra?: Record<string, string>;
};

export type SelfPubSite = {
  agency_id: string;
  display_name: string;
  state: string | null;
  timezone: string;
  service_url: string;
  id_field: string;
  fields: FieldMap;
  /** Only rows whose `field` contains one of `values` are kept. */
  row_filter?: { field: string; values: string[] };
  data_quality?: string | null;
  official_url: string;
  note?: string;
};

/** Labelled lines that name a person, stripped from any text we keep. */
const NAMES_A_PERSON = /^\s*(pilot|operator|officer|employee|crew)\s*[:#]/i;

/**
 * The same thing said mid-sentence rather than on its own line: "Employee
 * #6724", "Pilot #4820167 flew 12/06". Dropping the whole line would lose the
 * flight, so only the identifier goes.
 */
const NAMES_A_PERSON_INLINE = /\b(pilot|operator|officer|employee|emp)\b\s*#?\s*[A-Za-z0-9'.-]+/gi;

/**
 * Remove anyone named in free text.
 *
 * Two shapes, because agencies write both. Bloomington puts "Pilot: Raisbeck"
 * on its own line among lines worth keeping, so that line goes and the rest
 * stays. Yuma writes "Employee #6724" inside a sentence describing the flight,
 * so the identifier is replaced and the sentence survives.
 *
 * This runs at collection time, before anything is written to disk, because
 * the raw store is committed to a public repository and no field-level rule
 * catches a name inside prose.
 */
export function redactPeople(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const kept = v
    .split(/\r?\n/)
    .filter(line => line.trim() && !NAMES_A_PERSON.test(line))
    .map(line => line.replace(NAMES_A_PERSON_INLINE, m => {
      const keyword = m.match(/^[A-Za-z]+/)?.[0] ?? '';
      return `${keyword} [removed]`;
    }));
  const out = kept.join('\n').trim();
  return out.length ? out : null;
}

/**
 * Scrub free text of the lines that name people, keeping the rest.
 *
 * Bloomington's notes read "Requested by: Training / Reason: Training / Pilot:
 * Raisbeck / …". The reason is worth keeping and the pilot is not, and both sit
 * in one string, so the split has to happen inside the text.
 */
export function scrubText(v: unknown): string | null {
  if (typeof v === 'string' && EMPTY.test(v.trim())) return null;
  const redacted = redactPeople(v);
  if (redacted === null) return null;
  const out = redacted.split(/\r?\n/).map(l => l.trim()).filter(Boolean).join('; ').replace(/\s+/g, ' ').trim();
  return out.length ? out : null;
}


/** "15 mins", "2 hours of training", "14 MINUTES flying tethered" to minutes. */
export function minutesFromText(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const hours = v.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i);
  const mins = v.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b/i);
  let total = 0;
  if (hours) total += Number(hours[1]) * 60;
  if (mins) total += Number(mins[1]);
  if (!hours && !mins) return null;
  return Number.isFinite(total) && total > 0 ? Math.round(total * 10) / 10 : null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** ArcGIS renders an empty value as the literal text "<Null>". */
const EMPTY = /^(<null>|null|n\/a|none|-|--)$/i;

function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length && !EMPTY.test(t) ? t : null;
  }
  if (typeof v === 'number') return String(v);
  return null;
}

/** Epoch milliseconds to a calendar date in the agency's timezone. */
function dateOf(v: unknown, tz: string): string | null {
  const ms = num(v);
  if (ms === null) return null;
  // ArcGIS date fields are UTC midnight for a local calendar day, so reading
  // them in the agency's zone would shift them back a day. Read them as UTC.
  const iso = new Date(ms).toISOString();
  return /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

/** "8:58 PM" or "20:58" to hours and minutes. */
export function parseClock(v: unknown): { hour: number; minute: number } | null {
  if (typeof v !== 'string') return null;
  const ampm = v.trim().match(/^(\d{1,2}):(\d{2})\s*([AaPp])\.?[Mm]\.?$/);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === 'p') hour += 12;
    const minute = Number(ampm[2]);
    return minute <= 59 ? { hour, minute } : null;
  }
  const h24 = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const hour = Number(h24[1]), minute = Number(h24[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
  }
  return null;
}

export function keepRow(attrs: Record<string, unknown>, filter: SelfPubSite['row_filter']): boolean {
  if (!filter) return true;
  const v = str(attrs[filter.field]);
  if (!v) return false;
  return filter.values.some(want => v.toLowerCase().includes(want.toLowerCase()));
}

export function toRecord(site: SelfPubSite, attrs: Record<string, unknown>): FlightRecord | null {
  const f = site.fields;
  const id = str(attrs[site.id_field]);
  if (!id) return null;

  const date = dateOf(attrs[f.date], site.timezone);
  if (!date) return null;

  const clock = f.time ? parseClock(attrs[f.time]) : null;
  const [y, mo, d] = date.split('-').map(Number);
  const takeoff = clock ? utcFromWallTime(y, mo, d, clock.hour, clock.minute, site.timezone) : null;

  const duration =
    (f.duration_minutes ? num(attrs[f.duration_minutes]) : null)
    ?? (f.duration_hours ? (num(attrs[f.duration_hours]) !== null ? Math.round(num(attrs[f.duration_hours])! * 60 * 10) / 10 : null) : null)
    ?? (f.duration_text ? minutesFromText(attrs[f.duration_text]) : null);

  const extra: Record<string, string | number | null> = {};
  for (const [label, field] of Object.entries(f.extra ?? {})) {
    const v = scrubText(attrs[field]) ?? str(attrs[field]);
    if (v !== null) extra[label] = v;
  }

  return {
    agency_id: site.agency_id,
    source_flight_id: id,
    takeoff_utc: takeoff,
    flight_date_local: takeoff ? localDate(Date.parse(takeoff), site.timezone) : date,
    landing_utc: takeoff && duration !== null ? new Date(Date.parse(takeoff) + duration * 60_000).toISOString() : null,
    duration_min: duration !== null && duration >= 0 ? duration : null,
    purpose: (f.purpose ? scrubText(attrs[f.purpose]) : null)
      ?? (f.purpose_labelled ? labelled(attrs[f.purpose_labelled.field], f.purpose_labelled.label) : null),
    description: f.location ? scrubText(attrs[f.location]) : null,
    case_number: f.case_number ? str(attrs[f.case_number]) : null,
    extra,
    data_quality: site.data_quality ?? null,
  };
}
