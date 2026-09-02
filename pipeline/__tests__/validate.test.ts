import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateDataDir } from '../validate.js';
import { saveRegistry, type RegistryAgency } from '../registry.js';
import { encodeFlightFile } from '../flightfile.js';

const ag = (id: string): RegistryAgency => ({ agency_id: id, display_name: id, state: null, org_type: 'law_enforcement', timezone: 'UTC', source: 'skydio_arcgis', source_config: { orgs: [], vanity_slug: null }, official_url: 'https://x', status: 'ok', first_flight: null, last_flight: null, flight_count: 0, total_hours: 0, last_pulled_utc: null, notes: null });
const rec = (id: string) => ({ agency_id: 'a-pd', source_flight_id: id, takeoff_utc: null, flight_date_local: null, landing_utc: null, duration_min: null, purpose: null, description: null, case_number: null, extra: {}, data_quality: 'missing_takeoff' });

function dir(agencies: RegistryAgency[], files: Record<string, unknown>) {
  const d = mkdtempSync(join(tmpdir(), 'val-')); mkdirSync(join(d, 'flights'));
  saveRegistry(join(d, 'registry.json'), { agencies });
  for (const [n, c] of Object.entries(files)) writeFileSync(join(d, 'flights', n), JSON.stringify(c));
  return d;
}

describe('validateDataDir', () => {
  it('passes a consistent data dir', () => {
    expect(validateDataDir(dir([ag('a-pd')], { 'a-pd.json': encodeFlightFile('a-pd', [rec('1')]) }))).toEqual([]);
  });
  it('reports missing file, orphan file, duplicate ids, bad rows, bad enum', () => {
    const bad = encodeFlightFile('a-pd', [rec('1'), rec('1')]);
    (bad.rows[0] as any[])[1] = 'not-a-date';
    const a = ag('a-pd'); const b = ag('b-pd'); (b as any).status = 'bogus';
    const p = validateDataDir(dir([a, b], { 'a-pd.json': bad, 'orphan.json': encodeFlightFile('orphan', []) }));
    expect(p.some(x => /b-pd.*status/.test(x))).toBe(true);
    expect(p.some(x => /b-pd.*missing flight file/.test(x))).toBe(true);
    expect(p.some(x => /orphan\.json.*not in registry/.test(x))).toBe(true);
    expect(p.some(x => /a-pd.*duplicate source_flight_id/.test(x))).toBe(true);
    expect(p.some(x => /a-pd.*takeoff_utc/.test(x))).toBe(true);
  });
});
