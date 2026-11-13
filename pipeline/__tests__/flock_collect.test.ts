import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  monthsBetween, monthRange, needsCollection, knownFlightIds, inParallel, crawlMonth, summarizeMonthErrors,
  type AgencyState,
} from '../flock/collect.js';
import type { FlockFlight } from '../flock/parse.js';

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

  it('re-collects an older month that could not be read', () => {
    const failed = state(['2025-01']);
    failed.months['2025-01'] = { flights: 0, pages: 0, collected_utc: '2026-09-01T00:00:00Z', error: 'HTTP 403' };
    expect(needsCollection(failed, '2025-01', '2026-09-02')).toBe(true);
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

describe('inParallel', () => {
  it('runs every item exactly once', async () => {
    const seen: number[] = [];
    await inParallel([1, 2, 3, 4, 5], 2, async n => { seen.push(n); });
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it('never runs more than the requested number at a time', async () => {
    let running = 0, peak = 0;
    await inParallel([1, 2, 3, 4, 5, 6], 2, async () => {
      running++; peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 5));
      running--;
    });
    expect(peak).toBe(2);
  });

  it('handles an empty list', async () => {
    await expect(inParallel([], 3, async () => {})).resolves.toBeUndefined();
  });
});

describe('crawlMonth', () => {
  const opts = { requestDelayMs: 0, maxPagesPerMonth: 10, log: () => {}, label: 'a' };
  /** A payload carrying `n` flights, numbered from `from`. */
  const page = (from: number, n: number) =>
    Array.from({ length: n }, (_, i) => `"flight":{"flight_number":"F-${from + i}"}`).join(',');
  const collected = () => {
    const seen: FlockFlight[] = [];
    return { seen, onFlights: (f: FlockFlight[]) => { seen.push(...f); } };
  };

  it('reads pages until a short one, and reports no error', async () => {
    const pages = [page(0, 8), page(8, 3)];
    const { seen, onFlights } = collected();
    const r = await crawlMonth(async q => pages[Number(q.split('page=')[1]) - 1] ?? '', '2026-01', onFlights, opts);
    expect(r).toEqual({ flights: 11, pages: 2, error: null });
    expect(seen).toHaveLength(11);
  });

  it('reports a genuinely empty month as empty, not failed', async () => {
    const r = await crawlMonth(async () => '', '2026-01', () => {}, opts);
    expect(r).toEqual({ flights: 0, pages: 0, error: null });
  });

  it('reports a blocked month as an error, not as an empty month', async () => {
    const r = await crawlMonth(async () => { throw new Error('HTTP 403'); }, '2026-01', () => {}, opts);
    expect(r).toEqual({ flights: 0, pages: 0, error: 'HTTP 403' });
  });

  it('records only the first line of an error, not the stack Playwright appends', async () => {
    const r = await crawlMonth(async () => { throw new Error('page.evaluate: Error: HTTP 403\n    at eval (x:1:84)'); }, '2026-01', () => {}, opts);
    expect(r.error).toBe('page.evaluate: Error: HTTP 403');
  });

  it('keeps going after a failure that a retry recovers from', async () => {
    let calls = 0;
    const fetch = async () => {
      calls++;
      if (calls === 1 || calls === 3) throw new Error('HTTP 429'); // two failures, never three in a row
      return calls === 2 ? page(0, 8) : page(8, 2);
    };
    const r = await crawlMonth(fetch, '2026-01', () => {}, opts);
    expect(r).toEqual({ flights: 10, pages: 2, error: null });
  });

  it('keeps the flights it read before a page failed for good', async () => {
    const { seen, onFlights } = collected();
    const fetch = async (q: string) => { if (q.endsWith('page=1')) return page(0, 8); throw new Error('HTTP 403'); };
    const r = await crawlMonth(fetch, '2026-01', onFlights, opts);
    expect(r).toEqual({ flights: 8, pages: 1, error: 'HTTP 403' });
    expect(seen).toHaveLength(8);
  });
});

describe('summarizeMonthErrors', () => {
  const ok = { flights: 0, pages: 0, collected_utc: '2026-09-01T00:00:00Z' };
  const bad = { ...ok, error: 'HTTP 403' };

  it('is null when every month was read', () => {
    expect(summarizeMonthErrors({ '2026-01': ok, '2026-02': { ...ok, flights: 4, pages: 1 } })).toBeNull();
  });

  it('names the months that failed, so check-sources can report them', () => {
    expect(summarizeMonthErrors({ '2026-01': bad, '2026-02': ok, '2026-03': bad }))
      .toBe('2 month(s) could not be read: 2026-01 (HTTP 403), 2026-03 (HTTP 403)');
  });

  it('keeps the line short when many months failed', () => {
    const months = Object.fromEntries(['01', '02', '03', '04', '05'].map(m => [`2026-${m}`, bad]));
    expect(summarizeMonthErrors(months)).toMatch(/^5 month\(s\) could not be read: .* …$/);
  });
});
