import { describe, it, expect } from 'vitest';
import { utcFromWallTime, localDate } from '../time.js';

describe('utcFromWallTime', () => {
  it('applies the standard-time offset', () => {
    expect(utcFromWallTime(2026, 1, 15, 9, 30, 'America/Los_Angeles')).toBe('2026-01-15T17:30:00.000Z');
    expect(utcFromWallTime(2026, 1, 15, 9, 30, 'America/New_York')).toBe('2026-01-15T14:30:00.000Z');
  });

  it('applies the daylight-time offset', () => {
    expect(utcFromWallTime(2026, 7, 31, 21, 59, 'America/Los_Angeles')).toBe('2026-08-01T04:59:00.000Z');
  });

  it('handles a zone that does not observe daylight time', () => {
    expect(utcFromWallTime(2026, 7, 15, 12, 0, 'America/Phoenix')).toBe('2026-07-15T19:00:00.000Z');
    expect(utcFromWallTime(2026, 1, 15, 12, 0, 'America/Phoenix')).toBe('2026-01-15T19:00:00.000Z');
  });

  it('round-trips back to the same local date', () => {
    for (const tz of ['America/Los_Angeles', 'America/New_York', 'America/Chicago', 'America/Denver']) {
      const iso = utcFromWallTime(2026, 3, 8, 23, 30, tz)!;
      expect(localDate(Date.parse(iso), tz)).toBe('2026-03-08');
    }
  });

  it('resolves an ambiguous autumn hour to the earlier instant', () => {
    // 1:30am occurs twice on 2026-11-01 in US Pacific.
    const iso = utcFromWallTime(2026, 11, 1, 1, 30, 'America/Los_Angeles')!;
    expect(iso).toBe('2026-11-01T08:30:00.000Z');
  });

  it('returns null for a wall time the spring-forward skips', () => {
    // 2:30am does not exist on 2026-03-08 in US Pacific.
    expect(utcFromWallTime(2026, 3, 8, 2, 30, 'America/Los_Angeles')).toBeNull();
  });

  it('handles midnight and the last minute of a day', () => {
    expect(utcFromWallTime(2026, 6, 1, 0, 0, 'UTC')).toBe('2026-06-01T00:00:00.000Z');
    expect(utcFromWallTime(2026, 6, 1, 23, 59, 'UTC')).toBe('2026-06-01T23:59:00.000Z');
  });
});
