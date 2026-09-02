'use client';
import { useEffect, useMemo, useState } from 'react';
import { decodeFlightFile, type FlightFile } from '@/pipeline/flightfile';
import type { FlightRecord } from '@/pipeline/schema';
import { monthly, durationBins, purposeTop, stats, heatmapGrids, normalizePurpose } from '@/lib/aggregate';
import { fmtInt, fmtHours, fmtMinutes, fmtMonthLabel } from '@/lib/format';
import StatRow from './StatRow';
import BarChartCard from './BarChartCard';
import Heatmap from './Heatmap';
import PurposeFilter from './PurposeFilter';
import FlightTable from './FlightTable';

export default function AgencyInteractive({ agencyId, timezone, nowIso }: { agencyId: string; timezone: string; nowIso: string }) {
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

  const purposeOptions = useMemo(() => (recs ? purposeTop(recs, Infinity) : []).map(b => ({ label: b.label, count: b.value })), [recs]);
  const filtered = useMemo(() => {
    if (!recs) return [];
    return purpose === 'all' ? recs : recs.filter(r => normalizePurpose(r.purpose) === purpose);
  }, [recs, purpose]);
  const extraKeys = useMemo(() => {
    if (!recs) return [];
    return [...new Set(recs.flatMap(r => Object.keys(r.extra ?? {})))].filter(k => recs.some(r => r.extra?.[k] !== null && r.extra?.[k] !== undefined)).sort();
  }, [recs]);
  const anyTime = useMemo(() => !!recs && recs.some(r => r.takeoff_utc), [recs]);

  if (err) return <div className="note">Could not load flight data: {err}</div>;
  if (!recs) return <div className="small">Loading flight data…</div>;

  const s = stats(filtered, now);
  const heat = anyTime ? heatmapGrids(filtered, timezone) : null;
  const tzLabel = timezone.replace('_', ' ');

  return (
    <>
      <PurposeFilter options={purposeOptions} total={recs.length} value={purpose} onChange={setPurpose} />
      <StatRow items={[
        { label: 'Published flights', value: fmtInt(s.flights) }, { label: 'Flight hours', value: fmtHours(s.hours) },
        { label: 'Median minutes', value: fmtMinutes(s.medianMin) }, { label: 'Flights, last 30 days', value: fmtInt(s.last30) },
        { label: 'Days since last published flight', value: s.daysSinceLast === null ? '—' : String(s.daysSinceLast) },
        { label: 'Typical publish gap (days)', value: s.medianGapDays === null ? '—' : String(s.medianGapDays) },
        { label: 'With case number', value: `${s.pctWithCase}%` },
      ]} />
      <div className="charts">
        <BarChartCard title="Flights per month" data={monthly(filtered)} tickFormatter={fmtMonthLabel} />
        {heat && <Heatmap title={`When it flies — flight count by weekday and hour (${tzLabel})`} grid={heat.count} max={heat.maxCount} mode="count" />}
        {heat && <Heatmap title={`When the long flights happen — median flight length by weekday and hour (${tzLabel})`} grid={heat.medianMin} max={heat.maxMedian} mode="duration" note="Cells with no published flights are shown with a hatch pattern, not as a zero-minute flight." />}
        <BarChartCard compact title="Flight length (minutes)" data={durationBins(filtered) ?? []} height={220} />
        <BarChartCard title="Stated purpose, in the agency's own words" data={purposeTop(filtered, 15)} horizontal note="Labels are exactly as the agency recorded them; blank entries are shown as “Not stated”." />
      </div>
      <h3 style={{ marginTop: 32 }}>All published flights</h3>
      <FlightTable agencyId={agencyId} recs={filtered} allCount={recs.length} timezone={timezone} hasTimes={anyTime} extraKeys={extraKeys} csvNote={purpose === 'all' ? undefined : 'all flights, unfiltered'} />
    </>
  );
}
