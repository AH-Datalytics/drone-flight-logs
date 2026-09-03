import type { RegistryAgency, OrgType } from '@/pipeline/registry';
export type Row = Pick<RegistryAgency, 'agency_id' | 'display_name' | 'state' | 'org_type' | 'flight_count' | 'total_hours' | 'first_flight' | 'last_flight'> & { days_since_last: number | null };
export const PUBLIC_SAFETY = new Set<OrgType>(['law_enforcement', 'fire_ems', 'university', 'government_other']);

export function filterAgencies(rows: Row[], q: string, publicSafetyOnly: boolean): Row[] {
  const needle = q.trim().toLowerCase();
  return rows.filter(r => (!publicSafetyOnly || PUBLIC_SAFETY.has(r.org_type)) && (!needle || r.display_name.toLowerCase().includes(needle) || (r.state ?? '').toLowerCase() === needle || r.agency_id.includes(needle)));
}

export function sortAgencies(rows: Row[], key: keyof Row, dir: 'asc' | 'desc'): Row[] {
  const s = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key], y = b[key];
    if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1;
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * s;
    return String(x).localeCompare(String(y)) * s;
  });
}
