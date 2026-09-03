import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { durationMinutes, toRecord, type CapeFlight } from '../cape/parse.js';
import { knownFlightIds } from '../cape/collect.js';
import { localDate } from '../time.js';
import { validateRecord } from '../schema.js';

describe('durationMinutes', () => {
  it('reads the HH:MM:SS form the portal returns', () => {
    expect(durationMinutes('00:06:53')).toBe(6.9);
    expect(durationMinutes('01:23:45')).toBe(83.8);
    expect(durationMinutes('00:00:00')).toBe(0);
  });

  it('reads an hour count above twenty-four', () => {
    expect(durationMinutes('26:00:00')).toBe(1560);
  });

  it('rejects anything else rather than guessing', () => {
    expect(durationMinutes('6:53')).toBeNull();
    expect(durationMinutes('00:75:00')).toBeNull();
    expect(durationMinutes(null)).toBeNull();
    expect(durationMinutes(120)).toBeNull();
  });
});

describe('toRecord', () => {
  const flight: CapeFlight = {
    id: '81c5bc88-dd60-4c85-8606-3e19dc33f2b6',
    take_off_time: '2026-08-30T02:51:38.660000Z',
    time_added: '2026-08-30T02:51:32.356840Z',
    session_duration: '00:06:53',
    flight_reason: 'Call for Service',
    flight_name: '2608-2007',
    incident_location: 'N Brea Blvd & E Cypress St',
    flight_type: 'e1609c9a-32ec-40e6-b608-aa2a5b743df4',
    is_complete: true,
  };

  it('maps a flight to a valid record', () => {
    const r = toRecord('brea-pd-ca', 'America/Los_Angeles', flight, localDate)!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.takeoff_utc).toBe('2026-08-30T02:51:38.660Z');
    expect(r.duration_min).toBe(6.9);
    expect(r.purpose).toBe('Call for Service');
    expect(r.case_number).toBe('2608-2007');
    expect(r.description).toBe('N Brea Blvd & E Cypress St');
  });

  it('dates the flight locally, so a late-evening flight is not pushed to tomorrow', () => {
    const r = toRecord('brea-pd-ca', 'America/Los_Angeles', flight, localDate)!;
    expect(r.flight_date_local).toBe('2026-08-29');
  });

  it('derives the landing time from takeoff plus duration', () => {
    const r = toRecord('a', 'UTC', flight, localDate)!;
    expect(r.landing_utc).toBe('2026-08-30T02:58:32.660Z');
  });

  it('falls back to the time the flight was added when takeoff is missing', () => {
    const r = toRecord('a', 'UTC', { ...flight, take_off_time: null }, localDate)!;
    expect(r.takeoff_utc).toBe('2026-08-30T02:51:32.356Z');
  });

  it('keeps the purpose exactly as the pilot typed it', () => {
    const r = toRecord('a', 'UTC', { ...flight, flight_reason: '33:09 minute flight time' }, localDate)!;
    expect(r.purpose).toBe('33:09 minute flight time');
  });

  it('marks a flight the portal reports as incomplete', () => {
    const r = toRecord('a', 'UTC', { ...flight, is_complete: false }, localDate)!;
    expect(r.extra.flight_incomplete).toBe(1);
  });

  it('handles a flight with no duration', () => {
    const r = toRecord('a', 'UTC', { ...flight, session_duration: null }, localDate)!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.duration_min).toBeNull();
    expect(r.landing_utc).toBeNull();
  });

  it('drops a flight with no id, since nothing can key it', () => {
    expect(toRecord('a', 'UTC', { ...flight, id: null }, localDate)).toBeNull();
  });
});

describe('knownFlightIds', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cape-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('reads back stored ids so a rolling window never re-adds a flight', () => {
    const p = join(dir, 'a.jsonl');
    writeFileSync(p, '{"id":"a-1"}\n{"id":"a-2"}\n');
    expect([...knownFlightIds(p)].sort()).toEqual(['a-1', 'a-2']);
  });

  it('is empty before the first run', () => {
    expect(knownFlightIds(join(dir, 'nope.jsonl')).size).toBe(0);
  });
});
