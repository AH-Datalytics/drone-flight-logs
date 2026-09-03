import { publicAgencies } from '@/lib/data';
import { fmtInt } from '@/lib/format';

export const metadata = { title: 'About the data' };

export default function About() {
  const served = publicAgencies();
  const bySource = (s: string) => served.filter(a => a.sources.some(x => x.source === s)).length;

  return (
    <>
      <h2>About the data</h2>
      <p className="lede">
        This site republishes drone flight logs that police and public-safety agencies have already
        made public. It does not change them, and it does not obtain anything that was not already
        published.
      </p>

      <h3>Where it comes from</h3>
      <p>
        There is no national register of police drone flights and no law requiring one. What exists is
        a scattering of dashboards, each run by a different vendor, each publishing a different subset
        of a different set of fields. This site gathers data from multiple sources though it is not
        inherently an authoritative collection of data on all law enforcement drone flights.
      </p>
      <p>
        <strong>Skydio transparency dashboards — {bySource('skydio_arcgis')} agencies.</strong> Agencies
        that fly Skydio drones can publish selected flights to a public dashboard. Skydio hosts those
        dashboards as a public map service and this site reads those dashboards directly. Only flights
        on Skydio aircraft appear there, so an agency that also flies other manufacturers&rsquo; drones
        may not have all data represented here.
      </p>
      <p>
        <strong>Flock Aerodome community dashboards — {bySource('flock_aerodome')} agencies.</strong> These
        carry the most detail of any source: the type of call, the agency&rsquo;s own case number, the
        priority assigned to it, and a block-level address.
      </p>
      <p>
        <strong>Motorola CAPE transparency portals — {bySource('motorola_cape')} agencies.</strong> Each
        agency chooses how much history to expose. Three agencies publish everything while the rest
        publish only the last thirty or sixty days. The site holds flight data the original portal can
        no longer show for those agencies.
      </p>
      <p>
        <strong>AirData public flight logs — {bySource('airdata')} agencies.</strong> The oldest records
        collected here reaching back to 2019 for Sacramento and 2021 for Chula Vista. AirData publishes
        no flight duration time, so those agencies have flight counts but no hours.
      </p>
      <p>
        <strong>San Francisco Police Department open data — {bySource('sfpd_datasf')} agency.</strong> SFPD
        publishes open data regarding its drone program. SFPD&rsquo;s log covers its whole fleet regardless
        of manufacturer. It records a date but no time of day so its page has no hour-of-day view.
      </p>

      <h3>What is not here</h3>
      <ul>
        <li>
          Agencies decide which flights to publish. It is unclear whether all flights are being reported
          for any specific agency.
        </li>
        <li>
          Several sources publish the full track of every flight as a list of coordinates though no
          flight paths are stored here. Each agency&rsquo;s page links to that agency&rsquo;s own official
          map &ndash; where available.
        </li>
        <li>
          Stated purposes appear exactly as the agency recorded them. Agencies use different
          vocabularies — some write a statute citation, some an incident type, some nothing at all — so
          purposes may not be comparable between agencies.
        </li>
        <li>
          There are no national totals or national trends. Aggregate counts across agencies mostly
          reflect when each agency started publishing rather than how much anyone flies, so a rising
          national line would say more about dashboard adoption than about drones.
        </li>
      </ul>

      <h3>The map</h3>
      <p>
        The dot for each agency is a single coarse point — where the department operates, not where any
        drone went. For agencies on Skydio it is the center of the extent that agency&rsquo;s own dashboard
        publishes. For the rest it is the municipality, looked up once through OpenStreetMap&rsquo;s Nominatim
        service and then cached, so nothing is geocoded twice. Map data{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">&copy; OpenStreetMap contributors</a>,
        available under the Open Database License. State outlines come from the US Census Bureau via{' '}
        <a href="https://github.com/topojson/us-atlas" target="_blank" rel="noopener noreferrer">us-atlas</a>.
      </p>

      <h3>Refreshing and corrections</h3>
      <p>
        This is a monthly snapshot, not a live feed. The date above is when the data was last collected,
        and each collection is committed to a public repository, so any past version can be
        reconstructed. Just because an agency&rsquo;s drone data has not been updated in days, weeks, or
        months does not inherently mean there have been no drone flights over that time.
      </p>
      <p>
        How a refresh behaves depends on the source. Skydio and San Francisco are re-read in full each
        time, so a flight an agency later removes disappears here too. Flock and Motorola publish only a
        recent window, so those are additive: once a flight has been collected it is kept, even after the
        original portal stops showing it.
      </p>
    </>
  );
}
