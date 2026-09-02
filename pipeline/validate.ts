import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './registry.js';
import { COLUMNS, decodeFlightFile, type FlightFile } from './flightfile.js';
import { validateRecord } from './schema.js';

const ORG_TYPES = new Set(['law_enforcement', 'fire_ems', 'university', 'government_other', 'corporate_utility', 'vendor_partner']);
const STATUSES = new Set(['ok', 'stale', 'unreachable', 'retired', 'needs_review']);
const SOURCES = new Set(['skydio_arcgis', 'sfpd_datasf']);

export function validateDataDir(dataDir: string): string[] {
  const p: string[] = [];
  const reg = loadRegistry(join(dataDir, 'registry.json'));
  const ids = new Set<string>();
  const expectFiles = new Set<string>();
  for (const a of reg.agencies) {
    const tag = `registry ${a.agency_id || '(no id)'}`;
    if (!a.agency_id || !/^[a-z0-9-]+$/.test(a.agency_id)) p.push(`${tag}: agency_id must be a lowercase slug`);
    if (ids.has(a.agency_id)) p.push(`${tag}: duplicate agency_id`); ids.add(a.agency_id);
    if (!a.display_name) p.push(`${tag}: display_name required`);
    if (!ORG_TYPES.has(a.org_type)) p.push(`${tag}: bad org_type ${a.org_type}`);
    if (!STATUSES.has(a.status)) p.push(`${tag}: bad status ${a.status}`);
    if (!SOURCES.has(a.source)) p.push(`${tag}: bad source ${a.source}`);
    if (!a.timezone) p.push(`${tag}: timezone required`);
    if (!a.official_url) p.push(`${tag}: official_url required`);
    if (a.status !== 'needs_review' && a.status !== 'retired') {
      expectFiles.add(`${a.agency_id}.json`);
      if (!existsSync(join(dataDir, 'flights', `${a.agency_id}.json`))) p.push(`${tag}: missing flight file`);
    }
  }
  const flightsDir = join(dataDir, 'flights');
  const files = existsSync(flightsDir) ? readdirSync(flightsDir).filter(f => f.endsWith('.json')) : [];
  for (const f of files) {
    const tag = `flights/${f}`;
    const id = f.replace(/\.json$/, '');
    if (!ids.has(id)) { p.push(`${tag}: not in registry`); continue; }
    let file: FlightFile;
    try { file = JSON.parse(readFileSync(join(flightsDir, f), 'utf8')); } catch (e) { p.push(`${tag}: unparsable JSON`); continue; }
    if (file.agency_id !== id) p.push(`${tag}: agency_id ${file.agency_id} does not match filename`);
    if (JSON.stringify(file.columns) !== JSON.stringify(COLUMNS)) p.push(`${tag}: columns differ from COLUMNS`);
    const seen = new Set<string>();
    decodeFlightFile(file).forEach((r, i) => {
      const probs = validateRecord(r);
      if (probs.length) p.push(`${tag} row ${i} (${id}): ${probs.join('; ')}`);
      if (seen.has(r.source_flight_id)) p.push(`${tag} (${id}): duplicate source_flight_id ${r.source_flight_id}`);
      seen.add(r.source_flight_id);
    });
  }
  return p;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = validateDataDir(join(process.cwd(), 'data'));
  if (problems.length) { console.error(problems.slice(0, 50).join('\n')); console.error(`\n${problems.length} problem(s)`); process.exit(1); }
  console.log('data/ valid');
}
