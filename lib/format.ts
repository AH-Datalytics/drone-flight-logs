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

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2025-03" -> "Mar '25". Used to keep chart x-axis labels short enough to not collide. */
export function fmtMonthLabel(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const mi = parseInt(m[2], 10) - 1;
  if (mi < 0 || mi > 11) return ym;
  return `${SHORT_MONTHS[mi]} '${m[1].slice(2)}`;
}

export type TickPlan = { interval: number; angle: number };

/**
 * Decides how many x-axis category ticks a chart of the given pixel width can show
 * without labels overlapping, and whether they need to be angled to fit.
 * `interval` follows Recharts' XAxis convention: the number of ticks to skip between
 * two shown ticks (0 = show every tick).
 */
export function planTicks(labels: string[], widthPx: number): TickPlan {
  if (labels.length <= 1 || widthPx <= 0) return { interval: 0, angle: 0 };
  const charPx = 6.4;
  const pad = 14;
  const maxLen = Math.max(...labels.map(l => l.length));
  const flatPitch = maxLen * charPx + pad;
  const fitFlat = Math.max(1, Math.floor(widthPx / flatPitch));
  if (fitFlat >= labels.length) return { interval: 0, angle: 0 };
  const angledPitch = 24;
  const fitAngled = Math.max(1, Math.floor(widthPx / angledPitch));
  const step = Math.max(1, Math.ceil(labels.length / Math.max(1, Math.min(fitAngled, labels.length))));
  return { interval: step - 1, angle: -40 };
}
