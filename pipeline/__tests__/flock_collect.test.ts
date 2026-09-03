import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monthsBetween, monthRange, needsCollection, knownFlightIds, type AgencyState } from '../flock/collect.js';

describe('monthsBetween', () => {
  it('walks months inclusively, oldest first', () => {
    expect(monthsBetween('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
  });

  it('returns a single month when both ends match', () => {
    expect(monthsBetween('2026-05', '2026-05')).toEqual(['2026-05']);
  });

  it('returns nothing when the end precedes the start', () => {
    expect(monthsBetween('2026-05', '2026-04')).toEqual([]);
  });
});

describe('monthRange', () => {
  it('ends on the first of the next month, so no day of the month is missed', () => {
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-03-01' });
  });

  it('rolls over the year in December', () => {
    expect(monthRange('2026-12')).toEqual({ start: '2026-12-01', end: '2027-01-01' });
  });
});

describe('needsCollection', () => {
  const state = (months: string[]): AgencyState => ({
    agency_id: 'a', host: 'h', total_flights: 0, last_run_utc: null, last_error: null,
    months: Object.fromEntries(months.map(m => [m, { flights: 1, pages: 1, collected_utc: '2026-09-01T00:00:00Z' }])),
  });

  it('collects a month never collected before', () => {
    expect(needsCollection(undefined, '2026-01', '2026-09-02')).toBe(true);
    expect(needsCollection(state([]), '2026-01', '2026-09-02')).toBe(true);
  });

  it('re-collects the current and previous month, because agencies publish late', () => {
    expect(needsCollection(state(['2026-09']), '2026-09', '2026-09-02')).toBe(true);
    expect(needsCollection(state(['2026-08']), '2026-08', '2026-09-02')).toBe(true);
  });

  it('trusts a settled older month', () => {
    expect(needsCollection(state(['2026-07']), '2026-07', '2026-09-02')).toBe(false);
    expect(needsCollection(state(['2025-01']), '2025-01', '2026-09-02')).toBe(false);
  });

  it('treats December as the previous month in January', () => {
    expect(needsCollection(state(['2025-12']), '2025-12', '2026-01-15')).toBe(true);
    expect(needsCollection(state(['2025-11']), '2025-11', '2026-01-15')).toBe(false);
  });
});

describe('knownFlightIds', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'flock-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is empty when nothing has been collected', () => {
    expect(knownFlightIds(join(dir, 'missing.jsonl')).size).toBe(0);
  });

  it('reads back every stored flight number', () => {
    const p = join(dir, 'a.jsonl');
    writeFileSync(p, '{"flight_number":"A-1"}\n{"flight_number":"A-2"}\n');
    expect([...knownFlightIds(p)].sort()).toEqual(['A-1', 'A-2']);
  });

  it('ignores a truncated last line from an interrupted run', () => {
    const p = join(dir, 'a.jsonl');
    writeFileSync(p, '{"flight_number":"A-1"}\n{"flight_number":"A-2","dur');
    expect([...knownFlightIds(p)]).toEqual(['A-1']);
  });
});
