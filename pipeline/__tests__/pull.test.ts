import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPull } from '../pull.js';
import { saveRegistry, type RegistryAgency } from '../registry.js';
import { encodeFlightFile } from '../flightfile.js';
import type { FlightRecord } from '../schema.js';
import type { Adapter } from '../adapters/types.js';

const rec = (id: string, agency: string, date: string): FlightRecord => ({
  agency_id: agency, source_flight_id: id, takeoff_utc: `${date}T12:00:00.000Z`, flight_date_local: date, landing_utc: `${date}T12:20:00.000Z`,
  duration_min: 20, purpose: 'Training', description: null, case_number: null, extra: {}, data_quality: null,
});
const agency = (id: string, status: RegistryAgency['status'] = 'ok'): RegistryAgency => ({
  agency_id: id, display_name: id, state: null, org_type: 'law_enforcement', timezone: 'UTC', source: 'skydio_arcgis',
  source_config: { orgs: [{ org_uuid: 'u-' + id, dashboard_item_id: 'd-' + id, title: id }], vanity_slug: null }, official_url: '',
  status, first_flight: null, last_flight: null, flight_count: 0, total_hours: 0, last_pulled_utc: null, notes: null,
});
function setup(agencies: RegistryAgency[]) {
  const dir = mkdtempSync(join(tmpdir(), 'pull-'));
  mkdirSync(join(dir, 'flights'));
  saveRegistry(join(dir, 'registry.json'), { agencies });
  writeFileSync(join(dir, 'excluded_orgs.json'), '[]\n');
  return dir;
}
const fakeAdapter = (impl: (a: RegistryAgency) => Promise<FlightRecord[]>): Adapter => ({ source: 'skydio_arcgis', pull: a => impl(a) });
const noDiscover = async () => [];
const NOW = new Date('2026-09-01T00:00:00Z');

describe('runPull', () => {
  it('writes flight files, updates summaries, marks stale, writes manifest', async () => {
    const dir = setup([agency('fresh-pd'), agency('stale-pd')]);
    const ad = fakeAdapter(async a => a.agency_id === 'fresh-pd' ? [rec('1', a.agency_id, '2026-08-30'), rec('2', a.agency_id, '2026-08-31')] : [rec('1', a.agency_id, '2026-05-01')]);
    const m = await runPull({ dataDir: dir, now: NOW, fetchJson: async () => ({}), adapters: { skydio_arcgis: ad }, discover: noDiscover, doDiscover: false, log: () => {} });
    const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
    const fresh = reg.agencies.find((a: any) => a.agency_id === 'fresh-pd');
    const stale = reg.agencies.find((a: any) => a.agency_id === 'stale-pd');
    expect(fresh.status).toBe('ok'); expect(fresh.flight_count).toBe(2); expect(fresh.last_flight).toBe('2026-08-31'); expect(fresh.total_hours).toBe(0.7);
    expect(fresh.last_pulled_utc).toBe('2026-09-01T00:00:00.000Z');
    expect(stale.status).toBe('stale');
    const file = JSON.parse(readFileSync(join(dir, 'flights', 'fresh-pd.json'), 'utf8'));
    expect(file.rows.length).toBe(2);
    expect(m.agencies['fresh-pd']).toEqual({ status: 'ok', rows: 2, previous_rows: 0, error: null });
    expect(existsSync(join(dir, 'manifest.json'))).toBe(true);
  });

  it('keeps the previous file byte-identical and marks unreachable when the adapter throws', async () => {
    const dir = setup([agency('flaky-pd')]);
    const prev = JSON.stringify(encodeFlightFile('flaky-pd', [rec('old', 'flaky-pd', '2026-08-01')]));
    writeFileSync(join(dir, 'flights', 'flaky-pd.json'), prev);
    const m = await runPull({ dataDir: dir, now: NOW, fetchJson: async () => ({}), adapters: { skydio_arcgis: fakeAdapter(async () => { throw new Error('HTTP 503'); }) }, discover: noDiscover, doDiscover: false, log: () => {} });
    expect(readFileSync(join(dir, 'flights', 'flaky-pd.json'), 'utf8')).toBe(prev);
    const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
    expect(reg.agencies[0].status).toBe('unreachable');
    expect(m.agencies['flaky-pd'].error).toMatch(/HTTP 503/);
    expect(m.agencies['flaky-pd'].previous_rows).toBe(1);
  });

  it('rejects a zero-row pull when the previous file had rows', async () => {
    const dir = setup([agency('empty-pd')]);
    const prev = JSON.stringify(encodeFlightFile('empty-pd', [rec('old', 'empty-pd', '2026-08-01')]));
    writeFileSync(join(dir, 'flights', 'empty-pd.json'), prev);
    const m = await runPull({ dataDir: dir, now: NOW, fetchJson: async () => ({}), adapters: { skydio_arcgis: fakeAdapter(async () => []) }, discover: noDiscover, doDiscover: false, log: () => {} });
    expect(readFileSync(join(dir, 'flights', 'empty-pd.json'), 'utf8')).toBe(prev);
    expect(m.agencies['empty-pd'].status).toBe('unreachable');
    expect(m.agencies['empty-pd'].error).toMatch(/zero rows/);
  });

  it('accepts a zero-row pull for a brand new agency', async () => {
    const dir = setup([agency('new-pd')]);
    const m = await runPull({ dataDir: dir, now: NOW, fetchJson: async () => ({}), adapters: { skydio_arcgis: fakeAdapter(async () => []) }, discover: noDiscover, doDiscover: false, log: () => {} });
    expect(m.agencies['new-pd'].status).toBe('ok');
    expect(JSON.parse(readFileSync(join(dir, 'flights', 'new-pd.json'), 'utf8')).rows).toEqual([]);
  });

  it('skips retired and needs_review agencies and honors --only', async () => {
    const dir = setup([agency('a-pd'), agency('b-pd'), agency('r-pd', 'retired'), agency('n-pd', 'needs_review')]);
    const pulled: string[] = [];
    const m = await runPull({ dataDir: dir, now: NOW, fetchJson: async () => ({}), adapters: { skydio_arcgis: fakeAdapter(async a => { pulled.push(a.agency_id); return []; }) }, discover: noDiscover, doDiscover: false, only: ['a-pd'], log: () => {} });
    expect(pulled).toEqual(['a-pd']);
    expect(Object.keys(m.agencies)).toEqual(['a-pd']);
  });

  it('runs discovery and records added and unresolved', async () => {
    const dir = setup([agency('a-pd')]);
    const discover = async () => [
      { item_id: 'd-a-pd', title: 'a-pd', org_uuid: 'u-a-pd', modified: '2026-01-01T00:00:00.000Z' },
      { item_id: 'd-new', title: 'Newville Police Department (WA) Drone Flights', org_uuid: 'u-new', modified: '2026-01-01T00:00:00.000Z' },
      { item_id: 'd-x', title: 'Odd', org_uuid: null, modified: '2026-01-01T00:00:00.000Z' },
    ];
    const m = await runPull({ dataDir: dir, now: NOW, fetchJson: async () => ({}), adapters: { skydio_arcgis: fakeAdapter(async () => []) }, discover, log: () => {} });
    expect(m.added).toEqual(['newville-pd-wa']);
    expect(m.unresolved_dashboards.map(u => u.item_id)).toEqual(['d-x']);
    const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
    expect(reg.agencies.find((a: any) => a.agency_id === 'newville-pd-wa').status).toBe('needs_review');
  });

  it('rejects invalid records, leaves the previous file untouched, and reports the validation error', async () => {
    const dir = setup([agency('bad-pd')]);
    const prev = JSON.stringify(encodeFlightFile('bad-pd', [rec('old', 'bad-pd', '2026-08-01')]));
    writeFileSync(join(dir, 'flights', 'bad-pd.json'), prev);
    const badRecord = { ...rec('1', 'bad-pd', '2026-08-30'), source_flight_id: '' };
    const m = await runPull({ dataDir: dir, now: NOW, fetchJson: async () => ({}), adapters: { skydio_arcgis: fakeAdapter(async () => [badRecord]) }, discover: noDiscover, doDiscover: false, log: () => {} });
    expect(readFileSync(join(dir, 'flights', 'bad-pd.json'), 'utf8')).toBe(prev);
    const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
    expect(reg.agencies[0].status).toBe('unreachable');
    expect(m.agencies['bad-pd'].status).toBe('unreachable');
    expect(m.agencies['bad-pd'].error).toMatch(/source_flight_id/);
  });

  it('preserves a corrupt previous file rather than treating it as a brand-new agency', async () => {
    const dir = setup([agency('corrupt-pd')]);
    const corrupt = '{not valid json';
    writeFileSync(join(dir, 'flights', 'corrupt-pd.json'), corrupt);
    const m = await runPull({ dataDir: dir, now: NOW, fetchJson: async () => ({}), adapters: { skydio_arcgis: fakeAdapter(async () => []) }, discover: noDiscover, doDiscover: false, log: () => {} });
    expect(readFileSync(join(dir, 'flights', 'corrupt-pd.json'), 'utf8')).toBe(corrupt);
    const reg = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8'));
    expect(reg.agencies[0].status).toBe('unreachable');
    expect(m.agencies['corrupt-pd'].status).toBe('unreachable');
  });
});
