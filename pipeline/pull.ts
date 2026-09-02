import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchJson } from './http.js';
import { fetchJson as realFetchJson } from './http.js';
import { loadRegistry, saveRegistry, loadExcluded, mergeDiscovered, type Registry, type RegistryAgency, type Status, type DiscoveredDashboard } from './registry.js';
import { encodeFlightFile, summarize, type FlightFile } from './flightfile.js';
import { validateRecord } from './schema.js';
import type { Adapter } from './adapters/types.js';
import { skydioAdapter, discoverSkydioDashboards } from './adapters/skydio_arcgis.js';
import { sfpdAdapter } from './adapters/sfpd_datasf.js';

export const STALE_DAYS = 60;

export type Manifest = {
  run_utc: string | null;
  agencies: Record<string, { status: Status; rows: number; previous_rows: number; error: string | null }>;
  added: string[]; retired: string[]; unresolved_dashboards: DiscoveredDashboard[];
};

export type RunOpts = {
  dataDir: string; now: Date; fetchJson: FetchJson;
  adapters: Record<string, Adapter>;
  discover: (fetchJson: FetchJson) => Promise<DiscoveredDashboard[]>;
  doDiscover?: boolean; only?: string[]; concurrency?: number;
  log?: (line: string) => void;
};

function previousRows(path: string): number {
  if (!existsSync(path)) return 0;
  try { return (JSON.parse(readFileSync(path, 'utf8')) as FlightFile).rows.length; } catch { return 0; }
}

function daysBetween(a: string, b: Date): number {
  return Math.floor((b.getTime() - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

async function pullOne(a: RegistryAgency, opts: RunOpts, flightsDir: string): Promise<Manifest['agencies'][string]> {
  const path = join(flightsDir, `${a.agency_id}.json`);
  const prev = previousRows(path);
  const adapter = opts.adapters[a.source];
  try {
    if (!adapter) throw new Error(`no adapter for source ${a.source}`);
    const records = await adapter.pull(a, opts.fetchJson);
    const bad = records.map(validateRecord).filter(p => p.length);
    if (bad.length) throw new Error(`${bad.length} invalid records, e.g. ${bad[0].join('; ')}`);
    if (records.length === 0 && prev > 0) throw new Error(`zero rows returned but previous file had ${prev}`);
    writeFileSync(path, JSON.stringify(encodeFlightFile(a.agency_id, records)) + '\n');
    const s = summarize(records);
    a.first_flight = s.first_flight; a.last_flight = s.last_flight; a.flight_count = s.flight_count; a.total_hours = s.total_hours;
    a.last_pulled_utc = opts.now.toISOString();
    a.status = a.last_flight && daysBetween(a.last_flight, opts.now) > STALE_DAYS ? 'stale' : 'ok';
    return { status: a.status, rows: records.length, previous_rows: prev, error: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    a.status = 'unreachable';
    return { status: 'unreachable', rows: prev, previous_rows: prev, error: msg };
  }
}

export async function runPull(opts: RunOpts): Promise<Manifest> {
  const log = opts.log ?? ((l: string) => console.log(l));
  const flightsDir = join(opts.dataDir, 'flights');
  mkdirSync(flightsDir, { recursive: true });
  const regPath = join(opts.dataDir, 'registry.json');
  const reg: Registry = loadRegistry(regPath);
  const manifest: Manifest = { run_utc: opts.now.toISOString(), agencies: {}, added: [], retired: [], unresolved_dashboards: [] };

  if (opts.doDiscover !== false) {
    log('discovering Skydio dashboards…');
    const discovered = await opts.discover(opts.fetchJson);
    const res = mergeDiscovered(reg, discovered, loadExcluded(join(opts.dataDir, 'excluded_orgs.json')));
    manifest.added = res.added; manifest.retired = res.retired; manifest.unresolved_dashboards = res.unresolved;
    log(`discovered ${discovered.length}; added ${res.added.length}; retired ${res.retired.length}; unresolved ${res.unresolved.length}`);
  }

  const only = opts.only ? new Set(opts.only) : null;
  const targets = reg.agencies.filter(a => a.status !== 'retired' && a.status !== 'needs_review' && (!only || only.has(a.agency_id)));
  const N = opts.concurrency ?? 6;
  let i = 0;
  await Promise.all(Array.from({ length: N }, async () => {
    while (i < targets.length) {
      const a = targets[i++];
      const r = await pullOne(a, opts, flightsDir);
      manifest.agencies[a.agency_id] = r;
      log(`${r.status.padEnd(11)} ${String(r.rows).padStart(6)}  ${a.agency_id}${r.error ? '  — ' + r.error : ''}`);
    }
  }));

  saveRegistry(regPath, reg);
  writeFileSync(join(opts.dataDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

// ---- CLI ----
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const onlyArg = args.find(a => a.startsWith('--only='))?.slice(7) ?? (args.includes('--only') ? args[args.indexOf('--only') + 1] : undefined);
  const dataDir = join(process.cwd(), 'data');
  runPull({
    dataDir, now: new Date(), fetchJson: realFetchJson,
    adapters: { skydio_arcgis: skydioAdapter, sfpd_datasf: sfpdAdapter },
    discover: discoverSkydioDashboards,
    doDiscover: !args.includes('--no-discover'),
    only: onlyArg ? onlyArg.split(',') : undefined,
  }).then(m => {
    const failed = Object.values(m.agencies).filter(a => a.status === 'unreachable').length;
    console.log(`done: ${Object.keys(m.agencies).length} agencies, ${failed} unreachable`);
  }).catch(e => { console.error(e); process.exit(1); });
}
