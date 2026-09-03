import Link from 'next/link';
import StatRow from '@/components/StatRow';
import AgencyMap from '@/components/AgencyMap';
import AgencySearch, { type SearchItem } from '@/components/AgencySearch';
import { publicAgencies, loadManifest } from '@/lib/data';
import { stateOutlines, agencyDots, radiusFor, MAP_W, MAP_H } from '@/lib/map';
import { fmtInt, fmtHours, fmtDate } from '@/lib/format';

export default function Home() {
  const m = loadManifest();
  const agencies = publicAgencies();

  // Projected on the server: the browser gets path strings and dot positions,
  // never the outline coordinates or the projection library.
  const outlines = stateOutlines();
  const { dots, offMap, maxFlights } = agencyDots(agencies);
  const legend = [maxFlights, Math.round(maxFlights / 10), Math.round(maxFlights / 100)]
    .filter(n => n >= 1)
    .map(n => ({ flights: n, r: radiusFor(n, maxFlights) }));

  const items: SearchItem[] = agencies
    .map(a => ({ agency_id: a.agency_id, display_name: a.display_name, state: a.state, flight_count: a.flight_count }))
    .sort((a, b) => b.flight_count - a.flight_count);

  const totalFlights = agencies.reduce((t, a) => t + a.flight_count, 0);
  const totalHours = agencies.reduce((t, a) => t + a.total_hours, 0);
  const states = new Set(agencies.map(a => a.state).filter(Boolean)).size;

  return (
    <>
      <h2>How law enforcement uses drones</h2>
      <p className="lede">
        A few hundred police and public-safety agencies publish a log of their drone flights,
        scattered across five different vendors&rsquo; dashboards. This site gathers them so you can
        look up one agency and see the shape of its programme: how often it flies, for how long, at
        what hours of which days, and for what stated reason. It is a periodic snapshot rather than a
        live feed, and every count is a floor, because agencies publish only the flights they choose to.
      </p>

      <StatRow items={[
        { label: 'Agencies', value: fmtInt(agencies.length) },
        { label: 'States', value: fmtInt(states) },
        { label: 'Distinct flights', value: fmtInt(totalFlights) },
        { label: 'Flight hours', value: fmtHours(totalHours) },
        { label: 'Collected', value: m.run_utc ? fmtDate(m.run_utc.slice(0, 10)) : '—' },
      ]} />

      <AgencySearch items={items} />
      <AgencyMap
        outlines={outlines}
        dots={dots}
        offMap={offMap}
        maxFlights={maxFlights}
        width={MAP_W}
        height={MAP_H}
        legend={legend}
      />

      <div className="see-all">
        <Link className="btn" href="/agencies">See all {fmtInt(agencies.length)} agencies →</Link>
        <span className="small">Sortable and searchable, with first and last flight, hours, and publishing cadence.</span>
      </div>
    </>
  );
}
