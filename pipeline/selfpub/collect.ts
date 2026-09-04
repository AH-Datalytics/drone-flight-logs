import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { acquireLock } from '../lock.js';
import { keepRow, redactPeople, type SelfPubSite } from './parse.js';
import { keepOnlyLabels } from './labels.js';

/**
 * Collector for agencies that publish their own flight log.
 *
 * ArcGIS feature services page with resultOffset and state whether more rows
 * remain, so this pages until the service says it is done and then checks the
 * total against a count query — a truncated read is the failure that matters
 * here, and it is detectable.
 *
 * Unlike the vendor sources this replaces rather than appends: these services
 * hold their whole history and a row can be corrected in place, so re-reading
 * in full is both cheap and more accurate than accumulating.
 *
 * Only the fields named in data/selfpub_sites.json are requested. Several of
 * these services expose pilot names, email addresses and takeoff coordinates,
 * and asking for nothing else is a stronger guarantee than dropping them after
 * the fact.
 */

const RAW_DIR = join('data', 'raw', 'selfpub');
const PAGE = 1000;
const UA = 'drone-flight-logs (+https://github.com/AH-Datalytics/drone-flight-logs)';

export type CollectState = {
  updated_utc: string;
  agencies: Record<string, { agency_id: string; rows: number; expected: number | null; last_run_utc: string; last_error: string | null }>;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Every field the mapping asks for, and nothing else. */
export function requestedFields(site: SelfPubSite): string[] {
  const f = site.fields;
  const names = [
    site.id_field, f.date, f.time, f.case_number, f.purpose, f.location,
    f.duration_minutes, f.duration_hours, f.duration_text,
    f.purpose_labelled?.field,
    ...Object.values(f.extra ?? {}),
    site.row_filter?.field,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0);
  return [...new Set(names)];
}

async function getJson(url: string, tries = 4): Promise<any> {
  let lastErr: Error = new Error('unreachable');
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
      const j = JSON.parse(text);
      if (j.error) throw new Error(`service error: ${JSON.stringify(j.error).slice(0, 160)}`);
      return j;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await sleep(800 * 2 ** attempt);
    }
  }
  throw lastErr;
}

export async function collectSite(site: SelfPubSite, log: (m: string) => void): Promise<{ rows: Record<string, unknown>[]; expected: number | null }> {
  const fields = requestedFields(site).join(',');
  const count = await getJson(`${site.service_url}/query?where=1%3D1&returnCountOnly=true&f=json`);
  const expected = typeof count.count === 'number' ? count.count : null;

  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const url = `${site.service_url}/query?where=1%3D1&outFields=${encodeURIComponent(fields)}`
      + `&returnGeometry=false&resultOffset=${offset}&resultRecordCount=${PAGE}&f=json`;
    const page = await getJson(url);
    const feats: { attributes: Record<string, unknown> }[] = page.features ?? [];
    for (const f of feats) {
      if (!keepRow(f.attributes, site.row_filter)) continue;
      // Redact before the row is ever written. Several of these services name
      // a pilot inside free text, which no field-level rule catches, and the
      // raw store is committed to a public repository.
      const clean: Record<string, unknown> = {};
      const labelOnly = site.fields.purpose_labelled;
      for (const [k, v] of Object.entries(f.attributes)) {
        if (typeof v !== 'string') { clean[k] = v; continue; }
        // A field read only for one labelled value keeps that line alone: its
        // other lines name people in prose, which no pattern catches.
        clean[k] = labelOnly && k === labelOnly.field
          ? keepOnlyLabels(v, [labelOnly.label])
          : redactPeople(v);
      }
      rows.push(clean);
    }
    if (feats.length === 0 || page.exceededTransferLimit !== true) break;
    await sleep(300);
  }

  const filtered = site.row_filter ? ` (${rows.length} after filtering to ${site.row_filter.values.join('/')})` : '';
  log(`    ${expected ?? '?'} rows in the service${filtered}`);
  return { rows, expected };
}

export async function collect(opts: { only?: string[]; log?: (m: string) => void } = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(m));
  mkdirSync(RAW_DIR, { recursive: true });
  const release = acquireLock(RAW_DIR, 'selfpub');

  const sites: SelfPubSite[] = JSON.parse(readFileSync(join('data', 'selfpub_sites.json'), 'utf8')).sites;
  const targets = opts.only?.length ? sites.filter(s => opts.only!.includes(s.agency_id)) : sites;
  if (targets.length === 0) throw new Error('No matching self-published sites. Check data/selfpub_sites.json.');

  const statePath = join(RAW_DIR, '_state.json');
  const state: CollectState = existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, 'utf8'))
    : { updated_utc: new Date().toISOString(), agencies: {} };

  let ok = 0, failed = 0;
  log(`Self-published collection: ${targets.length} agencies`);

  for (const [i, site] of targets.entries()) {
    log(`[${i + 1}/${targets.length}] ${site.display_name}`);
    try {
      const { rows, expected } = await collectSite(site, log);
      // Replace rather than append: the service holds the whole history and
      // can correct a row in place.
      writeFileSync(join(RAW_DIR, `${site.agency_id}.json`), JSON.stringify(rows));
      state.agencies[site.agency_id] = {
        agency_id: site.agency_id, rows: rows.length, expected,
        last_run_utc: new Date().toISOString(), last_error: null,
      };
      ok++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`    FAILED: ${msg}`);
      const prev = state.agencies[site.agency_id];
      state.agencies[site.agency_id] = {
        agency_id: site.agency_id, rows: prev?.rows ?? 0, expected: prev?.expected ?? null,
        last_run_utc: new Date().toISOString(), last_error: msg,
      };
      failed++;
    }
    state.updated_utc = new Date().toISOString();
    writeFileSync(statePath, JSON.stringify(state, null, 1) + '\n');
    await sleep(500);
  }

  release();
  log(`Done. ${ok} agencies collected, ${failed} failed.`);
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pipeline/selfpub/collect.ts');
if (isMain) {
  const only: string[] = [];
  for (let i = 2; i < process.argv.length; i++) if (process.argv[i] === '--agency') only.push(process.argv[++i]);
  collect({ only }).catch(e => { console.error(e instanceof Error ? e.stack : String(e)); process.exit(1); });
}
