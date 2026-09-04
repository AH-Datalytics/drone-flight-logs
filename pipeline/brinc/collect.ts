import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { acquireLock } from '../lock.js';
import { slim, type BrincFlight } from './parse.js';

/**
 * Collector for BRINC LiveOps public dashboards.
 *
 * The mission list pages a hundred at a time and ignores a larger limit. The
 * dashboard also publishes an aggregate total, which makes the crawl checkable:
 * a run that ends short of the total the agency itself advertises says so.
 *
 * Additive, like the other vendor sources.
 */

export type BrincSite = { agency_id: string; slug: string; display_name: string; state: string | null; timezone: string };

export type AgencyState = {
  agency_id: string; slug: string; total_flights: number; advertised: number | null;
  last_run_utc: string | null; last_error: string | null;
};
export type CollectState = { updated_utc: string; agencies: Record<string, AgencyState> };

const RAW_DIR = join('data', 'raw', 'brinc');
const STATE_PATH = join(RAW_DIR, '_state.json');
const API = 'https://api.liveops.brincdrones.com/dfr/missions';
const UA = 'drone-flight-logs (+https://github.com/AH-Datalytics/drone-flight-logs)';
const PAGE = 100;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export function knownFlightIds(path: string): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(path)) return ids;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const o = JSON.parse(line) as BrincFlight;
      if (typeof o.flight_id === 'string') ids.add(o.flight_id);
    } catch { /* truncated final line */ }
  }
  return ids;
}

async function getJson(url: string, tries = 4): Promise<any> {
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
  const release = acquireLock(RAW_DIR, 'brinc');

  const sites: BrincSite[] = JSON.parse(readFileSync(join('data', 'brinc_sites.json'), 'utf8')).sites;
  const targets = opts.only?.length ? sites.filter(s => opts.only!.includes(s.agency_id) || opts.only!.includes(s.slug)) : sites;
  if (targets.length === 0) throw new Error('No matching BRINC sites. Check data/brinc_sites.json.');

  const state: CollectState = existsSync(STATE_PATH)
    ? JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    : { updated_utc: new Date().toISOString(), agencies: {} };

  let ok = 0, failed = 0, totalAdded = 0;
  log(`BRINC collection: ${targets.length} agencies`);

  for (const [i, site] of targets.entries()) {
    const outPath = join(RAW_DIR, `${site.agency_id}.jsonl`);
    const known = knownFlightIds(outPath);
    try {
      const agg = await getJson(`${API}/aggregate?slug=${encodeURIComponent(site.slug)}`);
      const advertised = typeof agg?.data?.totalFlights === 'number' ? agg.data.totalFlights : null;

      let added = 0, seen = 0;
      for (let offset = 0; ; offset += PAGE) {
        const body = await getJson(`${API}/list?slug=${encodeURIComponent(site.slug)}&limit=${PAGE}&offset=${offset}`);
        const rows: Record<string, unknown>[] = Array.isArray(body?.data) ? body.data : [];
        if (rows.length === 0) break;
        seen += rows.length;
        for (const raw of rows) {
          const f = slim(raw);
          if (!f.flight_id || known.has(f.flight_id)) continue;
          known.add(f.flight_id);
          appendFileSync(outPath, JSON.stringify(f) + '\n');
          added++;
        }
        if (rows.length < PAGE) break;
        await sleep(400);
      }

      state.agencies[site.agency_id] = {
        agency_id: site.agency_id, slug: site.slug, total_flights: known.size, advertised,
        last_run_utc: new Date().toISOString(), last_error: null,
      };
      totalAdded += added;
      const short = advertised !== null && seen < advertised ? `  — short of the ${advertised} the dashboard advertises` : '';
      log(`[${i + 1}/${targets.length}] ${site.display_name}: ${seen} read, +${added} new, ${known.size} stored${short}`);
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[${i + 1}/${targets.length}] ${site.display_name}: FAILED — ${msg}`);
      const prev = state.agencies[site.agency_id];
      state.agencies[site.agency_id] = {
        agency_id: site.agency_id, slug: site.slug,
        total_flights: prev?.total_flights ?? 0, advertised: prev?.advertised ?? null,
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

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pipeline/brinc/collect.ts');
if (isMain) {
  const only: string[] = [];
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--agency') only.push(process.argv[++i]);
  collect({ only }).catch(e => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
}
