'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { filterAgencies, sortAgencies, type Row } from '@/lib/table';
import { fmtInt, fmtHours, fmtDate } from '@/lib/format';
import StatusBadge from './StatusBadge';

const TYPE: Record<Row['org_type'], string> = { law_enforcement: 'Police / Sheriff', fire_ems: 'Fire / EMS', university: 'University', government_other: 'Government', corporate_utility: 'Corporate / Utility', vendor_partner: 'Vendor' };
const COLS: { key: keyof Row; label: string; num?: boolean }[] = [
  { key: 'display_name', label: 'Agency' }, { key: 'state', label: 'State' }, { key: 'org_type', label: 'Type' },
  { key: 'flight_count', label: 'Flights', num: true }, { key: 'total_hours', label: 'Hours', num: true },
  { key: 'first_flight', label: 'First flight' }, { key: 'last_flight', label: 'Last flight' }, { key: 'days_since_last', label: 'Days since', num: true }, { key: 'status', label: 'Status' },
];

export default function AgencyTable({ rows }: { rows: Row[] }) {
  const [q, setQ] = useState(''); const [psOnly, setPsOnly] = useState(true);
  const [key, setKey] = useState<keyof Row>('flight_count'); const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const view = useMemo(() => sortAgencies(filterAgencies(rows, q, psOnly), key, dir), [rows, q, psOnly, key, dir]);
  const click = (k: keyof Row) => { if (k === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setKey(k); setDir(k === 'display_name' || k === 'state' || k === 'org_type' ? 'asc' : 'desc'); } };
  return (
    <>
      <div className="controls">
        <input type="search" placeholder="Search agency, city or state" value={q} onChange={e => setQ(e.target.value)} aria-label="Search agencies" />
        <label><input type="checkbox" checked={psOnly} onChange={e => setPsOnly(e.target.checked)} /> Public-safety agencies only</label>
        <span className="small">{view.length} of {rows.length}</span>
      </div>
      <table className="data">
        <thead><tr>{COLS.map(c => <th key={c.key} className={c.num ? 'num' : ''} onClick={() => click(c.key)}>{c.label}{key === c.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
        <tbody>{view.map(r => (
          <tr key={r.agency_id}>
            <td><Link href={`/agency/${r.agency_id}`}>{r.display_name}</Link></td>
            <td>{r.state ?? ''}</td><td>{TYPE[r.org_type]}</td>
            <td className="num">{fmtInt(r.flight_count)}</td><td className="num">{fmtHours(r.total_hours)}</td>
            <td>{fmtDate(r.first_flight)}</td><td>{fmtDate(r.last_flight)}</td><td className="num">{r.days_since_last ?? '—'}</td>
            <td><StatusBadge status={r.status} /></td>
          </tr>))}</tbody>
      </table>
    </>
  );
}
