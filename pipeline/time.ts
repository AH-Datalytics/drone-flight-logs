const dateFmts = new Map<string, Intl.DateTimeFormat>();
const hourFmts = new Map<string, Intl.DateTimeFormat>();

function dateFmt(tz: string): Intl.DateTimeFormat {
  let f = dateFmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); dateFmts.set(tz, f); }
  return f;
}
function hourFmt(tz: string): Intl.DateTimeFormat {
  let f = hourFmts.get(tz);
  if (!f) { f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }); hourFmts.set(tz, f); }
  return f;
}

/** YYYY-MM-DD for the instant in the given IANA timezone. */
export function localDate(utcMs: number, tz: string): string {
  return dateFmt(tz).format(new Date(utcMs));
}

/** 0–23 hour for the instant in the given IANA timezone. */
export function localHour(utcMs: number, tz: string): number {
  return parseInt(hourFmt(tz).format(new Date(utcMs)), 10) % 24;
}

/**
 * Coarse US timezone from a point. Good enough to seed a registry field that a
 * human can correct. Known weak spots: Indiana (Eastern, but west of -85 here
 * reads Central), western Kansas/Nebraska (Mountain), Florida panhandle west of
 * -85.5 (Central). Returns null outside the US so the caller falls back to UTC
 * and flags the agency for manual review.
 */
export function timezoneForPoint(lon: number, lat: number): string | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lat > 51 && lat < 72 && lon < -129 && lon > -170) return 'America/Anchorage';
  if (lat > 18 && lat < 23 && lon < -154 && lon > -161) return 'Pacific/Honolulu';
  if (lat < 24 || lat > 49.5 || lon < -125 || lon > -66) return null;
  if (lat > 31 && lat < 37.1 && lon < -109 && lon > -115) return 'America/Phoenix';
  if (lon < -114) return 'America/Los_Angeles';
  if (lon < (lat < 37 ? -103 : -102)) return 'America/Denver';
  if (lon < -85) return 'America/Chicago';
  return 'America/New_York';
}
