import { WEEKDAYS } from '@/lib/aggregate';
import { fmtMinutes } from '@/lib/format';

type Props = {
  title: string;
  /** 7 (Mon..Sun) x 24 (0..23) grid of raw values; null means "no flights in this cell". */
  grid: (number | null)[][];
  max: number;
  mode: 'count' | 'duration';
  note?: string;
};

const HOUR_STEP = 3;

function hourLabel(h: number): string { return String(h).padStart(2, '0'); }

function cellTitle(mode: Props['mode'], weekday: string, hour: number, v: number | null): string {
  const when = `${weekday} ${hourLabel(hour)}:00–${hourLabel((hour + 1) % 24)}:00`;
  if (v === null) return `${when} — no published flights`;
  return mode === 'count'
    ? `${when} — ${v.toLocaleString('en-US')} flight${v === 1 ? '' : 's'}`
    : `${when} — ${fmtMinutes(v)} min median flight length`;
}

/**
 * A plain CSS-grid heatmap rather than a Recharts chart: 168 discrete, individually
 * addressable cells with their own tooltip/title is a poor fit for an SVG chart library
 * built around continuous scales and series -- a grid gives per-cell accessibility
 * (title + aria-label), guaranteed-square cells via aspect-ratio, and a colour ramp
 * mixed straight from the theme's --accent token with zero extra markup.
 */
export default function Heatmap({ title, grid, max, mode, note }: Props) {
  const ramp = [0, 25, 50, 75, 100];
  return (
    <div className="chart">
      <h3>{title}</h3>
      <div className="heatmap-wrap">
        <div className="heatmap-hourlabels" aria-hidden="true">
          <span />
          {Array.from({ length: 24 }, (_, h) => <span key={h}>{h % HOUR_STEP === 0 ? hourLabel(h) : ''}</span>)}
        </div>
        <div role="table" aria-label={title}>
          {WEEKDAYS.map((wd, ri) => (
            <div className="heatmap-row" role="row" key={wd}>
              <span className="heatmap-rowlabel" role="rowheader">{wd}</span>
              {grid[ri].map((v, hi) => {
                const empty = v === null;
                const pct = empty || max <= 0 ? 0 : Math.round((v / max) * 100);
                return (
                  <span
                    key={hi}
                    role="cell"
                    tabIndex={0}
                    className={`heatcell${empty ? ' empty' : ''}`}
                    style={empty ? undefined : ({ '--mix': `${pct}%` } as React.CSSProperties)}
                    title={cellTitle(mode, wd, hi, v)}
                    aria-label={cellTitle(mode, wd, hi, v)}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-legend">
        <div className="heatmap-ramp">
          <span className="lbl">0</span>
          {ramp.map(pct => <span key={pct} className="swatch" style={{ '--mix': `${pct}%` } as React.CSSProperties} />)}
          <span className="lbl">{mode === 'count' ? `${max.toLocaleString('en-US')} flights` : `${fmtMinutes(max)} min (median)`}</span>
        </div>
        {mode === 'duration' && <div className="heatmap-ramp"><span className="swatch empty" /><span className="lbl">No flights</span></div>}
      </div>
      {note && <div className="small">{note}</div>}
    </div>
  );
}
