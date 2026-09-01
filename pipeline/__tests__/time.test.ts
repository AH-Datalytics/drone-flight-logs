import { describe, it, expect } from 'vitest';
import { localDate, localHour, timezoneForPoint } from '../time.js';

describe('localDate / localHour', () => {
  // 2025-03-09T05:58:09Z is 2025-03-08 23:58 in Chicago (CST, UTC-6)
  const ms = Date.parse('2025-03-09T05:58:09.198Z');
  it('renders the date in the agency timezone', () => {
    expect(localDate(ms, 'America/Chicago')).toBe('2025-03-08');
    expect(localDate(ms, 'UTC')).toBe('2025-03-09');
  });
  it('renders the hour in the agency timezone', () => {
    expect(localHour(ms, 'America/Chicago')).toBe(23);
    expect(localHour(ms, 'America/Los_Angeles')).toBe(21);
  });
  it('handles midnight hour as 0 not 24', () => {
    const mid = Date.parse('2025-06-01T05:10:00Z'); // 00:10 CDT
    expect(localHour(mid, 'America/Chicago')).toBe(0);
  });
});

describe('timezoneForPoint', () => {
  it('maps major US cities', () => {
    expect(timezoneForPoint(-87.91, 43.04)).toBe('America/Chicago');     // Milwaukee
    expect(timezoneForPoint(-118.24, 34.05)).toBe('America/Los_Angeles'); // LA
    expect(timezoneForPoint(-104.99, 39.74)).toBe('America/Denver');     // Denver
    expect(timezoneForPoint(-84.52, 39.11)).toBe('America/New_York');    // Cincinnati
    expect(timezoneForPoint(-83.18, 42.32)).toBe('America/New_York');    // Dearborn MI
    expect(timezoneForPoint(-102.08, 31.99)).toBe('America/Chicago');    // Midland TX
    expect(timezoneForPoint(-106.49, 31.76)).toBe('America/Denver');     // El Paso
    expect(timezoneForPoint(-112.07, 33.45)).toBe('America/Phoenix');    // Phoenix
    expect(timezoneForPoint(-149.9, 61.22)).toBe('America/Anchorage');
    expect(timezoneForPoint(-157.86, 21.31)).toBe('Pacific/Honolulu');
  });
  it('returns null outside the US', () => {
    expect(timezoneForPoint(-110.68, 50.04)).toBeNull();   // Medicine Hat, AB
    expect(timezoneForPoint(149.13, -35.28)).toBeNull();   // Canberra
    expect(timezoneForPoint(NaN, 40)).toBeNull();
  });
});
