import { describe, it, expect } from 'vitest';
import { filterAgencies, sortAgencies, type Row } from '../table';
const rows: Row[] = [
  { agency_id: 'milwaukee-pd', display_name: 'Milwaukee Police Department', state: 'WI', org_type: 'law_enforcement', flight_count: 4562, total_hours: 980, first_flight: '2025-03-08', last_flight: '2026-08-23', status: 'ok', days_since_last: 9, median_gap_days: 1 },
  { agency_id: 'aep', display_name: 'AEP Gen Shared Services Engineering', state: null, org_type: 'corporate_utility', flight_count: 1, total_hours: 0.2, first_flight: '2025-01-01', last_flight: '2025-01-01', status: 'stale', days_since_last: 600, median_gap_days: null },
  { agency_id: 'tulsa-fire', display_name: 'Tulsa Fire Department', state: 'OK', org_type: 'fire_ems', flight_count: 66, total_hours: 12, first_flight: null, last_flight: null, status: 'ok', days_since_last: null, median_gap_days: 14 },
];
describe('filterAgencies', () => {
  it('matches name and state case-insensitively and hides non public-safety by default', () => {
    expect(filterAgencies(rows, 'milw', true).map(r => r.agency_id)).toEqual(['milwaukee-pd']);
    expect(filterAgencies(rows, 'ok', true).map(r => r.agency_id)).toEqual(['tulsa-fire']);
    expect(filterAgencies(rows, '', true).length).toBe(2);
    expect(filterAgencies(rows, '', false).length).toBe(3);
  });
});
describe('sortAgencies', () => {
  it('sorts numbers with nulls last and strings alphabetically', () => {
    expect(sortAgencies(rows, 'flight_count', 'desc').map(r => r.agency_id)).toEqual(['milwaukee-pd', 'tulsa-fire', 'aep']);
    expect(sortAgencies(rows, 'last_flight', 'desc').map(r => r.agency_id)).toEqual(['milwaukee-pd', 'aep', 'tulsa-fire']);
    expect(sortAgencies(rows, 'display_name', 'asc').map(r => r.agency_id)).toEqual(['aep', 'milwaukee-pd', 'tulsa-fire']);
  });
});
