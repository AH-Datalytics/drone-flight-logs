import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { acquireLock } from '../lock.js';
import { slim, type DroneSenseFlight } from './parse.js';

/**
 * Collector for DroneSense public dashboards.
 *
 * The dashboard shows the current month; the API behind it takes a date range,
 * which is the whole reason this platform looked dead. Collection asks for
 * everything from 2015 and pages until the service stops returning a full
 * page.
 *
 * Additive, like the other vendor sources: an agency that shortens what it
 * publishes should not silently shorten the archive.
 */

export type DroneSenseSite = { agency_id: string; slug: string; display_name: string; state: string | null; timezone: string };

export type AgencyState = {
  agency_id: string; slug: string; total_flights: number;
  first_flight: string | null; last_flight: string | null;
  last_run_utc: string | null; last_error: string | null;
};
export type CollectState = { updated_utc: string; agencies: Record<string, AgencyState> };

const RAW_DIR = join('data', 'raw', 'dronesense');
const STATE_PATH = join(RAW_DIR, '_state.json');
const API = 'https://external.dronesense.com/v1/DashboardPages';
const UA = 'drone-flight-logs (+https://github.com/AH-Datalytics/drone-flight-logs)';
const PAGE_SIZE = 500;
const FROM = '2015-01-01T00:00:00.000Z';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function knownFlightIds(path: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(path)) return ids;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as DroneSenseFlight;
      if (typeof o.id === 'string') ids.add(o.id);
    } catch { /* truncated final line */ }
  }
  return ids;
}

async function getJson(url: string, tries = 4): Promise<unknown> {
  let lastErr: Error = new Error('unreachable');
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 140)}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await sleep(900 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function collect(opts: { only?: string[]; log?: (m: string) => void } = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  mkdirSync(RAW_DIR, { recursive: true });
  const release = acquireLock(RAW_DIR, 'dronesense');

  const sites: DroneSenseSite[] = JSON.parse(readFileSync(join('data', 'dronesense_sites.json'), 'utf8')).sites;
  const targets = opts.only?.length ? sites.filter(s => opts.only!.includes(s.agency_id) || opts.only!.includes(s.slug)) : sites;
  if (targets.length === 0) throw new Error('No matching DroneSense sites. Check data/dronesense_sites.json.');

  const state: CollectState = existsSync(STATE_PATH)
    ? JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    : { updated_utc: new Date().toISOString(), agencies: {} };

  const until = new Date(Date.now() + 86_400_000).toISOString();
  let ok = 0, failed = 0, totalAdded = 0;
  log(`DroneSense collection: ${targets.length} agencies`);

  for (const [i, site] of targets.entries()) {
    const outPath = join(RAW_DIR, `${site.agency_id}.jsonl`);
    const known = knownFlightIds(outPath);
    try {
      let added = 0, seen = 0;
      const dates: string[] = [];
      for (let page = 1; ; page++) {
        const url = `${API}/Flights?url=${encodeURIComponent(site.slug)}&images=false`
          + `&page=${page}&pageSize=${PAGE_SIZE}&startDate=${FROM}&endDate=${encodeURIComponent(until)}`;
        const body = await getJson(url);
        const rows = Array.isArray(body) ? body as Record<string, unknown>[] : [];
        if (rows.length === 0) break;
        seen += rows.length;
        for (const raw of rows) {
          const f = slim(raw);
          if (!f.id || known.has(f.id)) continue;
          known.add(f.id);
          appendFileSync(outPath, JSON.stringify(f) + '\n');
          added++;
          if (f.startDate) dates.push(f.startDate);
        }
        if (rows.length < PAGE_SIZE) break;
        await sleep(400);
      }

      dates.sort();
      const prev = state.agencies[site.agency_id];
      state.agencies[site.agency_id] = {
        agency_id: site.agency_id, slug: site.slug, total_flights: known.size,
        first_flight: [prev?.first_flight, dates[0]].filter(Boolean).sort()[0] ?? null,
        last_flight: [prev?.last_flight, dates[dates.length - 1]].filter(Boolean).sort().pop() ?? null,
        last_run_utc: new Date().toISOString(), last_error: null,
      };
      totalAdded += added;
      log(`[${i + 1}/${targets.length}] ${site.display_name}: ${seen} in the feed, +${added} new, ${known.size} stored`);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[${i + 1}/${targets.length}] ${site.display_name}: FAILED — ${msg}`);
      const prev = state.agencies[site.agency_id];
      state.agencies[site.agency_id] = {
        agency_id: site.agency_id, slug: site.slug, total_flights: prev?.total_flights ?? 0,
        first_flight: prev?.first_flight ?? null, last_flight: prev?.last_flight ?? null,
        last_run_utc: new Date().toISOString(), last_error: msg,
      };
      failed++;
    }
    state.updated_utc = new Date().toISOString();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 1) + '\n');
    await sleep(600);
  }

  release();
  log(`Done. ${ok} agencies collected, ${failed} failed, ${totalAdded} new flights this run.`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pipeline/dronesense/collect.ts');
if (isMain) {
  const only: string[] = [];
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--agency') only.push(process.argv[++i]);
  collect({ only }).catch(e => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
}
