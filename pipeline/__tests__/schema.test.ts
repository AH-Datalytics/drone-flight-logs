import { describe, it, expect } from 'vitest';
import { validateRecord, type FlightRecord } from '../schema.js';

const good: FlightRecord = {
  agency_id: 'milwaukee-pd',
  source_flight_id: '83700711-b12a-451b-a114-d4281b4c26da',
  takeoff_utc: '2025-03-09T05:58:09.198Z',
  flight_date_local: '2025-03-08',
  landing_utc: '2025-03-09T06:17:27.260Z',
  duration_min: 19.3,
  purpose: 'Event Management',
  description: 'Shamrock Shuffle',
  case_number: 'P2503080355',
  extra: {},
  data_quality: null,
};

describe('validateRecord', () => {
  it('accepts a complete record', () => {
    expect(validateRecord(good)).toEqual([]);
  });
  it('accepts nulls where allowed', () => {
    const r = { ...good, takeoff_utc: null, flight_date_local: null, landing_utc: null, duration_min: null, purpose: null, description: null, case_number: null, data_quality: 'missing_takeoff;missing_landing' };
    expect(validateRecord(r)).toEqual([]);
  });
  it('rejects missing agency_id and source_flight_id', () => {
    const r = { ...good, agency_id: '', source_flight_id: undefined };
    const problems = validateRecord(r);
    expect(problems).toContain('agency_id must be a non-empty string');
    expect(problems).toContain('source_flight_id must be a non-empty string');
  });
  it('rejects malformed dates', () => {
    expect(validateRecord({ ...good, takeoff_utc: '2025-03-09 05:58' })).toContain('takeoff_utc must be ISO 8601 UTC or null');
    expect(validateRecord({ ...good, flight_date_local: '3/8/2025' })).toContain('flight_date_local must be YYYY-MM-DD or null');
  });
  it('rejects forbidden identity fields', () => {
    const r = { ...good, user_email: 'x@y.gov' } as unknown;
    expect(validateRecord(r)).toContain('forbidden field present: user_email');
  });
  it('rejects negative duration and non-object extra', () => {
    expect(validateRecord({ ...good, duration_min: -1 })).toContain('duration_min must be a non-negative number or null');
    expect(validateRecord({ ...good, extra: 'nope' })).toContain('extra must be an object');
  });
});
