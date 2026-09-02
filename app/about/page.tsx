import { publicAgencies, loadManifest, loadRegistry } from '@/lib/data';
import { fmtDate, fmtInt } from '@/lib/format';
import StatRow from '@/components/StatRow';

export const metadata = { title: 'About the data — Police Drone Flight Logs' };

export default function About() {
  const m = loadManifest();
  const served = publicAgencies();
  const all = loadRegistry().agencies;
  const bySource = (s: string) => served.filter(a => a.source === s).length;
  const byStatus = (s: string) => served.filter(a => a.status === s).length;
  const flights = served.reduce((t, a) => t + (a.flight_count || 0), 0);
  const hours = served.reduce((t, a) => t + (a.total_hours || 0), 0);
  const firsts = served.map(a => a.first_flight).filter(Boolean).sort() as string[];
  const lasts = served.map(a => a.last_flight).filter(Boolean).sort() as string[];

  return (
    <>
      <h2>About the data</h2>
      <p className="lede">
        This site republishes drone flight logs that police and public-safety agencies have already
        made public. It does not change them, and it does not obtain anything that was not already
        published.
      </p>

      <StatRow items={[
        { label: 'Agencies', value: fmtInt(served.length) },
        { label: 'Distinct flights', value: fmtInt(flights) },
        { label: 'Flight hours', value: fmtInt(Math.round(hours)) },
        { label: 'Earliest flight', value: fmtDate(firsts[0]) },
        { label: 'Latest flight', value: fmtDate(lasts[lasts.length - 1]) },
        { label: 'Data as of', value: fmtDate(m.run_utc?.slice(0, 10)) },
      ]} />

      <h3>Where it comes from</h3>
      <p>
        <strong>Skydio transparency dashboards — {bySource('skydio_arcgis')} agencies.</strong> Agencies
        that fly Skydio drones can publish selected flights to a public dashboard. Skydio hosts every
        one of those dashboards as a public map service, and this site reads those services directly.
        Only flights on Skydio aircraft appear there, so an agency that also flies other manufacturers&rsquo;
        drones will look smaller here than it actually is.
      </p>
      <p>
        <strong>San Francisco Police Department — {bySource('sfpd_datasf')} agency.</strong> SFPD does not
        publish through a vendor. Under the city&rsquo;s surveillance-technology ordinance it publishes its
        own flight log to San Francisco&rsquo;s open-data portal, and that log covers its whole fleet
        regardless of manufacturer. It is therefore the most complete record on this site. It records a
        date but no time of day, so its page has no hour-of-day view and its flights have no local
        time. That is a property of the source, not a defect in the records.
      </p>

      <h3>Counting</h3>
      <p>
        Every figure here counts <strong>distinct flights</strong>, never rows of data. That distinction
        matters more than it sounds: several of the published map services contain duplicate rows —
        the same flight, with the same takeoff time, landing time and stated purpose, published two or
        three times over. Cincinnati&rsquo;s service holds 30,071 rows for 17,938 real flights. Counting
        rows would overstate the total on this site by roughly fifteen percent.
      </p>

      <h3>What is not here</h3>
      <ul>
        <li>Agencies decide which flights to publish. Every count is a floor, not a total.</li>
        <li>
          No flight paths or locations are stored. Each agency page links to that agency&rsquo;s own
          official map, which is the authoritative view of where its drones flew.
        </li>
        <li>
          No pilot names, aircraft serial numbers or dock identifiers, even where a source technically
          exposes those fields.
        </li>
        <li>
          Stated purposes appear exactly as the agency recorded them. Agencies use different
          vocabularies — some write a statute citation, some an incident type, some nothing at all — so
          purposes are not comparable between agencies and this site does not try to make them so.
        </li>
        <li>
          No national totals or national trends. Aggregate counts across agencies mostly reflect when
          each agency started publishing rather than how much anyone flies, so a rising national line
          would say more about dashboard adoption than about drones.
        </li>
        <li>
          {all.length - served.length} further dashboards have been discovered but are not shown, because
          nobody has yet confirmed which agency publishes them. A further set belonging to the vendor
          itself — internal test orgs, employee sandboxes and template dashboards — is excluded
          deliberately and counted nowhere on this site.
        </li>
      </ul>

      <h3>Status labels</h3>
      <ul>
        <li><strong>current</strong> — a flight was published within the last 60 days. {byStatus('ok')} agencies.</li>
        <li>
          <strong>stale</strong> — no flight published in more than 60 days. {byStatus('stale')} agencies.
          Read this alongside the agency&rsquo;s typical publishing gap: a long silence is unremarkable for
          an agency that uploads monthly and notable for one that uploads daily. It may mean the drones
          stopped flying, or only that the publishing stopped.
        </li>
        <li><strong>unreachable</strong> — the last refresh could not read the source, so the previous data is shown.</li>
        <li><strong>retired</strong> — the source dashboard no longer exists; the last data collected is kept.</li>
      </ul>

      <h3>Refreshing and corrections</h3>
      <p>
        Every refresh re-reads each agency in full, so a flight an agency later removes disappears here
        too. Refreshes are currently run by hand rather than on a schedule; the date above is when the
        data was last collected. Each refresh is committed to a public repository, so any past version
        can be reconstructed.
      </p>
      <p className="small">
        Spotted something wrong? The most useful thing you can do is compare a figure here against the
        agency&rsquo;s own official map, linked from its page, and report the discrepancy.
      </p>
    </>
  );
}
