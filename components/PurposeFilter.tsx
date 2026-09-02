type Option = { label: string; count: number };

export default function PurposeFilter({ options, hiddenCount, total, value, onChange, disabled }: {
  options: Option[];
  hiddenCount: number;
  total: number;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const active = options.find(o => o.label === value);
  return (
    <div className="filter-bar">
      <label htmlFor="purpose-filter">Filter by stated purpose</label>
      <select id="purpose-filter" value={value} onChange={e => onChange(e.target.value)} disabled={disabled}>
        <option value="all">All purposes ({total.toLocaleString('en-US')} flights)</option>
        {options.map(o => (
          <option key={o.label} value={o.label}>{o.label} ({o.count.toLocaleString('en-US')})</option>
        ))}
      </select>
      {hiddenCount > 0 && (
        <span className="small">
          Showing the {options.length} most-used purposes. {hiddenCount.toLocaleString('en-US')} rarer {hiddenCount === 1 ? 'one is' : 'ones are'} not listed — search for them in the flight table below.
        </span>
      )}
      {active && (
        <span className="filter-chip">
          Showing only “{active.label}” — {active.count.toLocaleString('en-US')} of {total.toLocaleString('en-US')} flights
          <button type="button" onClick={() => onChange('all')}>Clear filter</button>
        </span>
      )}
    </div>
  );
}
