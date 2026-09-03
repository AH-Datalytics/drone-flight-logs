import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseMonthCounts, parseFlights, PAGE_SIZE, type AirDataFlight } from './parse.js';

/**
 * Collector for AirData public flight-log portals.
 *
 * This source is friendlier than most: plain server-rendered HTML, no
 * challenge, and a side menu that publishes a flight count per month. That
 * count makes the crawl verifiable — a month is complete when the flights
 * collected match the number the agency says it published, and a shortfall is
 * reported rather than quietly accepted.
 *
 * The portal's robots.txt asks for a two-second crawl delay, which this
 * honours, and disallows /kml, which this never requests.
 */

export type AirDataSite = { agency_id: string; slug: string; display_name: string; state: string | null; timezone: string };

export type MonthState = { published: number; collected: number; complete: boolean; collected_utc: string };
export type AgencyState = {
  agency_id: string;
  slug: string;
  months: Record<string, MonthState>;
  total_flights: number;
  last_run_utc: string | null;
  last_error: string | null;
};
export type CollectState = { updated_utc: string; agencies: Record<string, AgencyState> };

const RAW_DIR = join('data', 'raw', 'airdata');
const STATE_PATH = join(RAW_DIR, '_state.json');
const UA = 'police-drone-logs pipeline (jasher@ahdatalytics.com)';
const CRAWL_DELAY_MS = 2000;

/** AirData addresses a month as M + YYYY, with no zero padding. */
export function monthParam(month: string): string {
  const [y, m] = month.split('-');
  return `${Number(m)}${y}`;
}

/** Pages needed for a month, from the count the agency publishes. */
export function pagesFor(count: number): number {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}

/**
 * A month is re-read if it was never collected, if it came up short of the
 * published count, or if it is recent enough that the agency may still be
 * adding to it.
 */
export function needsCollection(state: AgencyState | undefined, month: MonthState | undefined, published: number, isRecent: boolean): boolean {
  if (!month) return true;
  if (!month.complete) return true;
  if (month.published !== published) return true;
  return isRecent;
}

export function loadState(): CollectState {
  if (!existsSync(STATE_PATH)) return { updated_utc: new Date().toISOString(), agencies: {} };
  try {
    return JSON.parse(readFileSync(STATE_PATH, 'utf8')) as CollectState;
  } catch {
    return { updated_utc: new Date().toISOString(), agencies: {} };
  }
}

function saveState(state: CollectState): void {
  state.updated_utc = new Date().toISOString();
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 1) + '\n');
}

export function knownFlightIds(path: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(path)) return ids;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as AirDataFlight;
      if (typeof o.flight_id === 'string') ids.add(o.flight_id);
    } catch {
      // Truncated final line from an interrupted write; the flight is re-read.
    }
  }
  return ids;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getPage(slug: string, month: string, page: number, tries = 4): Promise<string> {
  const url = `https://app.airdata.com/u/${slug}?month=${monthParam(month)}&pageno=${page}`;
  let lastErr: Error = new Error('unreachable');
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.text();
      if (body.length < 5000) throw new Error(`suspiciously short page (${body.length} bytes)`);
      return body;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await sleep(CRAWL_DELAY_MS * 2 ** attempt);
    }
  }
  throw lastErr;
}

export type CollectOptions = {
  only?: string[];
  since?: string;
  log?: (msg: string) => void;
};

export async function collect(opts: CollectOptions = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  mkdirSync(RAW_DIR, { recursive: true });

  const sites: AirDataSite[] = JSON.parse(readFileSync(join('data', 'airdata_sites.json'), 'utf8')).sites;
  const targets = opts.only?.length ? sites.filter(s => opts.only!.includes(s.agency_id) || opts.only!.includes(s.slug)) : sites;
  if (targets.length === 0) throw new Error('No matching AirData sites. Check values against data/airdata_sites.json.');

  const state = loadState();
  const thisMonth = new Date().toISOString().slice(0, 7);
  let ok = 0, failed = 0, totalAdded = 0;

  log(`AirData collection: ${targets.length} portals`);

  for (const [i, site] of targets.entries()) {
    const outPath = join(RAW_DIR, `${site.agency_id}.jsonl`);
    const known = knownFlightIds(outPath);
    const agency: AgencyState = state.agencies[site.agency_id] ?? {
      agency_id: site.agency_id, slug: site.slug, months: {}, total_flights: 0, last_run_utc: null, last_error: null,
    };
    state.agencies[site.agency_id] = agency;

    try {
      log(`[${i + 1}/${targets.length}] ${site.display_name} (${site.slug})`);
      const first = await getPage(site.slug, thisMonth, 1);
      let months = parseMonthCounts(first);
      if (opts.since) months = months.filter(m => m.month >= opts.since!);
      if (months.length === 0) throw new Error('portal published no month list');

      log(`    ${months.length} months, ${months.reduce((t, m) => t + m.count, 0)} flights published`);
      let added = 0;

      for (const { month, count } of months) {
        const isRecent = month >= thisMonth || month === prevMonth(thisMonth);
        if (!needsCollection(agency, agency.months[month], count, isRecent)) continue;
        if (count === 0) {
          agency.months[month] = { published: 0, collected: 0, complete: true, collected_utc: new Date().toISOString() };
          continue;
        }

        let collected = 0;
        for (let p = 1; p <= pagesFor(count); p++) {
          await sleep(CRAWL_DELAY_MS);
          const html = await getPage(site.slug, month, p);
          const flights = parseFlights(html);
          if (flights.length === 0) break;
          collected += flights.length;
          for (const f of flights) {
            if (known.has(f.flight_id)) continue;
            known.add(f.flight_id);
            appendFileSync(outPath, JSON.stringify(f) + '\n');
            added++;
          }
        }

        const complete = collected >= count;
        agency.months[month] = { published: count, collected, complete, collected_utc: new Date().toISOString() };
        if (!complete) log(`    ${month}: collected ${collected} of ${count} published`);
        saveState(state);
      }

      agency.total_flights = known.size;
      agency.last_run_utc = new Date().toISOString();
      agency.last_error = null;
      totalAdded += added;
      log(`    +${added} new flights (${known.size} stored)`);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`    FAILED: ${msg}`);
      agency.last_run_utc = new Date().toISOString();
      agency.last_error = msg;
      failed++;
    }
    saveState(state);
  }

  log(`Done. ${ok} portals collected, ${failed} failed, ${totalAdded} new flights this run.`);
  const short = Object.values(state.agencies).flatMap(a =>
    Object.entries(a.months).filter(([, m]) => !m.complete).map(([mo, m]) => `${a.agency_id} ${mo} ${m.collected}/${m.published}`));
  if (short.length) log(`Months short of the published count: ${short.join(', ')}`);
}

function prevMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

function parseArgs(argv: string[]): CollectOptions {
  const o: CollectOptions = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--agency') (o.only ??= []).push(argv[++i]);
    else if (argv[i] === '--since') o.since = argv[++i];
  }
  return o;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pipeline/airdata/collect.ts');
if (isMain) {
  collect(parseArgs(process.argv.slice(2))).catch(e => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
}
