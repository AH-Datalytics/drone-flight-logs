import type { FlightRecord } from '@/pipeline/schema';
import { localHour } from '@/pipeline/time';

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

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export function byWeekday(recs: FlightRecord[]): Bar[] {
  const c = new Array(7).fill(0);
  for (const r of recs) if (r.flight_date_local) { const d = new Date(r.flight_date_local + 'T00:00:00Z').getUTCDay(); c[(d + 6) % 7]++; }
  return WD.map((label, i) => ({ label, value: c[i] }));
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

export function purposeTop(recs: FlightRecord[], n: number): Bar[] {
  const c = new Map<string, number>();
  for (const r of recs) { const k = r.purpose && r.purpose.trim() ? r.purpose.trim() : 'Not stated'; c.set(k, (c.get(k) ?? 0) + 1); }
  const sorted = [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const head = sorted.slice(0, n).map(([label, value]) => ({ label, value }));
  const tail = sorted.slice(n);
  if (tail.length) head.push({ label: `Other (${tail.length} values)`, value: tail.reduce((s, [, v]) => s + v, 0) });
  return head;
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
  };
}
