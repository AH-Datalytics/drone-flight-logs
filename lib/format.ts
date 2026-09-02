export function fmtInt(n: number | null | undefined): string { return n === null || n === undefined ? '—' : n.toLocaleString('en-US'); }
export function fmtHours(h: number | null | undefined): string { return h === null || h === undefined ? '—' : h >= 100 ? Math.round(h).toLocaleString('en-US') : h.toFixed(1); }
export function fmtDate(ymd: string | null | undefined): string {
  if (!ymd) return '—';
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
}
export function daysSince(ymd: string | null | undefined, now: Date): number | null {
  if (!ymd) return null;
  return Math.floor((now.getTime() - Date.parse(ymd + 'T00:00:00Z')) / 86400000);
}
export function fmtMinutes(m: number | null | undefined): string { return m === null || m === undefined ? '—' : m < 10 ? m.toFixed(1) : String(Math.round(m)); }
