type Option = { label: string; count: number };

export default function PurposeFilter({ options, total, value, onChange }: { options: Option[]; total: number; value: string; onChange: (v: string) => void }) {
  const active = options.find(o => o.label === value);
  return (
    <div className="filter-bar">
      <label htmlFor="purpose-filter">Filter by stated purpose</label>
      <select id="purpose-filter" value={value} onChange={e => onChange(e.target.value)}>
        <option value="all">All purposes ({total.toLocaleString('en-US')} flights)</option>
        {options.map(o => (
          <option key={o.label} value={o.label}>{o.label} ({o.count.toLocaleString('en-US')})</option>
        ))}
      </select>
      {active && (
        <span className="filter-chip">
          Showing only “{active.label}” — {active.count.toLocaleString('en-US')} of {total.toLocaleString('en-US')} flights
          <button type="button" onClick={() => onChange('all')}>Clear filter</button>
        </span>
      )}
    </div>
  );
}
