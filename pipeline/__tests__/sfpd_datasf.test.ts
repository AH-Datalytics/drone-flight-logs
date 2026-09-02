import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapSfpdRow, sfpdAdapter } from '../adapters/sfpd_datasf.js';
import type { RegistryAgency } from '../registry.js';

const here = dirname(fileURLToPath(import.meta.url));
const rows = JSON.parse(readFileSync(join(here, 'fixtures', 'sfpd_page.json'), 'utf8'));

describe('mapSfpdRow', () => {
  it('maps a complete row with date-only time and extras', () => {
    expect(mapSfpdRow(rows[0], 'sfpd')).toEqual({
      agency_id: 'sfpd', source_flight_id: 'row-abcd-1234-efgh', takeoff_utc: null, flight_date_local: '2025-11-13', landing_utc: null,
      duration_min: 20, purpose: 'Criminal Investigation', description: 'PROWLER', case_number: '253173043',
      extra: { analysis_neighborhood: 'Financial District/South Beach', supervisor_district: '6', geocoded_location: 'FREMONT ST & HARRISON ST' },
      data_quality: 'no_takeoff_time',
    });
  });
  it('handles missing fields', () => {
    const r = mapSfpdRow(rows[1], 'sfpd');
    expect(r.duration_min).toBeNull(); expect(r.case_number).toBeNull(); expect(r.description).toBeNull();
    expect(r.extra).toEqual({ analysis_neighborhood: null, supervisor_district: null, geocoded_location: null });
    expect(r.data_quality).toBe('no_takeoff_time;missing_duration');
  });
});

describe('sfpdAdapter.pull', () => {
  const agency: RegistryAgency = {
    agency_id: 'sfpd', display_name: 'San Francisco Police Department', state: 'CA', org_type: 'law_enforcement', timezone: 'America/Los_Angeles',
    source: 'sfpd_datasf', source_config: { domain: 'data.sfgov.org', dataset_id: 'giw5-ttjs' }, official_url: 'https://www.sanfranciscopolice.org/your-sfpd/explore-department/drones',
    status: 'ok', first_flight: null, last_flight: null, flight_count: 0, total_hours: 0, last_pulled_utc: null, notes: null,
  };
  it('pages with $limit/$offset and selects :id', async () => {
    const urls: string[] = [];
    const big = Array.from({ length: 5000 }, (_, i) => ({ ...rows[0], ':id': 'r' + i }));
    const fj = async (u: string) => { urls.push(u); return u.includes('%24offset=0') ? big : rows; };
    const recs = await sfpdAdapter.pull(agency, fj);
    expect(recs.length).toBe(5002);
    expect(urls[0]).toContain('https://data.sfgov.org/resource/giw5-ttjs.json');
    expect(urls[0]).toMatch(/%24select=%3Aid/);
    expect(urls[1]).toContain('%24offset=5000');
  });
  it('rejects rather than silently returning zero rows when the response is not an array', async () => {
    await expect(sfpdAdapter.pull(agency, async () => ({}))).rejects.toThrow(/non-array/);
    await expect(sfpdAdapter.pull(agency, async () => null)).rejects.toThrow(/non-array/);
  });
  it('resolves to an empty array when the first page is genuinely empty', async () => {
    await expect(sfpdAdapter.pull(agency, async () => [])).resolves.toEqual([]);
  });
});
