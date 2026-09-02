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
      <h2>Published police drone flight logs, by agency</h2>
      <p className="lede">Some police and public-safety agencies publish a log of their drone flights. This site collects those logs in one place so you can look up a single agency and see how often it flies, for how long, when, and for what stated reason. Two things to keep in mind: agencies choose which flights to publish, and agencies sourced from Skydio's transparency dashboards show only flights on Skydio aircraft.</p>
      <StatRow items={stats} />
      <AgencyTable rows={rows} />
    </>
  );
}
