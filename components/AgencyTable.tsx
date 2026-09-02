'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { filterAgencies, sortAgencies, type Row } from '@/lib/table';
import { fmtInt, fmtHours, fmtDate } from '@/lib/format';
import StatusBadge from './StatusBadge';

const TYPE: Record<Row['org_type'], string> = { law_enforcement: 'Police / Sheriff', fire_ems: 'Fire / EMS', university: 'University', government_other: 'Government', corporate_utility: 'Corporate / Utility', vendor_partner: 'Vendor' };
// "Days since last published flight" measures publication, not operations -- an agency
// that uploads monthly can show a large number here while still flying every week. The
// "Typical publish gap" column is the honesty companion: it's the median gap between an
// agency's own consecutive published dates, so a reader can tell whether a given gap is
// normal for that agency's publishing cadence or actually notable.
const COLS: { key: keyof Row; label: string; num?: boolean; title?: string }[] = [
  { key: 'display_name', label: 'Agency' }, { key: 'state', label: 'State' }, { key: 'org_type', label: 'Type' },
  { key: 'flight_count', label: 'Flights', num: true }, { key: 'total_hours', label: 'Hours', num: true },
  { key: 'first_flight', label: 'First flight' }, { key: 'last_flight', label: 'Last flight' },
  { key: 'days_since_last', label: 'Days since publish', num: true, title: 'Days since the most recent flight date this agency has published. Not a measure of whether the agency is still flying -- see "Typical gap".' },
  { key: 'median_gap_days', label: 'Typical gap', num: true, title: "Median number of days between this agency's own consecutive published flight dates. Use it to judge whether a long gap since publish is normal for this agency or worth a second look." },
  { key: 'status', label: 'Status' },
];

export default function AgencyTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState(''); const [psOnly, setPsOnly] = useState(true);
  const [key, setKey] = useState<keyof Row>('flight_count'); const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const view = useMemo(() => sortAgencies(filterAgencies(rows, q, psOnly), key, dir), [rows, q, psOnly, key, dir]);
  const click = (k: keyof Row) => { if (k === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setKey(k); setDir(k === 'display_name' || k === 'state' || k === 'org_type' ? 'asc' : 'desc'); } };
  // Bar scale is anchored to the full unfiltered dataset (not the current view) so an
  // agency's bar width stays meaningful as the user searches or toggles the filter.
  // A sqrt scale is used because the distribution is heavily right-skewed (Cincinnati at
  // 17,938 vs a much lower median) -- a linear scale would leave nearly every bar invisible.
  const maxFlights = useMemo(() => Math.max(1, ...rows.map(r => r.flight_count)), [rows]);
  const barPct = (n: number) => Math.round((Math.sqrt(n) / Math.sqrt(maxFlights)) * 100);
  return (
    <>
      <div className="controls">
        <input type="search" placeholder="Search agency, city or state" value={q} onChange={e => setQ(e.target.value)} aria-label="Search agencies" />
        <label><input type="checkbox" checked={psOnly} onChange={e => setPsOnly(e.target.checked)} /> Public-safety agencies only</label>
        <span className="small">{view.length} of {rows.length}</span>
      </div>
      <div className="table-scroll">
      <table className="data agencies">
        <colgroup>
          <col />
          <col style={{ width: '56px' }} />
          <col style={{ width: '140px' }} />
          <col style={{ width: '108px' }} />
          <col style={{ width: '86px' }} />
          <col style={{ width: '98px' }} />
          <col style={{ width: '98px' }} />
          <col style={{ width: '148px' }} />
          <col style={{ width: '100px' }} />
          <col style={{ width: '96px' }} />
        </colgroup>
        <thead><tr>{COLS.map(c => <th key={c.key} className={c.num ? 'num' : ''} title={c.title} onClick={() => click(c.key)}>{c.label}{key === c.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
        <tbody>{view.map(r => (
          <tr key={r.agency_id}>
            <td><Link href={`/agency/${r.agency_id}`}>{r.display_name}</Link></td>
            <td>{r.state ?? ''}</td><td>{TYPE[r.org_type]}</td>
            <td className="num">
              <div className="flight-cell">
                <span>{fmtInt(r.flight_count)}</span>
                <span className="flight-bar" style={{ '--w': `${barPct(r.flight_count)}%` } as React.CSSProperties} />
              </div>
            </td>
            <td className="num">{fmtHours(r.total_hours)}</td>
            <td>{fmtDate(r.first_flight)}</td><td>{fmtDate(r.last_flight)}</td><td className="num">{r.days_since_last ?? '—'}</td>
            <td className="num">{r.median_gap_days ?? '—'}</td>
            <td><StatusBadge status={r.status} /></td>
          </tr>))}</tbody>
      </table>
      </div>
    </>
  );
}
