import type { FlightRecord } from './schema.js';

/**
 * Merging one agency's flights across the platforms it publishes on.
 *
 * Fourteen agencies publish the same programme in two or three places, and the
 * platforms do not agree about what a flight is called. Skydio issues its own
 * flight ids, Flock numbers flights per day, AirData exposes an internal row
 * id. None of them survive a crossing, so a shared flight has to be recognised
 * from what it describes rather than from what it is called.
 *
 * Two independent pieces of evidence, either of which is enough:
 *
 *   1. Same local date and the same case number. A case number is the agency's
 *      own identifier for the incident, so two platforms quoting it on one day
 *      are quoting the same call. This carries records that have no time.
 *   2. Same local date and takeoff times within five minutes. One aircraft
 *      cannot be in two places, so a near-identical takeoff is strong evidence
 *      on its own. Five minutes absorbs a clock difference between platforms
 *      while keeping two genuine flights in one shift apart.
 *
 * Case numbers that disagree do not veto a time match. Platforms number
 * incidents differently — Flock quotes the CAD event, AirData an internal case
 * id — so requiring them to agree would split almost every shared flight.
 *
 * A record with no time and no case number matches nothing but itself. It is
 * kept, because the flight is real, and left unmerged, because there is no
 * evidence tying it to anything.
 */

export type SourcedRecord = FlightRecord & { source: string };

const MATCH_WINDOW_MS = 5 * 60 * 1000;

function normalizeCase(v: string | null): string | null {
  if (!v) return null;
  const t = v.toLowerCase().replace(/[^a-z0-9]/g, '');
  return t.length ? t : null;
}

/**
 * How much a record tells you. When two platforms describe one flight, the
 * fuller account is the one worth keeping.
 */
export function completeness(r: FlightRecord): number {
  let n = 0;
  if (r.duration_min !== null) n += 4;
  if (r.takeoff_utc) n += 3;
  if (r.case_number) n += 2;
  if (r.purpose) n += 2;
  if (r.description) n += 1;
  return n;
}

export function isSameFlight(a: FlightRecord, b: FlightRecord): boolean {
  if (!a.flight_date_local || !b.flight_date_local) return false;
  if (a.flight_date_local !== b.flight_date_local) return false;

  const ca = normalizeCase(a.case_number), cb = normalizeCase(b.case_number);
  if (ca && cb && ca === cb) return true;

  if (!a.takeoff_utc || !b.takeoff_utc) return false;
  return Math.abs(Date.parse(a.takeoff_utc) - Date.parse(b.takeoff_utc)) <= MATCH_WINDOW_MS;
}

export type MergeResult = {
  records: SourcedRecord[];
  /** Flights that appeared on more than one platform. */
  overlaps: number;
  /** Flights contributed per source, before merging. */
  bySource: Record<string, number>;
};

/**
 * Merge several sources' records for one agency.
 *
 * Records within a single source are never matched against each other — each
 * collector has already deduplicated its own store, and a busy agency really
 * can fly twice inside five minutes.
 */
export function mergeSources(bySourceRecords: Record<string, FlightRecord[]>): MergeResult {
  const bySource: Record<string, number> = {};
  const sources = Object.keys(bySourceRecords);
  for (const s of sources) bySource[s] = bySourceRecords[s].length;

  // Index by date so matching never becomes a full cross-product.
  const byDate = new Map<string, SourcedRecord[]>();
  const undated: SourcedRecord[] = [];
  let overlaps = 0;

  for (const source of sources) {
    for (const raw of bySourceRecords[source]) {
      const rec: SourcedRecord = { ...raw, source };
      if (!rec.flight_date_local) { undated.push(rec); continue; }

      const bucket = byDate.get(rec.flight_date_local) ?? [];
      const hitIndex = bucket.findIndex(existing => existing.source !== source && isSameFlight(existing, rec));

      if (hitIndex === -1) {
        bucket.push(rec);
        byDate.set(rec.flight_date_local, bucket);
        continue;
      }

      overlaps++;
      const existing = bucket[hitIndex];
      const keep = completeness(rec) > completeness(existing) ? rec : existing;
      const other = keep === rec ? existing : rec;
      bucket[hitIndex] = {
        ...keep,
        extra: {
          ...keep.extra,
          also_published_by: [
            ...String(keep.extra.also_published_by ?? '').split(',').filter(Boolean),
            other.source,
          ].filter((v, i, a) => a.indexOf(v) === i).join(','),
        },
      };
    }
  }

  const records = [...[...byDate.values()].flat(), ...undated];
  return { records, overlaps, bySource };
}
