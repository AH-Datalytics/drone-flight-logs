import type { FlightRecord } from '../schema.js';
import { utcFromWallTime } from '../time.js';

/**
 * AirData hosts public "Drone Program Historical Flight Data" pages for
 * agencies that fly DJI aircraft. The page is server-rendered, six flights to
 * a page, with a month list down the side that carries a published count per
 * month — which makes the crawl count-verifiable rather than guessed.
 *
 * Agencies choose their own fields. Chula Vista publishes a case number, Las
 * Vegas publishes only a date, time and location. So the detail table is read
 * as label/value pairs rather than fixed columns, and unfamiliar labels are
 * kept rather than dropped.
 */

export type AirDataFlight = {
  flight_id: string;
  fields: Record<string, string>;
};

export type MonthCount = { month: string; count: number };

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** The side menu's months and the flight count the agency publishes for each. */
export function parseMonthCounts(html: string): MonthCount[] {
  const out: MonthCount[] = [];
  const seen = new Set<string>();
  const re = /'month':'(\d{1,2})(\d{4})'[\s\S]{0,400}?\((\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const month = `${m[2]}-${m[1].padStart(2, '0')}`;
    if (seen.has(month)) continue;
    seen.add(month);
    out.push({ month, count: Number(m[3]) });
  }
  return out.sort((a, b) => (a.month < b.month ? -1 : 1));
}

/** The six flights on one page, each as its label/value pairs. */
export function parseFlights(html: string): AirDataFlight[] {
  const out: AirDataFlight[] = [];
  const ids = [...html.matchAll(/data-flightid='(\d+)'/g)].map(m => m[1]);
  const blocks = [...html.matchAll(/<table class='record-view'([\s\S]*?)<\/table>/g)].map(m => m[1]);

  blocks.forEach((block, i) => {
    const fields: Record<string, string> = {};
    for (const p of block.matchAll(/<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>/g)) {
      const label = text(p[1]);
      const value = text(p[2]);
      if (label && value) fields[label] = value;
    }
    if (Object.keys(fields).length === 0) return;
    out.push({ flight_id: ids[i] ?? `row-${i}`, fields });
  });

  return out;
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "7-31-26" or "07/31/2026" or "Jul 31, 2026" to YYYY-MM-DD. */
export function parseDate(v: string): string | null {
  const numeric = v.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/);
  if (numeric) {
    const mo = Number(numeric[1]), d = Number(numeric[2]);
    let y = Number(numeric[3]);
    if (numeric[3].length === 2) y += 2000;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const named = v.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/);
  if (named) {
    const mo = MONTH_NAMES.indexOf(named[1].slice(0, 3).toLowerCase());
    if (mo === -1) return null;
    return `${named[3]}-${String(mo + 1).padStart(2, '0')}-${String(Number(named[2])).padStart(2, '0')}`;
  }
  return null;
}

/** "9:59pm" or "21:59" to hours and minutes. */
export function parseTime(v: string): { hour: number; minute: number } | null {
  const ampm = v.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (ampm[3].toLowerCase() === 'p') hour += 12;
    const minute = Number(ampm[2]);
    if (minute > 59) return null;
    return { hour, minute };
  }
  const h24 = v.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (h24) {
    const hour = Number(h24[1]), minute = Number(h24[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }
  return null;
}

function pick(fields: Record<string, string>, ...labels: string[]): string | null {
  for (const label of labels) {
    for (const [k, v] of Object.entries(fields)) {
      if (k.toLowerCase() === label.toLowerCase()) return v;
    }
  }
  return null;
}

const KNOWN = ['date', 'time', 'location', 'summary', 'case/incident', 'case', 'incident', 'case number'];

/**
 * One AirData flight to one FlightRecord.
 *
 * AirData publishes no flight duration, so `duration_min` is null for every
 * record from this source. That is a property of the source, and the agency
 * page says so rather than showing a zero.
 */
export function toRecord(agencyId: string, timezone: string, f: AirDataFlight): FlightRecord | null {
  const dateRaw = pick(f.fields, 'Date');
  const date = dateRaw ? parseDate(dateRaw) : null;
  if (!date) return null;

  const timeRaw = pick(f.fields, 'Time');
  const time = timeRaw ? parseTime(timeRaw) : null;
  const [y, mo, d] = date.split('-').map(Number);
  const takeoff = time ? utcFromWallTime(y, mo, d, time.hour, time.minute, timezone) : null;

  const extra: Record<string, string | number | null> = {};
  for (const [k, v] of Object.entries(f.fields)) {
    if (!KNOWN.includes(k.toLowerCase())) extra[k] = v;
  }

  return {
    agency_id: agencyId,
    source_flight_id: f.flight_id,
    takeoff_utc: takeoff,
    flight_date_local: date,
    landing_utc: null,
    duration_min: null,
    purpose: pick(f.fields, 'Summary'),
    description: pick(f.fields, 'Location'),
    case_number: pick(f.fields, 'Case/Incident', 'Case', 'Incident', 'Case Number'),
    extra,
    data_quality: 'AirData publishes no flight duration or landing time.',
  };
}

/** Flights per page on an AirData portal. The page size is fixed. */
export const PAGE_SIZE = 6;
