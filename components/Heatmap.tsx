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
 * The cell's colour on a diverging blue-to-red ramp: quiet hours cool, busy hours hot,
 * and the middle of the range left as the page background so nothing shouts in the
 * middle. Below the midpoint the cell mixes toward blue and above it toward red, each
 * at full strength only at the extremes.
 */
function heatStyle(value: number, max: number): React.CSSProperties {
  const t = max > 0 ? value / max : 0;
  const cold = t <= 0.5;
  const strength = Math.round(Math.abs(t - 0.5) * 2 * 100);
  return {
    '--hue': cold ? 'var(--heat-cold)' : 'var(--heat-hot)',
    '--mix': `${strength}%`,
  } as React.CSSProperties;
}

/**
 * A plain CSS-grid heatmap rather than a Recharts chart: 168 discrete, individually
 * addressable cells with their own tooltip/title is a poor fit for an SVG chart library
 * built around continuous scales and series -- a grid gives per-cell accessibility
 * (title + aria-label), guaranteed-square cells via aspect-ratio, and a colour ramp
 * mixed straight from the theme's tokens with zero extra markup.
 */
export default function Heatmap({ title, grid, max, mode, note }: Props) {
  const ramp = [0, 0.25, 0.5, 0.75, 1];
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
                return (
                  <span
                    key={hi}
                    role="cell"
                    tabIndex={0}
                    className={`heatcell${empty ? ' empty' : ''}`}
                    style={empty ? undefined : heatStyle(v, max)}
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
          <span className="lbl">{mode === 'count' ? 'quiet' : 'shortest'}</span>
          {ramp.map(t => <span key={t} className="swatch" style={heatStyle(t * max, max)} />)}
          <span className="lbl">{mode === 'count' ? `busiest — ${max.toLocaleString('en-US')} flights` : `longest — ${fmtMinutes(max)} min (median)`}</span>
        </div>
        {mode === 'duration' && <div className="heatmap-ramp"><span className="swatch empty" /><span className="lbl">No flights</span></div>}
      </div>
      {note && <div className="small">{note}</div>}
    </div>
  );
}
