import type { FlightRecord } from '@/pipeline/schema';
import { localHour, localDate } from '@/pipeline/time';

export type Bar = { label: string; value: number };

export function monthly(recs: FlightRecord[]): Bar[] {
  const counts = new Map<string, number>();
  for (const r of recs) if (r.flight_date_local) { const k = r.flight_date_local.slice(0, 7); counts.set(k, (counts.get(k) ?? 0) + 1); }
  if (!counts.size) return [];
  const keys = [...counts.keys()].sort();
  const out: Bar[] = [];
  let [y, m] = keys[0].split('-').map(Number);
  const [ey, em] = keys[keys.length - 1].split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push({ label: k, value: counts.get(k) ?? 0 });
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function byWeekday(recs: FlightRecord[]): Bar[] {
  const c = new Array(7).fill(0);
  for (const r of recs) if (r.flight_date_local) { const d = new Date(r.flight_date_local + 'T00:00:00Z').getUTCDay(); c[(d + 6) % 7]++; }
  return WEEKDAYS.map((label, i) => ({ label, value: c[i] }));
}

/** Mon=0..Sun=6 for the local calendar date (YYYY-MM-DD) an instant falls on in `tz`. */
function localWeekday(utcMs: number, tz: string): number {
  const d = new Date(localDate(utcMs, tz) + 'T00:00:00Z').getUTCDay();
  return (d + 6) % 7;
}

export type HeatGrids = {
  /** [weekday 0=Mon..6=Sun][hour 0..23] -> flight count. */
  count: number[][];
  maxCount: number;
  /**
   * [weekday][hour] -> average flight length in minutes, or null where no flight
   * in that hour has a recorded duration. Null is not zero: a cell with flights
   * but no durations is unknown, and drawing it as a zero-minute flight would
   * be a lie the eye reads as fact.
   */
  avgMin: (number | null)[][];
  maxAvg: number;
  /** The shortest average in the grid, so the duration scale can start there. */
  minAvg: number;
};

/**
 * Buckets flights into a 7 (weekday) x 24 (hour) grid, using the local instant derived
 * from takeoff_utc and the agency's timezone for both axes. Returns null when no record
 * has a takeoff time, mirroring byHour's "no time data published" case.
 */
export function heatmapGrids(recs: FlightRecord[], tz: string): HeatGrids | null {
  const count: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const durations: number[][][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => [] as number[]));
  let any = false;
  for (const r of recs) {
    if (!r.takeoff_utc) continue;
    any = true;
    const ms = Date.parse(r.takeoff_utc);
    const wd = localWeekday(ms, tz), hr = localHour(ms, tz);
    count[wd][hr]++;
    if (typeof r.duration_min === 'number') durations[wd][hr].push(r.duration_min);
  }
  if (!any) return null;

  let maxCount = 0, maxAvg = 0, minAvg = Infinity;
  for (const row of count) for (const c of row) if (c > maxCount) maxCount = c;

  // Rounded to a tenth: a mean of a handful of durations lands on a repeating
  // decimal, and "12.333333333333334 min" in a tooltip is noise, not precision.
  const avgMin: (number | null)[][] = durations.map(row => row.map(cell => {
    if (!cell.length) return null;
    const avg = Math.round((cell.reduce((t, v) => t + v, 0) / cell.length) * 10) / 10;
    if (avg > maxAvg) maxAvg = avg;
    if (avg < minAvg) minAvg = avg;
    return avg;
  }));

  return { count, maxCount, avgMin, maxAvg, minAvg: Number.isFinite(minAvg) ? minAvg : 0 };
}

export function byHour(recs: FlightRecord[], tz: string): Bar[] | null {
  const c = new Array(24).fill(0); let any = false;
  for (const r of recs) if (r.takeoff_utc) { any = true; c[localHour(Date.parse(r.takeoff_utc), tz)]++; }
  return any ? c.map((v, i) => ({ label: String(i), value: v })) : null;
}

export function durationBins(recs: FlightRecord[]): Bar[] | null {
  const c = new Array(13).fill(0); let any = false;
  for (const r of recs) if (typeof r.duration_min === 'number') { any = true; c[Math.min(12, Math.floor(r.duration_min / 5))]++; }
  if (!any) return null;
  return c.map((v, i) => ({ label: i === 12 ? '60+' : `${i * 5}–${i * 5 + 5}`, value: v }));
}

/** The categorical value the purpose filter groups and matches on: trimmed `purpose`, or "Not stated" when blank. */
export function normalizePurpose(p: string | null | undefined): string {
  return p && p.trim() ? p.trim() : 'Not stated';
}

/**
 * How many purposes to offer in the agency page's filter. A select with several hundred
 * options is a haystack, not a filter: SFPD alone publishes 435 distinct purpose strings
 * because its older records are free text. The rest are reachable via the flight table's
 * text search.
 *
 * This lives here rather than beside the component on purpose. Next turns every export of
 * a 'use client' module into an opaque client reference, so a plain number exported from a
 * client component reads as an object on the server — and `slice(0, thatObject)` silently
 * returns an empty array rather than throwing.
 */
export const PURPOSE_OPTION_CAP = 20;

/**
 * Whether a source's description field holds what the incident was, or where it
 * happened. Skydio and San Francisco publish an event type — DISTURBANCE,
 * PERSON W/GUN. Flock, AirData and Motorola publish a street address in the
 * same slot. Charting them together would mix crime types with intersections,
 * so the event chart draws only on the sources that mean an event by it.
 */
export const DESCRIPTION_IS_EVENT: Record<string, boolean> = {
  skydio_arcgis: true,
  sfpd_datasf: true,
  flock_aerodome: false,
  airdata: false,
  motorola_cape: false,
  // DroneSense puts a street address here; BRINC publishes none at all.
  dronesense: false,
  brinc: false,
  self_published: false,
};

/**
 * Below this many recorded durations, a length histogram or a median describes
 * a handful of flights while looking like it describes the agency. Las Vegas
 * has durations on three of twenty-two thousand flights — the three that came
 * from a second platform — and charting those three would be worse than
 * showing nothing.
 */
export const MIN_DURATIONS_TO_CHART = 20;

/** How many flights carry a recorded duration. */
export function durationCount(recs: FlightRecord[]): number {
  let n = 0;
  for (const r of recs) if (typeof r.duration_min === 'number') n++;
  return n;
}

/** Below this many event descriptions the chart says more about the gap than the flights. */
export const MIN_EVENTS_TO_CHART = 20;

/** Flights whose source publishes an event description rather than an address. */
export function eventRecords(recs: (FlightRecord & { source?: string })[]): (FlightRecord & { source?: string })[] {
  return recs.filter(r => r.source !== undefined && DESCRIPTION_IS_EVENT[r.source] === true && r.description);
}

/**
 * The most common event descriptions, with the rest gathered into one bar.
 *
 * Agencies enter these by hand, so one category arrives in several spellings:
 * Colorado Springs alone publishes DISTURBANCE, Disturbance and disturbance as
 * separate values. They are counted together and labeled with whichever
 * spelling that agency uses most, because a list of the fifteen most common
 * events should not spend three of its rows on one event.
 */
export function eventTop(recs: (FlightRecord & { source?: string })[], n: number): Bar[] {
  const counts = new Map<string, number>();
  const spellings = new Map<string, Map<string, number>>();
  for (const r of eventRecords(recs)) {
    // Collapse runs of whitespace before anything else, so a stray double
    // space cannot become a label or a category of its own.
    const raw = (r.description ?? '').trim().replace(/\s+/g, ' ');
    if (!raw) continue;
    const key = raw.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const seen = spellings.get(key) ?? new Map<string, number>();
    seen.set(raw, (seen.get(raw) ?? 0) + 1);
    spellings.set(key, seen);
  }
  // Plain string order for the tie-break, not localeCompare: locale collation
  // sorts "burglary" ahead of "BURGLARY", which would label a group by whichever
  // casing happened to sort first rather than predictably.
  const label = (key: string): string => {
    const seen = spellings.get(key);
    if (!seen) return key;
    return [...seen.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0][0];
  };
  const c = new Map<string, number>([...counts.entries()].map(([k, v]) => [label(k), v]));
  const sorted = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, n).map(([label, value]) => ({ label, value }));
  const tail = sorted.slice(n);
  if (tail.length) head.push({ label: `Other (${tail.length} values)`, value: tail.reduce((s, [, v]) => s + v, 0) });
  return head;
}

export function purposeTop(recs: FlightRecord[], n: number): Bar[] {
  const c = new Map<string, number>();
  for (const r of recs) { const k = normalizePurpose(r.purpose); c.set(k, (c.get(k) ?? 0) + 1); }
  const sorted = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, n).map(([label, value]) => ({ label, value }));
  const tail = sorted.slice(n);
  if (tail.length) head.push({ label: `Other (${tail.length} values)`, value: tail.reduce((s, [, v]) => s + v, 0) });
  return head;
}

/**
 * Median number of days between an agency's consecutive published flight dates. This is a
 * publishing-cadence signal, not a flight-frequency one: it calibrates what a gap in
 * publication means for THIS agency (a 40-day silence reads as normal for a monthly
 * publisher and as notable for a daily one). Null when there are fewer than two distinct
 * published dates to measure a gap between.
 */
export function medianPublishGapDays(recs: FlightRecord[]): number | null {
  const dates = [...new Set(recs.map(r => r.flight_date_local).filter((d): d is string => !!d))].sort();
  if (dates.length < 2) return null;
  const gaps: number[] = [];
  for (let i = 1; i < dates.length; i++) gaps.push(Math.round((Date.parse(dates[i] + 'T00:00:00Z') - Date.parse(dates[i - 1] + 'T00:00:00Z')) / 86400000));
  gaps.sort((a, b) => a - b);
  const mid = Math.floor(gaps.length / 2);
  return gaps.length % 2 ? gaps[mid] : Math.round((gaps[mid - 1] + gaps[mid]) / 2);
}

export function stats(recs: FlightRecord[], now: Date) {
  const durs = recs.map(r => r.duration_min).filter((d): d is number => typeof d === 'number').sort((a, b) => a - b);
  const dates = recs.map(r => r.flight_date_local).filter((d): d is string => !!d);
  const last = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : null;
  const cutoff = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10);
  return {
    flights: recs.length,
    hours: Math.round(durs.reduce((s, d) => s + d, 0) / 6) / 10,
    medianMin: durs.length ? durs[Math.floor(durs.length / 2)] : null,
    last30: dates.filter(d => d >= cutoff).length,
    daysSinceLast: last ? Math.floor((now.getTime() - Date.parse(last + 'T00:00:00Z')) / 86400000) : null,
    pctWithCase: recs.length ? Math.round((recs.filter(r => r.case_number).length / recs.length) * 1000) / 10 : 0,
    medianGapDays: medianPublishGapDays(recs),
  };
}

/**
 * Whether an agency's published record is too thin to characterise its drone program,
 * and why. Returns null when the agency should be shown.
 *
 * This exists because a published count is not the same as a program. Las Vegas
 * Metropolitan Police Department published three flights to its Skydio dashboard on a
 * single day in May 2026 and nothing since, while its real program publishes elsewhere
 * and flew at least 72 times in August alone. Showing "3 flights" for one of the largest
 * departments in the country is not a small number — it is a false impression, and no
 * caveat elsewhere on the site repairs it.
 *
 * The test is active days rather than flight count, because that is what separates a
 * trial from a small program. Every agency in the dataset with three or fewer flights
 * flew them across one or two days; agencies with a handful of flights spread over five
 * different days are genuinely small but real. A record that is entirely training and
 * testing is excluded at any size, since it describes a pilot rather than operations.
 */
export const MIN_ACTIVE_DAYS = 3;
const TESTISH = /\b(test|testing|training|demo|demonstration|trial|maintenance|calibrat|firmware|simulator|practice)\b/i;

export function suppressionReason(recs: FlightRecord[]): string | null {
  if (recs.length === 0) return 'no published flights';
  const days = new Set(recs.map(r => r.flight_date_local).filter(Boolean)).size;
  if (days < MIN_ACTIVE_DAYS) return `flights on only ${days} day${days === 1 ? '' : 's'}`;
  const testish = recs.filter(r => TESTISH.test(`${r.purpose ?? ''} ${r.description ?? ''}`)).length;
  if (testish === recs.length) return 'every published flight is testing or training';
  return null;
}
