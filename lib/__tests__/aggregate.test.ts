import { describe, it, expect } from 'vitest';
import { monthly, byWeekday, byHour, durationBins, purposeTop, stats, normalizePurpose, heatmapGrids, medianPublishGapDays, suppressionReason, eventTop, eventRecords } from '../aggregate';
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
    expect(stats(recs, NOW)).toEqual({ flights: 3, hours: 1, medianMin: 20, last30: 2, daysSinceLast: 2, pctWithCase: 66.7, medianGapDays: 45 });
    expect(stats([], NOW)).toEqual({ flights: 0, hours: 0, medianMin: null, last30: 0, daysSinceLast: null, pctWithCase: 0, medianGapDays: null });
  });
});
describe('normalizePurpose', () => {
  it('trims and labels blanks as Not stated', () => {
    expect(normalizePurpose('  Patrol Support  ')).toBe('Patrol Support');
    expect(normalizePurpose(null)).toBe('Not stated'); expect(normalizePurpose('   ')).toBe('Not stated');
  });
});
describe('medianPublishGapDays', () => {
  it('is the median gap between consecutive distinct published dates', () => {
    expect(medianPublishGapDays([r({ flight_date_local: '2026-06-01' }), r({ flight_date_local: '2026-08-20' }), r({ flight_date_local: '2026-08-30' })])).toBe(45);
    expect(medianPublishGapDays([r({ flight_date_local: '2026-01-01' }), r({ flight_date_local: '2026-01-05' }), r({ flight_date_local: '2026-01-15' })])).toBe(7);
  });
  it('ignores duplicate dates and needs at least two distinct dates', () => {
    expect(medianPublishGapDays([r({ flight_date_local: '2026-01-01' }), r({ flight_date_local: '2026-01-01' })])).toBeNull();
    expect(medianPublishGapDays([r({ flight_date_local: '2026-01-01' })])).toBeNull();
    expect(medianPublishGapDays([])).toBeNull();
  });
});
describe('heatmapGrids', () => {
  it('buckets by local weekday and hour, and computes per-cell average duration', () => {
    // 2026-08-31 is a Monday. Two flights same weekday+hour in Chicago time -> one count cell, average of durations.
    const g = heatmapGrids([
      r({ takeoff_utc: '2026-08-31T15:10:00.000Z', duration_min: 10 }), // 10:10 CDT Mon
      r({ takeoff_utc: '2026-08-31T15:40:00.000Z', duration_min: 20 }), // 10:40 CDT Mon
      r({ takeoff_utc: '2026-09-01T15:10:00.000Z', duration_min: 30 }), // Tue, no case_number relevance
    ], 'America/Chicago')!;
    expect(g.count[0][10]).toBe(2); // Mon, 10am
    expect(g.count[1][10]).toBe(1); // Tue, 10am
    expect(g.maxCount).toBe(2);
    expect(g.count.length).toBe(7); expect(g.count[0].length).toBe(24);
  });
  it('returns null when no record has a takeoff time', () => {
    expect(heatmapGrids([r({ flight_date_local: '2026-01-01' })], 'UTC')).toBeNull();
  });
});

describe('suppressionReason', () => {
  const f = (o: Partial<FlightRecord>): FlightRecord => ({
    agency_id: 'a', source_flight_id: Math.random().toString(36), takeoff_utc: null,
    flight_date_local: '2026-01-01', landing_utc: null, duration_min: 20, purpose: 'Call for Service',
    description: null, case_number: null, extra: {}, data_quality: null, ...o,
  });

  it('suppresses an agency with no published flights', () => {
    expect(suppressionReason([])).toBe('no published flights');
  });

  it('suppresses a one-day trial however many flights it holds', () => {
    // Las Vegas Metro's real shape: several flights, all on one day, nothing since.
    const recs = [1, 2, 3].map(() => f({ flight_date_local: '2026-05-27' }));
    expect(suppressionReason(recs)).toBe('flights on only 1 day');
  });

  it('suppresses two active days, keeps three', () => {
    const two = ['2026-01-01', '2026-01-02'].map(d => f({ flight_date_local: d }));
    expect(suppressionReason(two)).toBe('flights on only 2 days');
    const three = ['2026-01-01', '2026-01-02', '2026-01-03'].map(d => f({ flight_date_local: d }));
    expect(suppressionReason(three)).toBeNull();
  });

  it('suppresses a record that is entirely testing or training, at any size', () => {
    const recs = ['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01']
      .map(d => f({ flight_date_local: d, purpose: 'Training' }));
    expect(suppressionReason(recs)).toBe('every published flight is testing or training');
  });

  it('keeps a small but genuine program spread across days', () => {
    // A handful of real flights over several days is small, not unrepresentative.
    const recs = ['2026-01-01', '2026-02-14', '2026-03-30', '2026-05-02', '2026-06-11']
      .map(d => f({ flight_date_local: d, purpose: 'Missing Person' }));
    expect(suppressionReason(recs)).toBeNull();
  });

  it('keeps a program that merely includes training among real flights', () => {
    const recs = [
      f({ flight_date_local: '2026-01-01', purpose: 'Training' }),
      f({ flight_date_local: '2026-02-01', purpose: 'Training' }),
      f({ flight_date_local: '2026-03-01', purpose: 'Pursuit' }),
    ];
    expect(suppressionReason(recs)).toBeNull();
  });
});

describe('eventTop', () => {
  const rec = (source: string, description: string | null) => ({
    agency_id: 'a', source_flight_id: Math.random().toString(36).slice(2),
    takeoff_utc: null, flight_date_local: '2026-01-01', landing_utc: null, duration_min: null,
    purpose: null, description, case_number: null, extra: {}, data_quality: null, source,
  });

  it('counts event descriptions from sources that publish one', () => {
    const bars = eventTop([
      rec('skydio_arcgis', 'DISTURBANCE'),
      rec('skydio_arcgis', 'DISTURBANCE'),
      rec('skydio_arcgis', 'BURGLARY'),
      rec('sfpd_datasf', 'PERSON W/GUN'),
    ], 15);
    expect(bars).toEqual([
      { label: 'DISTURBANCE', value: 2 },
      { label: 'BURGLARY', value: 1 },
      { label: 'PERSON W/GUN', value: 1 },
    ]);
  });

  it('ignores sources whose description is a street address', () => {
    const bars = eventTop([
      rec('flock_aerodome', '85XX ALLISTER WAY, ELK GROVE'),
      rec('airdata', '315 4th Ave'),
      rec('motorola_cape', '1 Civic Center Cir'),
    ], 15);
    expect(bars).toEqual([]);
  });

  it('keeps events and drops addresses for an agency publishing on both', () => {
    const bars = eventTop([
      rec('skydio_arcgis', 'TRAFFIC CRASH'),
      rec('flock_aerodome', '41XX RUCKER AVE, EVERETT'),
    ], 15);
    expect(bars).toEqual([{ label: 'TRAFFIC CRASH', value: 1 }]);
  });

  it('gathers everything past the cap into one bar', () => {
    const bars = eventTop(['a', 'b', 'c', 'd'].map(d => rec('skydio_arcgis', d)), 2);
    expect(bars).toHaveLength(3);
    expect(bars[2]).toEqual({ label: 'Other (2 values)', value: 2 });
  });

  it('skips blank descriptions rather than charting an empty label', () => {
    expect(eventTop([rec('skydio_arcgis', ''), rec('skydio_arcgis', null), rec('skydio_arcgis', '  ')], 15)).toEqual([]);
  });

  it('returns nothing when no record names its source', () => {
    const noSource = { ...rec('skydio_arcgis', 'DISTURBANCE'), source: undefined };
    expect(eventTop([noSource], 15)).toEqual([]);
  });
});

describe('eventRecords', () => {
  it('counts only the flights an event chart can draw on', () => {
    const mk = (source: string, description: string | null) => ({
      agency_id: 'a', source_flight_id: 's', takeoff_utc: null, flight_date_local: null, landing_utc: null,
      duration_min: null, purpose: null, description, case_number: null, extra: {}, data_quality: null, source,
    });
    expect(eventRecords([
      mk('skydio_arcgis', 'DISTURBANCE'),
      mk('skydio_arcgis', null),
      mk('flock_aerodome', '1 Main St'),
    ])).toHaveLength(1);
  });
});

describe('eventTop case folding', () => {
  const rec = (description: string) => ({
    agency_id: 'a', source_flight_id: description + Math.random(), takeoff_utc: null,
    flight_date_local: null, landing_utc: null, duration_min: null, purpose: null,
    description, case_number: null, extra: {}, data_quality: null, source: 'skydio_arcgis',
  });

  it('counts spellings of one event together', () => {
    const recs = [
      ...Array(5).fill(0).map(() => rec('DISTURBANCE')),
      ...Array(3).fill(0).map(() => rec('Disturbance')),
      rec('disturbance'),
    ];
    expect(eventTop(recs, 15)).toEqual([{ label: 'DISTURBANCE', value: 9 }]);
  });

  it('labels the group with the agency’s most-used spelling', () => {
    const recs = [rec('DISTURBANCE'), ...Array(4).fill(0).map(() => rec('Disturbance'))];
    expect(eventTop(recs, 15)[0].label).toBe('Disturbance');
  });

  it('treats runs of whitespace as one space', () => {
    expect(eventTop([rec('TRAFFIC  CRASH'), rec('TRAFFIC CRASH')], 15)).toEqual([
      { label: 'TRAFFIC CRASH', value: 2 },
    ]);
  });

  it('keeps genuinely different events apart', () => {
    const bars = eventTop([rec('BURGLARY'), rec('burglary'), rec('ROBBERY')], 15);
    expect(bars).toEqual([{ label: 'BURGLARY', value: 2 }, { label: 'ROBBERY', value: 1 }]);
  });
});

describe('heatmapGrids duration grid', () => {
  const at = (iso: string, duration: number | null) => ({
    agency_id: 'a', source_flight_id: iso + duration, takeoff_utc: iso,
    flight_date_local: iso.slice(0, 10), landing_utc: null, duration_min: duration,
    purpose: null, description: null, case_number: null, extra: {}, data_quality: null,
  });

  it('totals the recorded flight time for each weekday and hour', () => {
    // 2026-01-05 is a Monday; 18:00 UTC is 10:00 in Los Angeles.
    const g = heatmapGrids([
      at('2026-01-05T18:00:00.000Z', 10),
      at('2026-01-05T18:30:00.000Z', 20),
      at('2026-01-05T18:45:00.000Z', 60),
    ], 'America/Los_Angeles')!;
    expect(g.count[0][10]).toBe(3);
    expect(g.totalMin[0][10]).toBe(90);
    expect(g.maxTotal).toBe(90);
  });

  it('rounds a total to a tenth of a minute rather than a float artifact', () => {
    const g = heatmapGrids([
      at('2026-01-05T18:00:00.000Z', 0.1),
      at('2026-01-05T18:30:00.000Z', 0.2),
    ], 'America/Los_Angeles')!;
    expect(g.totalMin[0][10]).toBe(0.3);
  });

  it('counts only the flights whose length was recorded', () => {
    const g = heatmapGrids([
      at('2026-01-05T18:00:00.000Z', 10),
      at('2026-01-05T18:30:00.000Z', null),
    ], 'America/Los_Angeles')!;
    expect(g.count[0][10]).toBe(2);
    expect(g.totalMin[0][10]).toBe(10);
  });

  it('leaves an hour with flights but no recorded lengths as unknown, not zero', () => {
    const g = heatmapGrids([at('2026-01-05T18:00:00.000Z', null)], 'America/Los_Angeles')!;
    expect(g.count[0][10]).toBe(1);
    expect(g.totalMin[0][10]).toBeNull();
    expect(g.maxTotal).toBe(0);
  });

  it('reads an hour with no flights at all as no time in the air', () => {
    const g = heatmapGrids([at('2026-01-05T18:00:00.000Z', 10)], 'America/Los_Angeles')!;
    expect(g.totalMin[0][11]).toBe(0);
  });

  it('still returns nothing when no flight has a time', () => {
    expect(heatmapGrids([{ ...at('2026-01-05T18:00:00.000Z', 10), takeoff_utc: null }], 'UTC')).toBeNull();
  });
});
