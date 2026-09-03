import { publicAgencies, loadManifest, loadSite, suppressedAgencies, collectedAgencies } from '@/lib/data';
import { fmtDate, fmtInt } from '@/lib/format';
import StatRow from '@/components/StatRow';

export const metadata = { title: 'About the data — Police Drone Flight Logs' };

export default function About() {
  const m = loadManifest();
  const served = publicAgencies();
  const site = loadSite();
  const hidden = suppressedAgencies();
  const bySource = (s: string) => served.filter(a => a.sources.some(x => x.source === s)).length;
  const flightsFrom = (s: string) => site.by_source[s] ?? 0;
  const byStatus = (s: string) => served.filter(a => a.status === s).length;
  const multi = served.filter(a => a.sources.length > 1);
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
        There is no national register of police drone flights, and no law requiring one. What exists is
        a scattering of dashboards, each run by a different vendor, each publishing a different subset
        of a different set of fields. Finding them is most of the work. This site reads five kinds of
        source, and treats each one&rsquo;s limits as part of the record rather than smoothing them away.
      </p>
      <p>
        <strong>Skydio transparency dashboards — {bySource('skydio_arcgis')} agencies, {fmtInt(flightsFrom('skydio_arcgis'))} flights.</strong> Agencies
        that fly Skydio drones can publish selected flights to a public dashboard. Skydio hosts every
        one of those dashboards as a public map service, and this site reads those services directly.
        Only flights on Skydio aircraft appear there, so an agency that also flies other manufacturers&rsquo;
        drones will look smaller here than it actually is.
      </p>
      <p>
        <strong>Flock Aerodome community dashboards — {bySource('flock_aerodome')} agencies, {fmtInt(flightsFrom('flock_aerodome'))} flights.</strong> These
        carry the most detail of any source: the type of call, the agency&rsquo;s own case number, the
        priority assigned to it, and a block-level address. Each dashboard shows about a month at a
        time by default, and there is no index of them anywhere — the ones here were found by
        searching public certificate records for the hostnames the vendor issues.
      </p>
      <p>
        <strong>Motorola CAPE transparency portals — {bySource('motorola_cape')} agencies, {fmtInt(flightsFrom('motorola_cape'))} flights.</strong> Each
        agency chooses how much history to expose. Two publish everything; most publish only the last
        thirty or sixty days, after which a flight disappears from the source permanently. For those
        agencies this site holds flights the original portal can no longer show.
      </p>
      <p>
        <strong>AirData public flight logs — {bySource('airdata')} agencies, {fmtInt(flightsFrom('airdata'))} flights.</strong> The
        oldest records collected here, reaching back to 2019 for Sacramento and 2021 for Chula Vista.
        AirData publishes no flight duration at all, so those agencies have flight counts but no hours.
      </p>
      <p>
        <strong>San Francisco Police Department — {bySource('sfpd_datasf')} agency, {fmtInt(flightsFrom('sfpd_datasf'))} flights.</strong> SFPD does not
        publish through a vendor. Under the city&rsquo;s surveillance-technology ordinance it publishes its
        own flight log to San Francisco&rsquo;s open-data portal, and that log covers its whole fleet
        regardless of manufacturer. It records a date but no time of day, so its page has no
        hour-of-day view. That is a property of the source, not a defect in the records.
      </p>

      <h3>Counting</h3>
      <p>
        Every figure here counts <strong>distinct flights</strong>, never rows of data. That distinction
        matters more than it sounds: several of the published map services contain duplicate rows —
        the same flight, with the same takeoff time, landing time and stated purpose, published two or
        three times over. Cincinnati&rsquo;s service holds 30,071 rows for 17,938 real flights. Counting
        rows would overstate the total on this site by roughly fifteen percent.
      </p>
      {multi.length > 0 && (
        <p>
          <strong>{multi.length} agencies publish the same programme in more than one place.</strong> The
          platforms do not agree about what a flight is called, so a shared flight is recognised by what
          it describes: the same case number on the same day, or takeoff times within five minutes of
          each other. Where two platforms describe one flight, the fuller account is kept and the flight
          is counted once
          {site.overlap_count > 0 ? `. ${fmtInt(site.overlap_count)} flights across the site were published twice` : ''}.
          Each agency page lists the platforms it draws on.
        </p>
      )}

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
          <strong>{hidden.length} agencies are collected but not shown</strong>, because their published
          record is too thin to describe a drone programme: flights on fewer than three separate days,
          or a record that is entirely testing and training. Together they account for{' '}
          {fmtInt(hidden.reduce((t, h) => t + (h.agency.flight_count || 0), 0))} flights, about a tenth
          of one percent of the data.
          {' '}This matters more than the numbers suggest. A department that opened a dashboard, posted
          three test flights and never returned to it is not a department that has flown three times.
          Showing that number would not be a small error; it would be a false impression, and a caveat
          elsewhere on this page would not repair it. Where such an agency turns out to publish properly
          on another platform, the merge above finds it and the real record appears instead.
        </li>
        <li>
          Dashboards whose owner could not be identified are not shown, and a set belonging to the
          vendors themselves — internal test orgs, employee sandboxes and template dashboards — is
          excluded deliberately and counted nowhere on this site.
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
