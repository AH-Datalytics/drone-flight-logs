import { describe, it, expect } from 'vitest';
import { COLUMNS, encodeFlightFile, decodeFlightFile, summarize } from '../flightfile.js';
import type { FlightRecord } from '../schema.js';

const mk = (over: Partial<FlightRecord>): FlightRecord => ({
  agency_id: 'test-pd', source_flight_id: 'a', takeoff_utc: '2026-01-02T10:00:00.000Z', flight_date_local: '2026-01-02',
  landing_utc: '2026-01-02T10:30:00.000Z', duration_min: 30, purpose: 'Training', description: null, case_number: null,
  extra: {}, data_quality: null, ...over,
});

describe('flight file', () => {
  it('round-trips records through encode/decode', () => {
    const recs = [mk({ source_flight_id: 'b', takeoff_utc: '2026-01-03T10:00:00.000Z', flight_date_local: '2026-01-03', extra: { neighborhood: 'Mission' } }), mk({ source_flight_id: 'a' })];
    const file = encodeFlightFile('test-pd', recs);
    expect(file.agency_id).toBe('test-pd');
    expect(file.columns).toEqual(COLUMNS);
    expect(file.rows.length).toBe(2);
    const back = decodeFlightFile(file);
    expect(back[0].source_flight_id).toBe('a'); // sorted by takeoff
    expect(back[1].extra).toEqual({ neighborhood: 'Mission' });
    expect(back[0]).toEqual(recs[1]);
  });
  it('sorts null takeoff last', () => {
    const recs = [mk({ source_flight_id: 'n', takeoff_utc: null, flight_date_local: null, data_quality: 'missing_takeoff' }), mk({ source_flight_id: 'a' })];
    const back = decodeFlightFile(encodeFlightFile('test-pd', recs));
    expect(back.map(r => r.source_flight_id)).toEqual(['a', 'n']);
  });
  it('contains no forbidden fields and no pull timestamp', () => {
    const json = JSON.stringify(encodeFlightFile('test-pd', [mk({})]));
    expect(json).not.toMatch(/user_email|vehicle_serial|dock_serial|operation_id|pulled/);
  });
  it('summarizes counts, range and hours', () => {
    const recs = [mk({ source_flight_id: 'a', flight_date_local: '2026-01-02', duration_min: 30 }), mk({ source_flight_id: 'b', flight_date_local: '2026-02-10', duration_min: 45 }), mk({ source_flight_id: 'c', flight_date_local: null, takeoff_utc: null, duration_min: null })];
    expect(summarize(recs)).toEqual({ flight_count: 3, first_flight: '2026-01-02', last_flight: '2026-02-10', total_hours: 1.3 });
    expect(summarize([])).toEqual({ flight_count: 0, first_flight: null, last_flight: null, total_hours: 0 });
  });
});
