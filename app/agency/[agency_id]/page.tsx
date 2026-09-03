import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAgency, publicAgencies, loadManifest, loadFlights } from '@/lib/data';
import { fmtDate, fmtInt } from '@/lib/format';
import { monthly, durationBins, purposeTop, eventTop, eventRecords, durationCount, stats, heatmapGrids, PURPOSE_OPTION_CAP, MIN_EVENTS_TO_CHART, MIN_DURATIONS_TO_CHART } from '@/lib/aggregate';
import StatusBadge from '@/components/StatusBadge';
import AgencyInteractive, { type AgencyInitial } from '@/components/AgencyInteractive';

export const dynamicParams = false;
export function generateStaticParams() { return publicAgencies().map(a => ({ agency_id: a.agency_id })); }
export async function generateMetadata({ params }: { params: Promise<{ agency_id: string }> }): Promise<Metadata> {
  const a = getAgency((await params).agency_id); return { title: a ? `${a.display_name} — drone flights` : 'Agency' };
}

const SOURCE: Record<string, { name: string; note: string }> = {
  skydio_arcgis: { name: 'Skydio transparency dashboard', note: 'Skydio aircraft only' },
  sfpd_datasf: { name: 'City open-data portal', note: 'the whole fleet, any manufacturer' },
  flock_aerodome: { name: 'Flock Aerodome community dashboard', note: 'call type and case number per flight' },
  airdata: { name: 'AirData public flight log', note: 'no flight durations published' },
  motorola_cape: { name: 'Motorola CAPE transparency portal', note: 'most portals show only the last 30 to 60 days' },
};

export default async function AgencyPage({ params }: { params: Promise<{ agency_id: string }> }) {
  const { agency_id } = await params;
  const a = getAgency(agency_id); if (!a) notFound();
  const m = loadManifest(); const now = m.run_utc ? new Date(m.run_utc) : new Date();

  // Compute the unfiltered view on the server so the page paints complete on first
  // load. The client component refetches the records for filtering and for the flight
  // table, but the statistics and charts are never blank — a dashboard that flashes a
  // loader before showing its own numbers reads as broken.
  const recs = loadFlights(agency_id);
  const anyTime = recs.some(r => r.takeoff_utc);
  const allPurposes = purposeTop(recs, Infinity);
  const heat = anyTime ? heatmapGrids(recs, a.timezone) : null;
  const initial: AgencyInitial = {
    stats: stats(recs, now),
    monthly: monthly(recs),
    durationBins: durationBins(recs) ?? [],
    purposeAll: purposeTop(recs, 15),
    eventAll: eventTop(recs, 15),
    eventCount: eventRecords(recs).length,
    minEventsToChart: MIN_EVENTS_TO_CHART,
    durationCount: durationCount(recs),
    minDurationsToChart: MIN_DURATIONS_TO_CHART,
    heat,
    anyTime,
    allCount: recs.length,
    purposeOptions: allPurposes.slice(0, PURPOSE_OPTION_CAP).map(b => ({ label: b.label, count: b.value })),
    purposeOptionsHidden: Math.max(0, allPurposes.length - PURPOSE_OPTION_CAP),
    extraKeys: [...new Set(recs.flatMap(r => Object.keys(r.extra ?? {})))]
      .filter(k => recs.some(r => r.extra?.[k] !== null && r.extra?.[k] !== undefined)).sort(),
  };

  return (
    <>
      <div className="agency-head">
        <div>
          <h2 style={{ marginBottom: 4 }}>{a.display_name}{a.state ? `, ${a.state}` : ''}</h2>
          <div className="meta"><StatusBadge status={a.status} /> &nbsp; Data as of {fmtDate(m.run_utc?.slice(0, 10))}.</div>
        </div>
        <a className="btn" href={a.official_url} target="_blank" rel="noopener noreferrer">View official flight log ↗</a>
      </div>

      <div className="sources">
        <span className="sources-label">{a.sources.length > 1 ? 'Published on' : 'Published on'}</span>
        <ul>
          {a.sources.map(s => (
            <li key={s.source + s.source_agency_id}>
              <a href={s.official_url} target="_blank" rel="noopener noreferrer">{SOURCE[s.source]?.name ?? s.source}</a>
              {' — '}{fmtInt(s.flight_count)} flights
              {s.first_flight ? `, ${fmtDate(s.first_flight)} to ${fmtDate(s.last_flight)}` : ''}
              {SOURCE[s.source] ? <span className="small"> ({SOURCE[s.source].note})</span> : null}
            </li>
          ))}
        </ul>
        {a.sources.length > 1 && (
          <p className="small">
            This agency publishes the same programme in more than one place, and the platforms do not
            agree about what a flight is called. Flights that appear on two of them are matched by date
            and takeoff time and counted once
            {a.overlap_count > 0 ? `; ${fmtInt(a.overlap_count)} were published twice` : ''}.
            The figures below are the merged record.
          </p>
        )}
      </div>
      {a.notes && <div className="note">{a.notes}</div>}
      <AgencyInteractive agencyId={agency_id} timezone={a.timezone} nowIso={now.toISOString()} initial={initial} />
    </>
  );
}
