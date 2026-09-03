import AgencyTable from '@/components/AgencyTable';
import StatRow from '@/components/StatRow';
import { publicAgencies, loadManifest, loadFlights } from '@/lib/data';
import { daysSince, fmtInt, fmtHours, fmtDate } from '@/lib/format';
import { medianPublishGapDays } from '@/lib/aggregate';
import type { Row } from '@/lib/table';

export default function Home() {
  const m = loadManifest();
  const now = m.run_utc ? new Date(m.run_utc) : new Date();
  const rows: Row[] = publicAgencies().map(a => ({
    agency_id: a.agency_id, display_name: a.display_name, state: a.state, org_type: a.org_type, flight_count: a.flight_count, total_hours: a.total_hours,
    first_flight: a.first_flight, last_flight: a.last_flight, status: a.status, days_since_last: daysSince(a.last_flight, now),
    median_gap_days: medianPublishGapDays(loadFlights(a.agency_id)),
  }));

  const totalFlights = rows.reduce((sum, r) => sum + r.flight_count, 0);
  const totalHours = rows.reduce((sum, r) => sum + r.total_hours, 0);
  const recentAgencies = rows.filter(r => r.days_since_last !== null && r.days_since_last <= 30).length;
  const stats = [
    { label: 'Agencies', value: fmtInt(rows.length) },
    { label: 'Distinct flights', value: fmtInt(totalFlights) },
    { label: 'Flight hours', value: fmtHours(totalHours) },
    { label: 'Flew in last 30 days', value: fmtInt(recentAgencies) },
    { label: 'Data as of', value: m.run_utc ? fmtDate(m.run_utc.slice(0, 10)) : '—' },
  ];

  return (
    <>
      <h2>How law enforcement uses drones</h2>
      <p className="lede">
        A few hundred police and public-safety agencies publish a log of their drone flights, scattered
        across five different vendors&rsquo; dashboards. This site gathers them so you can look up one
        agency and see the shape of its programme: how often it flies, for how long, at what hours of
        which days, and for what stated reason. It is a periodic snapshot rather than a live feed, and
        every count is a floor, because agencies publish only the flights they choose to.
      </p>
      <StatRow items={stats} />
      <AgencyTable rows={rows} />
    </>
  );
}
