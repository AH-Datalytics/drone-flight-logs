import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMonthCounts, parseFlights, parseDate, parseTime, toRecord, PAGE_SIZE, type AirDataFlight } from '../airdata/parse.js';
import { validateRecord } from '../schema.js';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, 'fixtures', 'airdata-cvpd-page.html'), 'utf8');

describe('parseMonthCounts', () => {
  it('reads the month list with the count the agency publishes for each', () => {
    const months = parseMonthCounts(page);
    expect(months.length).toBeGreaterThan(24);
    const july = months.find(m => m.month === '2026-07');
    expect(july?.count).toBeGreaterThan(0);
  });

  it('returns months oldest first', () => {
    const months = parseMonthCounts(page).map(m => m.month);
    expect([...months].sort()).toEqual(months);
  });

  it('lists each month once', () => {
    const months = parseMonthCounts(page).map(m => m.month);
    expect(new Set(months).size).toBe(months.length);
  });

  it('returns nothing for a page with no month list', () => {
    expect(parseMonthCounts('<html></html>')).toEqual([]);
  });
});

describe('parseFlights', () => {
  it('reads a full page of flights', () => {
    const flights = parseFlights(page);
    expect(flights).toHaveLength(PAGE_SIZE);
    expect(flights[0].flight_id).toMatch(/^\d+$/);
    expect(flights[0].fields.Date).toBeTruthy();
  });

  it('keeps the fields this agency chose to publish', () => {
    expect(Object.keys(parseFlights(page)[0].fields).sort())
      .toEqual(['Case/Incident', 'Date', 'Location', 'Summary', 'Time']);
  });

  it('gives every flight a distinct id', () => {
    const ids = parseFlights(page).map(f => f.flight_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('returns nothing for a month with no flights', () => {
    expect(parseFlights('<html><body>No flights</body></html>')).toEqual([]);
  });
});

describe('parseDate', () => {
  it('reads the two-digit form AirData renders', () => {
    expect(parseDate('7-31-26')).toBe('2026-07-31');
    expect(parseDate('12-1-25')).toBe('2025-12-01');
  });

  it('reads slashed and four-digit forms', () => {
    expect(parseDate('07/31/2026')).toBe('2026-07-31');
  });

  it('reads a named month', () => {
    expect(parseDate('Jul 31, 2026')).toBe('2026-07-31');
    expect(parseDate('July 4 2026')).toBe('2026-07-04');
  });

  it('rejects nonsense rather than inventing a date', () => {
    expect(parseDate('13-40-26')).toBeNull();
    expect(parseDate('')).toBeNull();
    expect(parseDate('sometime')).toBeNull();
  });
});

describe('parseTime', () => {
  it('reads twelve-hour times', () => {
    expect(parseTime('9:59pm')).toEqual({ hour: 21, minute: 59 });
    expect(parseTime('12:05am')).toEqual({ hour: 0, minute: 5 });
    expect(parseTime('12:05pm')).toEqual({ hour: 12, minute: 5 });
  });

  it('reads twenty-four-hour times', () => {
    expect(parseTime('21:59')).toEqual({ hour: 21, minute: 59 });
  });

  it('rejects an impossible time', () => {
    expect(parseTime('25:00')).toBeNull();
    expect(parseTime('9:75pm')).toBeNull();
    expect(parseTime('')).toBeNull();
  });
});

describe('toRecord', () => {
  const flight: AirDataFlight = {
    flight_id: '50270077',
    fields: { Date: '7-31-26', Time: '9:59pm', 'Case/Incident': 'CVL075642', Location: '500 Flower St', Summary: 'Fire' },
  };

  it('maps a flight to a valid record', () => {
    const r = toRecord('chula-vista-pd', 'America/Los_Angeles', flight)!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.flight_date_local).toBe('2026-07-31');
    expect(r.takeoff_utc).toBe('2026-08-01T04:59:00.000Z');
    expect(r.case_number).toBe('CVL075642');
    expect(r.purpose).toBe('Fire');
    expect(r.description).toBe('500 Flower St');
  });

  it('says plainly that the source carries no duration', () => {
    const r = toRecord('a', 'America/Los_Angeles', flight)!;
    expect(r.duration_min).toBeNull();
    expect(r.landing_utc).toBeNull();
    expect(r.data_quality).toMatch(/no flight duration/i);
  });

  it('keeps the date when an agency publishes no time', () => {
    const r = toRecord('a', 'America/Los_Angeles', { flight_id: '1', fields: { Date: '7-31-26', Location: 'x' } })!;
    expect(validateRecord(r)).toEqual([]);
    expect(r.flight_date_local).toBe('2026-07-31');
    expect(r.takeoff_utc).toBeNull();
  });

  it('keeps an unfamiliar field instead of dropping it', () => {
    const r = toRecord('a', 'UTC', { flight_id: '1', fields: { Date: '7-31-26', 'Pilot Unit': 'Air-2' } })!;
    expect(r.extra['Pilot Unit']).toBe('Air-2');
  });

  it('drops a row with no readable date, because it cannot be placed in time', () => {
    expect(toRecord('a', 'UTC', { flight_id: '1', fields: { Location: 'x' } })).toBeNull();
  });

  it('produces valid records for every flight on a real page', () => {
    for (const f of parseFlights(page)) {
      expect(validateRecord(toRecord('chula-vista-pd', 'America/Los_Angeles', f)!)).toEqual([]);
    }
  });
});
