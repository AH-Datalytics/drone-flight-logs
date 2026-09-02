import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAgency, publicAgencies, loadManifest } from '@/lib/data';
import { fmtDate } from '@/lib/format';
import StatusBadge from '@/components/StatusBadge';
import AgencyInteractive from '@/components/AgencyInteractive';

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
      <AgencyInteractive agencyId={agency_id} timezone={a.timezone} nowIso={now.toISOString()} />
    </>
  );
}
