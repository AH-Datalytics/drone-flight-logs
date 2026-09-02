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
  /** [weekday][hour] -> median flight length in minutes, or null when that cell has no flights with a known duration. */
  medianMin: (number | null)[][];
  maxCount: number;
  maxMedian: number;
};

/**
 * Buckets flights into a 7 (weekday) x 24 (hour) grid, keyed off the same local instant
 * (derived from takeoff_utc + the agency's timezone) for both axes so the count grid and
 * the duration grid line up cell-for-cell. Returns null when no record has a takeoff time,
 * mirroring byHour's "no time data published" case.
 */
export function heatmapGrids(recs: FlightRecord[], tz: string): HeatGrids | null {
  const count: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const durs: number[][][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => [] as number[]));
  let any = false;
  for (const r of recs) {
    if (!r.takeoff_utc) continue;
    any = true;
    const ms = Date.parse(r.takeoff_utc);
    const wd = localWeekday(ms, tz);
    const hr = localHour(ms, tz);
    count[wd][hr]++;
    if (typeof r.duration_min === 'number') durs[wd][hr].push(r.duration_min);
  }
  if (!any) return null;
  let maxCount = 0, maxMedian = 0;
  const medianMin: (number | null)[][] = count.map((row, wd) => row.map((c, hr) => {
    if (c > maxCount) maxCount = c;
    const arr = durs[wd][hr];
    if (!arr.length) return null;
    arr.sort((a, b) => a - b);
    const med = arr[Math.floor(arr.length / 2)];
    if (med > maxMedian) maxMedian = med;
    return med;
  }));
  return { count, medianMin, maxCount, maxMedian };
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
