'use client';
import { useEffect, useMemo, useState } from 'react';
import { decodeFlightFile, type FlightFile } from '@/pipeline/flightfile';
import type { FlightRecord } from '@/pipeline/schema';
import { monthly, durationBins, purposeTop, stats, heatmapGrids, normalizePurpose, type Bar, type HeatGrids } from '@/lib/aggregate';
import { fmtInt, fmtHours, fmtMinutes, fmtMonthLabel } from '@/lib/format';
import StatRow from './StatRow';
import BarChartCard from './BarChartCard';
import Heatmap from './Heatmap';
import PurposeFilter from './PurposeFilter';
import FlightTable from './FlightTable';

export type AgencyInitial = {
  stats: ReturnType<typeof stats>;
  monthly: Bar[];
  durationBins: Bar[];
  purposeAll: Bar[];
  eventAll: Bar[];
  eventCount: number;
  minEventsToChart: number;
  durationCount: number;
  minDurationsToChart: number;
  heat: HeatGrids | null;
  anyTime: boolean;
  allCount: number;
  purposeOptions: { label: string; count: number }[];
  purposeOptionsHidden: number;
  extraKeys: string[];
};

export default function AgencyInteractive({ agencyId, timezone, nowIso, initial }: { agencyId: string; timezone: string; nowIso: string; initial: AgencyInitial }) {
  const [recs, setRecs] = useState<FlightRecord[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [purpose, setPurpose] = useState('all');
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  useEffect(() => {
    setRecs(null); setErr(null); setPurpose('all');
    fetch(`/data/flights/${agencyId}.json`)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((f: FlightFile) => setRecs(decodeFlightFile(f)))
      .catch(e => setErr(String(e)));
  }, [agencyId]);

  const filtered = useMemo(() => {
    if (!recs) return null;
    return purpose === 'all' ? recs : recs.filter(r => normalizePurpose(r.purpose) === purpose);
  }, [recs, purpose]);

  // Until the records arrive — and whenever nothing is filtered — render the server's
  // figures. They are identical to what the client would compute, so there is nothing
  // to wait for.
  const view = useMemo(() => {
    if (!filtered || purpose === 'all') return initial;
    return {
      ...initial,
      stats: stats(filtered, now),
      monthly: monthly(filtered),
      durationBins: durationBins(filtered) ?? [],
      heat: initial.anyTime ? heatmapGrids(filtered, timezone) : null,
    };
  }, [filtered, purpose, initial, now, timezone]);

  // Both categorical charts render at the height the taller one needs, so the pair
  // reads as one row instead of a tall chart beside a stub. BarChartCard takes the
  // greater of the height it is given and the height its own bars need, so passing
  // the maximum stretches the shorter chart without squashing the other.
  const showEvents = initial.eventCount >= initial.minEventsToChart && initial.eventAll.length > 0;
  const pairRows = Math.max(initial.purposeAll.length, showEvents ? initial.eventAll.length : 0);
  const pairHeight = pairRows * 26 + 30;

  const tzLabel = timezone.replace('_', ' ');
  const filtering = purpose !== 'all';

  return (
    <>
      <PurposeFilter
        options={initial.purposeOptions}
        hiddenCount={initial.purposeOptionsHidden}
        total={initial.allCount}
        value={purpose}
        onChange={setPurpose}
        disabled={!recs && !err}
      />
      {err && <div className="note">Could not load flight data for filtering or the flight table: {err}. The figures below are the full unfiltered dataset.</div>}
      <StatRow items={[
        { label: 'Published flights', value: fmtInt(view.stats.flights) },
        { label: 'Flight hours', value: fmtHours(view.stats.hours) },
        { label: 'Median minutes', value: initial.durationCount >= initial.minDurationsToChart ? fmtMinutes(view.stats.medianMin) : '—' },
        { label: 'Flights, last 30 days', value: fmtInt(view.stats.last30) },
        { label: 'Days since last published flight', value: view.stats.daysSinceLast === null ? '—' : String(view.stats.daysSinceLast) },
        { label: 'With case number', value: `${view.stats.pctWithCase}%` },
      ]} />
      <div className="charts">
        <BarChartCard title="Flights per month" data={view.monthly} tickFormatter={fmtMonthLabel} />
        {view.heat && <Heatmap title={`When it flies — flight count by weekday and hour (${tzLabel})`} grid={view.heat.count} max={view.heat.maxCount} />}
        {initial.durationCount >= initial.minDurationsToChart && (
          <BarChartCard
            compact
            title="Flight length (minutes)"
            data={view.durationBins}
            height={220}
            note={initial.durationCount < initial.allCount
              ? `Durations are recorded on ${fmtInt(initial.durationCount)} of ${fmtInt(initial.allCount)} flights; this chart covers those.`
              : undefined}
          />
        )}
        {/* Always the full breakdown: filtered to one purpose it would be a single bar,
            and it doubles as the legend for the filter above. */}
        <div className="chart-pair">
          <BarChartCard
            title="15 most common stated purposes"
            data={initial.purposeAll}
            horizontal
            height={pairHeight}
            note={filtering
              ? 'Always the full breakdown, not the current filter — it is the key to what the filter can select.'
              : 'Blank entries appear as “Not stated”. Each agency writes its own labels, so they mean different things at different departments.'}
          />
          {showEvents && (
            <BarChartCard
              title="15 most common event descriptions"
              data={initial.eventAll}
              horizontal
              height={pairHeight}
              note={`What the flight was sent to, recorded on ${fmtInt(initial.eventCount)} of ${fmtInt(initial.allCount)} flights.`}
            />
          )}
        </div>
      </div>
      <h3 style={{ marginTop: 32 }}>All published flights</h3>
      {filtered
        ? <FlightTable agencyId={agencyId} recs={filtered} allCount={initial.allCount} timezone={timezone} hasTimes={initial.anyTime} extraKeys={initial.extraKeys} csvNote={filtering ? 'all flights, unfiltered' : undefined} />
        : <div className="small">Loading the flight table…</div>}
    </>
  );
}
