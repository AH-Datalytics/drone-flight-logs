import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { balancedEnd, extractFlights, toRecord, type FlockFlight } from '../flock/parse.js';
import { validateRecord } from '../schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const payload = readFileSync(join(here, 'fixtures', 'flock-flights-rsc.txt'), 'utf8');

describe('balancedEnd', () => {
  it('reads a balanced object', () => {
    const s = '{"a":{"b":1}}tail';
    expect(s.slice(0, balancedEnd(s, 0))).toBe('{"a":{"b":1}}');
  });

  it('ignores braces inside strings', () => {
    const s = '{"a":"}{"}rest';
    expect(s.slice(0, balancedEnd(s, 0))).toBe('{"a":"}{"}');
  });

  it('ignores an escaped quote inside a string', () => {
    const s = '{"a":"say \\"}\\" ok"}rest';
    expect(s.slice(0, balancedEnd(s, 0))).toBe('{"a":"say \\"}\\" ok"}');
  });

  it('returns -1 when the object never closes', () => {
    expect(balancedEnd('{"a":1', 0)).toBe(-1);
  });
});

describe('extractFlights', () => {
  it('pulls every flight out of a real dashboard payload', () => {
    const flights = extractFlights(payload);
    expect(flights).toHaveLength(8);
    expect(flights[0].flight_number).toBe('EGPD-260902-0006');
    expect(flights[0].calls_for_service?.[0].cad_event_type).toBe('SUSPICIOUS - PERSON');
  });

  it('never retains flight telemetry', () => {
    const serialized = JSON.stringify(extractFlights(payload));
    expect(serialized).not.toContain('telemetry');
    expect(serialized).not.toContain('"lat"');
    expect(serialized).not.toContain('"lng"');
  });

  it('deduplicates a flight that the payload mentions twice', () => {
    const one = '"flight":{"flight_number":"A-1","duration_seconds":60}';
    expect(extractFlights(one + ',' + one)).toHaveLength(1);
  });

  it('skips an unparsable object without losing the ones after it', () => {
    const bad = '"flight":{"flight_number":"A-1",,,}';
    const good = '"flight":{"flight_number":"A-2","duration_seconds":60}';
    const got = extractFlights(bad + good);
    expect(got.map(f => f.flight_number)).toEqual(['A-2']);
  });

  it('returns nothing for a payload with no flights', () => {
    expect(extractFlights('1:"$Sreact.fragment"')).toEqual([]);
  });
});

describe('toRecord', () => {
  const flight: FlockFlight = {
    flight_number: 'EGPD-260902-0006',
    time_period: { begin: '2026-09-02T21:14:57.752Z', end: '2026-09-02T21:25:54.008Z' },
    duration_seconds: 656.255998,
    calls_for_service: [{
      cad_event_number: '26077899',
      cad_event_type: 'SUSPICIOUS - PERSON',
      priority: 3,
      address: { street_address: '85XX ALLISTER WAY', locality: 'ELK GROVE', region: 'CA', postal_code: '95624' },
    }],
  };

  it('maps a flight to a valid record', () => {
    const r = toRecord('elk-grove-pd-ca', 'America/Los_Angeles', flight)!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.source_flight_id).toBe('EGPD-260902-0006');
    expect(r.duration_min).toBe(10.9);
    expect(r.purpose).toBe('SUSPICIOUS - PERSON');
    expect(r.case_number).toBe('26077899');
    expect(r.description).toBe('85XX ALLISTER WAY, ELK GROVE');
  });

  it('dates the flight in the agency timezone, not UTC', () => {
    const late = { ...flight, time_period: { begin: '2026-09-03T05:30:00.000Z', end: '2026-09-03T05:40:00.000Z' } };
    expect(toRecord('a', 'America/Los_Angeles', late)!.flight_date_local).toBe('2026-09-02');
    expect(toRecord('a', 'America/New_York', late)!.flight_date_local).toBe('2026-09-03');
  });

  it('falls back to the time period when no duration is given', () => {
    const r = toRecord('a', 'UTC', { ...flight, duration_seconds: null })!;
    expect(r.duration_min).toBe(10.9);
  });

  it('records a flight with no call for service rather than dropping it', () => {
    const r = toRecord('a', 'UTC', { ...flight, calls_for_service: [] })!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.purpose).toBeNull();
    expect(r.case_number).toBeNull();
    expect(r.description).toBeNull();
    expect(r.extra.calls_for_service).toBe(0);
  });

  it('keeps the other call types when a flight covers several calls', () => {
    const r = toRecord('a', 'UTC', {
      ...flight,
      calls_for_service: [
        flight.calls_for_service![0],
        { cad_event_type: 'FIRE/MED AID', cad_event_number: '26077900' },
      ],
    })!;
    expect(r.extra.calls_for_service).toBe(2);
    expect(r.extra.other_call_types).toBe('FIRE/MED AID');
  });

  it('returns null without a flight number, since there is nothing to key on', () => {
    expect(toRecord('a', 'UTC', { ...flight, flight_number: null })).toBeNull();
  });

  it('survives a missing time period', () => {
    const r = toRecord('a', 'UTC', { flight_number: 'X-1' })!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.takeoff_utc).toBeNull();
    expect(r.flight_date_local).toBeNull();
    expect(r.duration_min).toBeNull();
  });

  it('produces valid records for every flight in the real payload', () => {
    for (const f of extractFlights(payload)) {
      expect(validateRecord(toRecord('elk-grove-pd-ca', 'America/Los_Angeles', f)!)).toEqual([]);
    }
  });
});
