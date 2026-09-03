import { WEEKDAYS } from '@/lib/aggregate';

type Props = {
  title: string;
  /** 7 (Mon..Sun) x 24 (0..23) grid of flight counts. */
  grid: number[][];
  max: number;
  note?: string;
};

const HOUR_STEP = 3;

function hourLabel(h: number): string { return String(h).padStart(2, '0'); }

function cellTitle(weekday: string, hour: number, v: number): string {
  const when = `${weekday} ${hourLabel(hour)}:00–${hourLabel((hour + 1) % 24)}:00`;
  return v === 0 ? `${when} — no published flights` : `${when} — ${v.toLocaleString('en-US')} flight${v === 1 ? '' : 's'}`;
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
export default function Heatmap({ title, grid, max, note }: Props) {
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
              {grid[ri].map((v, hi) => (
                <span
                  key={hi}
                  role="cell"
                  tabIndex={0}
                  className="heatcell"
                  style={heatStyle(v, max)}
                  title={cellTitle(wd, hi, v)}
                  aria-label={cellTitle(wd, hi, v)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-legend">
        <div className="heatmap-ramp">
          <span className="lbl">quiet</span>
          {ramp.map(t => <span key={t} className="swatch" style={heatStyle(t * max, max)} />)}
          <span className="lbl">busiest — {max.toLocaleString('en-US')} flights</span>
        </div>
      </div>
      {note && <div className="small">{note}</div>}
    </div>
  );
}
