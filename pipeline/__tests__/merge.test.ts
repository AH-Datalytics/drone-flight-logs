import { describe, it, expect } from 'vitest';
import { isSameFlight, completeness, mergeSources } from '../merge.js';
import type { FlightRecord } from '../schema.js';

const rec = (over: Partial<FlightRecord> = {}): FlightRecord => ({
  agency_id: 'a',
  source_flight_id: 'x',
  takeoff_utc: '2026-08-30T02:51:38.000Z',
  flight_date_local: '2026-08-29',
  landing_utc: null,
  duration_min: null,
  purpose: null,
  description: null,
  case_number: null,
  extra: {},
  data_quality: null,
  ...over,
});

describe('isSameFlight', () => {
  it('matches the same case number on the same day', () => {
    const a = rec({ case_number: 'CVL075642', takeoff_utc: null });
    const b = rec({ case_number: 'cvl-075642', takeoff_utc: null, source_flight_id: 'y' });
    expect(isSameFlight(a, b)).toBe(true);
  });

  it('matches takeoff times a couple of minutes apart', () => {
    expect(isSameFlight(rec(), rec({ takeoff_utc: '2026-08-30T02:53:38.000Z' }))).toBe(true);
  });

  it('separates takeoffs more than five minutes apart', () => {
    expect(isSameFlight(rec(), rec({ takeoff_utc: '2026-08-30T03:05:00.000Z' }))).toBe(false);
  });

  it('still matches on time when the platforms number the incident differently', () => {
    const a = rec({ case_number: '26077899' });
    const b = rec({ case_number: 'CVL075642', takeoff_utc: '2026-08-30T02:52:00.000Z' });
    expect(isSameFlight(a, b)).toBe(true);
  });

  it('separates different case numbers when neither record has a time', () => {
    const a = rec({ case_number: 'AAA-1', takeoff_utc: null });
    const b = rec({ case_number: 'BBB-2', takeoff_utc: null });
    expect(isSameFlight(a, b)).toBe(false);
  });

  it('separates different days', () => {
    expect(isSameFlight(rec(), rec({ flight_date_local: '2026-08-30' }))).toBe(false);
  });

  it('matches nothing when neither a time nor a case number is known', () => {
    const a = rec({ takeoff_utc: null });
    const b = rec({ takeoff_utc: null, source_flight_id: 'y' });
    expect(isSameFlight(a, b)).toBe(false);
  });

  it('matches nothing when the date is unknown', () => {
    expect(isSameFlight(rec({ flight_date_local: null }), rec())).toBe(false);
  });
});

describe('completeness', () => {
  it('ranks a record with a duration above one without', () => {
    expect(completeness(rec({ duration_min: 12 }))).toBeGreaterThan(completeness(rec()));
  });

  it('ranks a record with a case number and purpose above a bare one', () => {
    expect(completeness(rec({ case_number: 'x', purpose: 'y' }))).toBeGreaterThan(completeness(rec()));
  });
});

describe('mergeSources', () => {
  it('keeps flights that appear on only one platform', () => {
    const out = mergeSources({
      skydio: [rec({ source_flight_id: 's1' })],
      flock: [rec({ source_flight_id: 'f1', flight_date_local: '2026-08-30', takeoff_utc: '2026-08-31T02:00:00.000Z' })],
    });
    expect(out.records).toHaveLength(2);
    expect(out.overlaps).toBe(0);
  });

  it('merges one flight published on two platforms', () => {
    const out = mergeSources({
      skydio: [rec({ source_flight_id: 's1' })],
      flock: [rec({ source_flight_id: 'f1', takeoff_utc: '2026-08-30T02:52:30.000Z' })],
    });
    expect(out.records).toHaveLength(1);
    expect(out.overlaps).toBe(1);
  });

  it('keeps the fuller account of a shared flight', () => {
    const out = mergeSources({
      airdata: [rec({ source_flight_id: 'a1', purpose: 'Fire' })],
      flock: [rec({ source_flight_id: 'f1', duration_min: 11, purpose: 'FIRE/MED AID', case_number: 'C-1' })],
    });
    expect(out.records).toHaveLength(1);
    expect(out.records[0].source).toBe('flock');
    expect(out.records[0].duration_min).toBe(11);
  });

  it('records which other platform also published a shared flight', () => {
    const out = mergeSources({
      airdata: [rec({ source_flight_id: 'a1' })],
      flock: [rec({ source_flight_id: 'f1', duration_min: 11 })],
    });
    expect(out.records[0].extra.also_published_by).toBe('airdata');
  });

  it('never merges two flights from the same platform', () => {
    const out = mergeSources({
      flock: [rec({ source_flight_id: 'f1' }), rec({ source_flight_id: 'f2', takeoff_utc: '2026-08-30T02:52:00.000Z' })],
    });
    expect(out.records).toHaveLength(2);
    expect(out.overlaps).toBe(0);
  });

  it('counts what each platform contributed before merging', () => {
    const out = mergeSources({
      skydio: [rec({ source_flight_id: 's1' }), rec({ source_flight_id: 's2', flight_date_local: '2026-01-01', takeoff_utc: '2026-01-01T12:00:00.000Z' })],
      flock: [rec({ source_flight_id: 'f1' })],
    });
    expect(out.bySource).toEqual({ skydio: 2, flock: 1 });
    expect(out.records).toHaveLength(2);
  });

  it('keeps a dateless record rather than dropping it', () => {
    const out = mergeSources({ skydio: [rec({ flight_date_local: null, takeoff_utc: null })] });
    expect(out.records).toHaveLength(1);
  });

  it('handles an agency with a single source', () => {
    const out = mergeSources({ sfpd: [rec(), rec({ source_flight_id: 'b', flight_date_local: '2026-08-30' })] });
    expect(out.records).toHaveLength(2);
    expect(out.overlaps).toBe(0);
  });

  it('merges a flight published on three platforms into one', () => {
    const out = mergeSources({
      skydio: [rec({ source_flight_id: 's1' })],
      flock: [rec({ source_flight_id: 'f1', duration_min: 10 })],
      airdata: [rec({ source_flight_id: 'a1' })],
    });
    expect(out.records).toHaveLength(1);
    expect(out.overlaps).toBe(2);
    expect(String(out.records[0].extra.also_published_by).split(',').sort()).toEqual(['airdata', 'skydio']);
  });
});
