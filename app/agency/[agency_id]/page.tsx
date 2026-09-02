import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAgency, publicAgencies, loadFlights, loadManifest } from '@/lib/data';
import { monthly, byWeekday, byHour, durationBins, purposeTop, stats } from '@/lib/aggregate';
import { fmtInt, fmtHours, fmtMinutes, fmtDate } from '@/lib/format';
import StatRow from '@/components/StatRow';
import StatusBadge from '@/components/StatusBadge';
import BarChartCard from '@/components/BarChartCard';
import FlightTable from '@/components/FlightTable';

export const dynamicParams = false;
export function generateStaticParams() { return publicAgencies().map(a => ({ agency_id: a.agency_id })); }
export async function generateMetadata({ params }: { params: Promise<{ agency_id: string }> }): Promise<Metadata> {
  const a = getAgency((await params).agency_id); return { title: a ? `${a.display_name} — drone flights` : 'Agency' };
}

const SOURCE: Record<string, string> = { skydio_arcgis: "Skydio transparency dashboard (Skydio aircraft only)", sfpd_datasf: 'City open-data portal (all aircraft)' };

export default async function AgencyPage({ params }: { params: Promise<{ agency_id: string }> }) {
  const { agency_id } = await params;
  const a = getAgency(agency_id); if (!a) notFound();
  const m = loadManifest(); const now = m.run_utc ? new Date(m.run_utc) : new Date();
  const recs = loadFlights(agency_id);
  const s = stats(recs, now);
  const hours = byHour(recs, a.timezone); const dur = durationBins(recs);
  const extraKeys = [...new Set(recs.flatMap(r => Object.keys(r.extra ?? {})))].filter(k => recs.some(r => r.extra?.[k] !== null && r.extra?.[k] !== undefined)).sort();
  return (
    <>
      <div className="agency-head">
        <div>
          <h2 style={{ marginBottom: 4 }}>{a.display_name}{a.state ? `, ${a.state}` : ''}</h2>
          <div className="meta"><StatusBadge status={a.status} /> &nbsp; Source: {SOURCE[a.source] ?? a.source}. Data as of {fmtDate(m.run_utc?.slice(0, 10))}.</div>
        </div>
        <a className="btn" href={a.official_url} target="_blank" rel="noopener noreferrer">View official flight map ↗</a>
      </div>
      {a.notes && <div className="note">{a.notes}</div>}
      <StatRow items={[
        { label: 'Published flights', value: fmtInt(s.flights) }, { label: 'Flight hours', value: fmtHours(s.hours) },
        { label: 'Median minutes', value: fmtMinutes(s.medianMin) }, { label: 'Flights, last 30 days', value: fmtInt(s.last30) },
        { label: 'Days since last flight', value: s.daysSinceLast === null ? '—' : String(s.daysSinceLast) }, { label: 'With case number', value: `${s.pctWithCase}%` },
      ]} />
      <div className="charts">
        <BarChartCard title="Flights per month" data={monthly(recs)} />
        <BarChartCard title="Flights by weekday" data={byWeekday(recs)} height={180} />
        {hours && <BarChartCard title={`Flights by hour of day (${a.timezone.replace('_', ' ')})`} data={hours} height={180} />}
        {dur && <BarChartCard title="Flight length (minutes)" data={dur} height={180} />}
        <BarChartCard title="Stated purpose, in the agency's own words" data={purposeTop(recs, 15)} horizontal note="Labels are exactly as the agency recorded them; blank entries are shown as “Not stated”." />
      </div>
      <h3 style={{ marginTop: 32 }}>All published flights</h3>
      <FlightTable agencyId={agency_id} timezone={a.timezone} hasTimes={!!hours} extraKeys={extraKeys} />
    </>
  );
}
