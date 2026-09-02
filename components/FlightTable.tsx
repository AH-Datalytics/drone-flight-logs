'use client';
import { useEffect, useMemo, useState } from 'react';
import { decodeFlightFile, type FlightFile } from '@/pipeline/flightfile';
import type { FlightRecord } from '@/pipeline/schema';
import { fmtDate, fmtMinutes } from '@/lib/format';

type Key = 'flight_date_local' | 'time' | 'duration_min' | 'purpose' | 'case_number' | 'description' | `extra.${string}`;
const PAGE = 50;

function localTime(utc: string | null, tz: string): string {
  if (!utc) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(utc));
}
function cell(r: FlightRecord, k: Key, tz: string): string | number | null {
  if (k === 'time') return r.takeoff_utc ? localTime(r.takeoff_utc, tz) : null;
  if (k.startsWith('extra.')) { const v = r.extra?.[k.slice(6)]; return v === undefined ? null : v; }
  return (r as any)[k] ?? null;
}

export default function FlightTable({ agencyId, timezone, hasTimes, extraKeys }: { agencyId: string; timezone: string; hasTimes: boolean; extraKeys: string[] }) {
  const [recs, setRecs] = useState<FlightRecord[] | null>(null); const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(''); const [key, setKey] = useState<Key>('flight_date_local'); const [dir, setDir] = useState<'asc' | 'desc'>('desc'); const [page, setPage] = useState(0);
  useEffect(() => { fetch(`/data/flights/${agencyId}.json`).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then((f: FlightFile) => setRecs(decodeFlightFile(f))).catch(e => setErr(String(e))); }, [agencyId]);

  const cols: { key: Key; label: string; num?: boolean }[] = [
    { key: 'flight_date_local', label: 'Date' }, ...(hasTimes ? [{ key: 'time' as Key, label: 'Local time' }] : []),
    { key: 'duration_min', label: 'Minutes', num: true }, { key: 'purpose', label: 'Stated purpose' }, { key: 'case_number', label: 'Case / item #' }, { key: 'description', label: 'Description' },
    ...extraKeys.map(k => ({ key: `extra.${k}` as Key, label: k.replace(/_/g, ' ') })),
  ];

  const view = useMemo(() => {
    if (!recs) return [];
    const needle = q.trim().toLowerCase();
    const filtered = needle ? recs.filter(r => cols.some(c => String(cell(r, c.key, timezone) ?? '').toLowerCase().includes(needle))) : recs;
    const s = dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => { const x = cell(a, key, timezone), y = cell(b, key, timezone); if (x === null) return 1; if (y === null) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * s; });
  }, [recs, q, key, dir, timezone]);

  if (err) return <div className="note">Could not load flights: {err}</div>;
  if (!recs) return <div className="small">Loading flights…</div>;
  const pages = Math.max(1, Math.ceil(view.length / PAGE)); const p = Math.min(page, pages - 1);
  const click = (k: Key) => { if (k === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setKey(k); setDir(k === 'duration_min' || k === 'flight_date_local' ? 'desc' : 'asc'); } setPage(0); };
  return (
    <>
      <div className="controls">
        <input type="search" placeholder="Search purpose, case number, description…" value={q} onChange={e => { setQ(e.target.value); setPage(0); }} aria-label="Search flights" />
        <span className="small">{view.length.toLocaleString('en-US')} of {recs.length.toLocaleString('en-US')} flights</span>
        <a className="btn" href={`/data/csv/${agencyId}.csv`} download>Download CSV</a>
      </div>
      <table className="data">
        <thead><tr>{cols.map(c => <th key={c.key} className={c.num ? 'num' : ''} onClick={() => click(c.key)}>{c.label}{key === c.key ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>)}</tr></thead>
        <tbody>{view.slice(p * PAGE, (p + 1) * PAGE).map(r => (
          <tr key={r.source_flight_id}>{cols.map(c => { const v = cell(r, c.key, timezone); return <td key={c.key} className={c.num ? 'num' : ''}>{c.key === 'flight_date_local' ? fmtDate(v as string) : c.key === 'duration_min' ? fmtMinutes(v as number) : (v ?? '')}</td>; })}</tr>))}</tbody>
      </table>
      <div className="pager"><button onClick={() => setPage(p - 1)} disabled={p === 0}>Previous</button><span>Page {p + 1} of {pages}</span><button onClick={() => setPage(p + 1)} disabled={p >= pages - 1}>Next</button></div>
    </>
  );
}
