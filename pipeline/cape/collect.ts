import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { CapeFlight } from './parse.js';
import { acquireLock } from '../lock.js';

/**
 * Collector for Motorola CAPE transparency portals.
 *
 * Each portal is addressed by a slug. The slug resolves to a project UUID and
 * the agency's chosen public window through a settings endpoint, and the flight
 * list is one request — the API ignores page-size parameters and returns the
 * whole window at once.
 *
 * Because most windows roll, this collector only ever adds. A flight that has
 * aged out of the feed stays in the store, and the run reports how many of the
 * stored flights the source could still show, so a shrinking window is visible
 * rather than silent.
 */

export type CapeSite = { agency_id: string; slug: string; display_name: string; state: string | null; timezone: string };

export type AgencyState = {
  agency_id: string;
  slug: string;
  project_id: string | null;
  window_days: number | null;
  publish_delay_hours: number | null;
  in_window: number;
  total_flights: number;
  first_seen_utc: string | null;
  last_run_utc: string | null;
  last_error: string | null;
};
export type CollectState = { updated_utc: string; agencies: Record<string, AgencyState> };

const RAW_DIR = join('data', 'raw', 'cape');
const STATE_PATH = join(RAW_DIR, '_state.json');
const BASE = 'https://www.aerial.motorolasolutions.com/transparency/api';
// Identifies the operator without publishing a harvestable address.
const UA = 'drone-flight-logs (+https://github.com/AH-Datalytics/drone-flight-logs)';

export type ProjectSettings = {
  name: string;
  public_transparency: boolean;
  public_transparency_range: number | null;
  public_transparency_delay: number | null;
  project_id: string;
};

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
      const o = JSON.parse(line) as CapeFlight;
      if (typeof o.id === 'string') ids.add(o.id);
    } catch {
      // Truncated final line from an interrupted write.
    }
  }
  return ids;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function getJson(url: string, tries = 4): Promise<unknown> {
  let lastErr: Error = new Error('unreachable');
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      return JSON.parse(text);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function collect(opts: { only?: string[]; log?: (m: string) => void } = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  mkdirSync(RAW_DIR, { recursive: true });
  const release = acquireLock(RAW_DIR, 'cape');

  const sites: CapeSite[] = JSON.parse(readFileSync(join('data', 'cape_sites.json'), 'utf8')).sites;
  const targets = opts.only?.length ? sites.filter(s => opts.only!.includes(s.agency_id) || opts.only!.includes(s.slug)) : sites;
  if (targets.length === 0) throw new Error('No matching CAPE sites. Check values against data/cape_sites.json.');

  const state = loadState();
  let ok = 0, failed = 0, totalAdded = 0;
  log(`Motorola CAPE collection: ${targets.length} portals`);

  for (const [i, site] of targets.entries()) {
    const outPath = join(RAW_DIR, `${site.agency_id}.jsonl`);
    const known = knownFlightIds(outPath);
    const agency: AgencyState = state.agencies[site.agency_id] ?? {
      agency_id: site.agency_id, slug: site.slug, project_id: null, window_days: null, publish_delay_hours: null,
      in_window: 0, total_flights: 0, first_seen_utc: null, last_run_utc: null, last_error: null,
    };
    state.agencies[site.agency_id] = agency;

    try {
      const settings = await getJson(`${BASE}/project-settings/?project=${site.slug}`) as ProjectSettings;
      if (!settings.project_id) throw new Error('portal returned no project id');
      agency.project_id = settings.project_id;
      agency.window_days = settings.public_transparency_range;
      agency.publish_delay_hours = settings.public_transparency_delay;

      const flights = await getJson(`${BASE}/flights-list/?project=${settings.project_id}`) as CapeFlight[];
      const list = Array.isArray(flights) ? flights : [];
      agency.in_window = list.length;

      let added = 0;
      for (const f of list) {
        if (typeof f.id !== 'string' || known.has(f.id)) continue;
        known.add(f.id);
        appendFileSync(outPath, JSON.stringify(f) + '\n');
        added++;
      }

      agency.total_flights = known.size;
      agency.first_seen_utc ??= new Date().toISOString();
      agency.last_run_utc = new Date().toISOString();
      agency.last_error = null;
      totalAdded += added;

      const windowLabel = settings.public_transparency_range === null ? 'no window limit' : `${settings.public_transparency_range}-day window`;
      log(`[${i + 1}/${targets.length}] ${settings.name}: ${list.length} in feed (${windowLabel}), +${added} new, ${known.size} stored`);
      if (list.length === 0) log('    the feed is empty — either nothing flew inside the window, or the agency paused publishing');
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[${i + 1}/${targets.length}] ${site.display_name}: FAILED — ${msg}`);
      agency.last_run_utc = new Date().toISOString();
      agency.last_error = msg;
      failed++;
    }
    saveState(state);
    await sleep(1000);
  }

  release();
  log(`Done. ${ok} portals collected, ${failed} failed, ${totalAdded} new flights this run.`);
  const rolling = Object.values(state.agencies).filter(a => a.window_days !== null && a.total_flights > a.in_window);
  if (rolling.length) {
    log('Flights held here that the source no longer shows:');
    for (const a of rolling) log(`    ${a.agency_id}: ${a.total_flights - a.in_window} of ${a.total_flights}`);
  }
}

function parseArgs(argv: string[]): { only?: string[] } {
  const o: { only?: string[] } = {};
  for (let i = 0; i < argv.length; i++) if (argv[i] === '--agency') (o.only ??= []).push(argv[++i]);
  return o;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pipeline/cape/collect.ts');
if (isMain) {
  collect(parseArgs(process.argv.slice(2))).catch(e => {
    console.error(e instanceof Error ? e.stack : String(e));
    process.exit(1);
  });
}
