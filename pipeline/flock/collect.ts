import { chromium, type BrowserContext, type Page } from 'playwright';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractFlights, PAGE_SIZE, type FlockFlight } from './parse.js';
import { acquireLock } from '../lock.js';

/**
 * Collector for Flock Aerodome community dashboards.
 *
 * Three things about this source shape the design:
 *
 *   1. Every dashboard sits behind a Cloudflare challenge, and the clearance
 *      cookie is bound to the browser that solved it. A plain HTTP client is
 *      redirected away, so collection runs in a real browser and asks the page
 *      to fetch its own data.
 *   2. The list pages eight flights at a time and ignores any page-size
 *      parameter, so a busy agency-month is dozens of requests.
 *   3. Paging stops responding past roughly 250 pages, which is fewer flights
 *      than a large agency publishes in a year. So the crawl walks one month at
 *      a time — bounded, resumable, and small enough to stay inside the cap.
 *
 * Raw flights are appended to a per-agency JSONL file as they arrive. An
 * interrupted run loses nothing, and re-parsing later never needs the network.
 */

export type Site = { host: string; display_name: string; state: string | null; agency_id: string; url: string };

export type MonthState = { flights: number; pages: number; collected_utc: string };
export type AgencyState = {
  agency_id: string;
  host: string;
  months: Record<string, MonthState>;
  total_flights: number;
  last_run_utc: string | null;
  last_error: string | null;
};
export type CollectState = { updated_utc: string; agencies: Record<string, AgencyState> };

const RAW_DIR = join('data', 'raw', 'flock');
const STATE_PATH = join(RAW_DIR, '_state.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

/** Months, oldest first, from `from` through `to` inclusive; both YYYY-MM. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return out;
}

/** First day of the month, and first day of the month after it. */
export function monthRange(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return { start: `${month}-01`, end: next };
}

/**
 * A month already collected is re-collected only if it is recent. Agencies
 * publish late — a flight can appear days after it flew — so the current month
 * and the one before it are always re-read, and older months are trusted.
 */
export function needsCollection(state: AgencyState | undefined, month: string, today: string): boolean {
  const done = state?.months[month];
  if (!done) return true;
  const recent = monthsBetween(month, today.slice(0, 7)).length <= 2;
  return recent;
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

/** Flight numbers already stored for an agency, so a re-read appends nothing twice. */
export function knownFlightIds(path: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(path)) return ids;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as FlockFlight;
      if (typeof o.flight_number === 'string') ids.add(o.flight_number);
    } catch {
      // A truncated final line from an interrupted write: ignore it; the flight
      // it described will be re-fetched and appended cleanly.
    }
  }
  return ids;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Load the dashboard once and wait out the Cloudflare challenge. */
async function openDashboard(ctx: BrowserContext, host: string): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto(`https://${host}/flights`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(1500);
    const title = await page.title().catch(() => '');
    if (!/just a moment/i.test(title)) break;
  }
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
  const title = await page.title().catch(() => '');
  if (/just a moment/i.test(title)) throw new Error(`Cloudflare challenge did not clear for ${host}`);
  return page;
}

/** Ask the page to fetch one list page and hand back the raw payload. */
async function fetchPage(page: Page, query: string): Promise<string> {
  return page.evaluate(async q => {
    const res = await fetch('/flights' + q, { headers: { RSC: '1' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.text();
  }, query);
}

export type CollectOptions = {
  since?: string;
  only?: string[];
  requestDelayMs?: number;
  maxPagesPerMonth?: number;
  concurrency?: number;
  log?: (msg: string) => void;
};

/**
 * Split work across N workers, each taking the next agency when it finishes
 * one. Every agency is a separate host, so concurrency here does not raise the
 * request rate any single dashboard sees — that stays governed by the delay
 * between page fetches.
 */
export async function inParallel<T>(items: T[], workers: number, run: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const take = async () => {
    while (next < items.length) {
      const i = next++;
      await run(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(workers, items.length)) }, take));
}

export async function collectAgency(
  page: Page,
  site: Site,
  state: CollectState,
  months: string[],
  opts: Required<Pick<CollectOptions, 'requestDelayMs' | 'maxPagesPerMonth' | 'log'>>,
): Promise<number> {
  const outPath = join(RAW_DIR, `${site.agency_id}.jsonl`);
  const known = knownFlightIds(outPath);
  const agency: AgencyState = state.agencies[site.agency_id] ?? {
    agency_id: site.agency_id, host: site.host, months: {}, total_flights: 0, last_run_utc: null, last_error: null,
  };
  state.agencies[site.agency_id] = agency;
  let added = 0;

  for (const month of months) {
    const { start, end } = monthRange(month);
    let pageNo = 1;
    let monthFlights = 0;
    let emptyRun = 0;

    while (pageNo <= opts.maxPagesPerMonth) {
      const query = `?start_datetime=${start}&end_datetime=${end}&page=${pageNo}`;
      let payload: string;
      try {
        payload = await fetchPage(page, query);
      } catch (e) {
        opts.log(`    ${site.agency_id} ${month} page ${pageNo}: ${e instanceof Error ? e.message : String(e)}`);
        await sleep(opts.requestDelayMs * 4);
        emptyRun++;
        if (emptyRun >= 3) break;
        continue;
      }

      const flights = extractFlights(payload);
      if (flights.length === 0) break;

      const fresh = flights.filter(f => f.flight_number && !known.has(f.flight_number));
      for (const f of fresh) {
        known.add(f.flight_number!);
        appendFileSync(outPath, JSON.stringify(f) + '\n');
      }
      added += fresh.length;
      monthFlights += flights.length;

      // A short page is the last page.
      if (flights.length < PAGE_SIZE) { pageNo++; break; }
      pageNo++;
      await sleep(opts.requestDelayMs);
    }

    agency.months[month] = { flights: monthFlights, pages: pageNo - 1, collected_utc: new Date().toISOString() };
    if (monthFlights > 0) opts.log(`    ${month}: ${monthFlights} flights over ${pageNo - 1} pages`);
    saveState(state);
    await sleep(opts.requestDelayMs);
  }

  agency.total_flights = known.size;
  agency.last_run_utc = new Date().toISOString();
  agency.last_error = null;
  saveState(state);
  return added;
}

export async function collect(opts: CollectOptions = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const requestDelayMs = opts.requestDelayMs ?? 1200;
  const maxPagesPerMonth = opts.maxPagesPerMonth ?? 240;
  const since = opts.since ?? '2024-01';
  const today = new Date().toISOString().slice(0, 10);

  mkdirSync(RAW_DIR, { recursive: true });
  const release = acquireLock(RAW_DIR, 'flock');
  const sites: Site[] = JSON.parse(readFileSync(join('data', 'flock_sites.json'), 'utf8')).sites;
  const targets = opts.only?.length ? sites.filter(s => opts.only!.includes(s.agency_id)) : sites;
  if (targets.length === 0) throw new Error('No matching Flock sites. Check --agency values against data/flock_sites.json.');

  const state = loadState();
  const allMonths = monthsBetween(since, today.slice(0, 7));
  log(`Flock collection: ${targets.length} agencies, months ${allMonths[0]} to ${allMonths[allMonths.length - 1]}`);

  const browser = await chromium.launch();
  let ok = 0, failed = 0, totalAdded = 0;

  try {
    await inParallel(targets, opts.concurrency ?? 3, async (site, i) => {
      const label = `[${i + 1}/${targets.length}] ${site.display_name}`;
      const months = allMonths.filter(m => needsCollection(state.agencies[site.agency_id], m, today));
      if (months.length === 0) { log(`${label}: up to date`); ok++; return; }
      log(`${label} (${site.agency_id}) — ${months.length} month(s)`);

      const ctx = await browser.newContext({ userAgent: UA, viewport: { width: 1400, height: 900 } });
      try {
        const page = await openDashboard(ctx, site.host);
        const added = await collectAgency(page, site, state, months, { requestDelayMs, maxPagesPerMonth, log: m => log(m) });
        totalAdded += added;
        log(`${label}: +${added} new flights (${state.agencies[site.agency_id].total_flights} stored)`);
        ok++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`${label}: FAILED — ${msg}`);
        const prev = state.agencies[site.agency_id];
        state.agencies[site.agency_id] = prev
          ? { ...prev, last_run_utc: new Date().toISOString(), last_error: msg }
          : { agency_id: site.agency_id, host: site.host, months: {}, total_flights: 0, last_run_utc: new Date().toISOString(), last_error: msg };
        saveState(state);
        failed++;
      } finally {
        await ctx.close();
      }
    });
  } finally {
    await browser.close();
    release();
  }

  log(`Done. ${ok} agencies collected, ${failed} failed, ${totalAdded} new flights this run.`);
  const stored = readdirSync(RAW_DIR).filter(f => f.endsWith('.jsonl')).length;
  log(`Raw store: ${stored} agency files in ${RAW_DIR}`);
}

function parseArgs(argv: string[]): CollectOptions {
  const o: CollectOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--since') o.since = argv[++i];
    else if (a === '--agency') (o.only ??= []).push(argv[++i]);
    else if (a === '--delay') o.requestDelayMs = Number(argv[++i]);
    else if (a === '--concurrency') o.concurrency = Number(argv[++i]);
  }
  return o;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pipeline/flock/collect.ts');
if (isMain) {
  collect(parseArgs(process.argv.slice(2))).catch(e => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
}
