import { mkdirSync, readFileSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFlightFile, COLUMNS, type FlightFile } from '../pipeline/flightfile.js';
import type { Registry } from '../pipeline/registry.js';

const root = process.cwd();
const DATA = join(root, 'data'), OUT = join(root, 'public', 'data');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'flights'), { recursive: true }); mkdirSync(join(OUT, 'csv'), { recursive: true });

const q = (v: unknown) => { const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const reg: Registry = JSON.parse(readFileSync(join(DATA, 'registry.json'), 'utf8'));
let n = 0;
for (const a of reg.agencies) {
  if (a.status === 'needs_review') continue;
  const src = join(DATA, 'flights', `${a.agency_id}.json`);
  if (!existsSync(src)) continue;
  copyFileSync(src, join(OUT, 'flights', `${a.agency_id}.json`));
  const recs = decodeFlightFile(JSON.parse(readFileSync(src, 'utf8')) as FlightFile);
  const extraKeys = [...new Set(recs.flatMap(r => Object.keys(r.extra ?? {})))].sort();
  const cols = ['agency', ...COLUMNS.filter(c => c !== 'extra'), ...extraKeys];
  const lines = [cols.join(','), ...recs.map(r => [a.display_name, ...COLUMNS.filter(c => c !== 'extra').map(c => (r as any)[c]), ...extraKeys.map(k => r.extra?.[k])].map(q).join(','))];
  writeFileSync(join(OUT, 'csv', `${a.agency_id}.csv`), lines.join('\r\n') + '\r\n');
  n++;
}
console.log(`prebuild: ${n} agencies → public/data`);
