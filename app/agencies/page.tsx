import Link from 'next/link';
import AgencyTable from '@/components/AgencyTable';
import { publicAgencies, collectedAt } from '@/lib/data';
import { daysSince, fmtInt } from '@/lib/format';
import type { Row } from '@/lib/table';

export const metadata = { title: 'All agencies' };

export default function AllAgencies() {
  const now = collectedAt();
  const rows: Row[] = publicAgencies().map(a => ({
    agency_id: a.agency_id, display_name: a.display_name, state: a.state, org_type: a.org_type,
    flight_count: a.flight_count, total_hours: a.total_hours,
    first_flight: a.first_flight, last_flight: a.last_flight,
    days_since_last: daysSince(a.last_flight, now),
  }));

  return (
    <>
      <div className="agency-head">
        <div>
          <h2 style={{ marginBottom: 4 }}>All {fmtInt(rows.length)} agencies</h2>
          <div className="meta">Sort any column. Search matches agency name, city or state.</div>
        </div>
        <Link className="btn" href="/">← Back to the map</Link>
      </div>
      <AgencyTable rows={rows} />
    </>
  );
}
