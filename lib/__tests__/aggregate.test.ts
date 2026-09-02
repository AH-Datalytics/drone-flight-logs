import { describe, it, expect } from 'vitest';
import { monthly, byWeekday, byHour, durationBins, purposeTop, stats } from '../aggregate';
import type { FlightRecord } from '@/pipeline/schema';

const r = (o: Partial<FlightRecord>): FlightRecord => ({ agency_id: 'a', source_flight_id: Math.random().toString(36), takeoff_utc: null, flight_date_local: null, landing_utc: null, duration_min: null, purpose: null, description: null, case_number: null, extra: {}, data_quality: null, ...o });
const NOW = new Date('2026-09-01T00:00:00Z');

describe('monthly', () => {
  it('fills missing months with zero', () => {
    const out = monthly([r({ flight_date_local: '2026-01-15' }), r({ flight_date_local: '2026-03-02' }), r({ flight_date_local: '2026-03-09' })]);
    expect(out).toEqual([{ label: '2026-01', value: 1 }, { label: '2026-02', value: 0 }, { label: '2026-03', value: 2 }]);
  });
  it('ignores null dates and handles empty', () => { expect(monthly([r({})])).toEqual([]); expect(monthly([])).toEqual([]); });
});
describe('byWeekday', () => {
  it('counts Mon..Sun', () => {
    const out = byWeekday([r({ flight_date_local: '2026-08-31' }), r({ flight_date_local: '2026-08-30' })]); // Mon, Sun
    expect(out.map(b => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(out[0].value).toBe(1); expect(out[6].value).toBe(1);
  });
});
describe('byHour', () => {
  it('uses the agency timezone and returns null when no times', () => {
    const out = byHour([r({ takeoff_utc: '2026-06-01T05:10:00.000Z' })], 'America/Chicago')!; // 00:10 CDT
    expect(out.length).toBe(24); expect(out[0]).toEqual({ label: '0', value: 1 });
    expect(byHour([r({ flight_date_local: '2026-01-01' })], 'UTC')).toBeNull();
  });
});
describe('durationBins', () => {
  it('bins in 5-minute steps with a 60+ tail', () => {
    const out = durationBins([r({ duration_min: 2 }), r({ duration_min: 5 }), r({ duration_min: 59.9 }), r({ duration_min: 61 })])!;
    expect(out.length).toBe(13);
    expect(out[0]).toEqual({ label: '0–5', value: 1 }); expect(out[1]).toEqual({ label: '5–10', value: 1 }); expect(out[11]).toEqual({ label: '55–60', value: 1 }); expect(out[12]).toEqual({ label: '60+', value: 1 });
    expect(durationBins([r({})])).toBeNull();
  });
});
describe('purposeTop', () => {
  it('keeps agency wording, labels blanks, rolls up the tail', () => {
    const recs = [...Array(3)].map(() => r({ purpose: 'Radio Call' })).concat([r({ purpose: 'Training' }), r({ purpose: null }), r({ purpose: 'X' }), r({ purpose: 'Y' })]);
    expect(purposeTop(recs, 2)).toEqual([{ label: 'Radio Call', value: 3 }, { label: 'Not stated', value: 1 }, { label: 'Other (3 values)', value: 3 }]);
  });
});
describe('stats', () => {
  it('computes headline numbers', () => {
    const recs = [r({ flight_date_local: '2026-08-20', duration_min: 10, case_number: 'A' }), r({ flight_date_local: '2026-06-01', duration_min: 30 }), r({ flight_date_local: '2026-08-30', duration_min: 20, case_number: 'B' })];
    expect(stats(recs, NOW)).toEqual({ flights: 3, hours: 1, medianMin: 20, last30: 2, daysSinceLast: 2, pctWithCase: 66.7 });
    expect(stats([], NOW)).toEqual({ flights: 0, hours: 0, medianMin: null, last30: 0, daysSinceLast: null, pctWithCase: 0 });
  });
});
