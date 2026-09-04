import { WEEKDAYS } from '@/lib/aggregate';

type Props = {
  title: string;
  /**
   * 7 (Mon..Sun) x 24 (0..23) grid. A null cell has nothing to say — no flights
   * at that hour, or none with a recorded duration — and is drawn as absent
   * rather than as a zero.
   */
  grid: (number | null)[][];
  max: number;
  /**
   * The bottom of the scale. Counts start at zero, because an hour really can
   * have no flights. Average durations do not: they cluster in a narrow band
   * well above zero, so anchoring their ramp at zero puts nearly every cell
   * above the midpoint and paints the whole table red. Passing the observed
   * minimum makes the diverging scale say what it is meant to — shorter than
   * usual against longer than usual.
   */
  min?: number;
  mode?: 'count' | 'duration';
  note?: string;
};

const HOUR_STEP = 3;

function hourLabel(h: number): string { return String(h).padStart(2, '0'); }

function cellTitle(weekday: string, hour: number, v: number | null, mode: 'count' | 'duration'): string {
  const when = `${weekday} ${hourLabel(hour)}:00–${hourLabel((hour + 1) % 24)}:00`;
  if (mode === 'duration') {
    return v === null ? `${when} — no flight with a recorded length` : `${when} — ${v} min on average`;
  }
  return v === 0 ? `${when} — no published flights` : `${when} — ${(v ?? 0).toLocaleString('en-US')} flight${v === 1 ? '' : 's'}`;
}

/**
 * The cell's color on a diverging blue-to-red ramp: quiet hours cool, busy hours hot,
 * and the middle of the range left as the page background so nothing shouts in the
 * middle. Below the midpoint the cell mixes toward blue and above it toward red, each
 * at full strength only at the extremes.
 */
function heatStyle(value: number, max: number, min = 0): React.CSSProperties {
  const span = max - min;
  const t = span > 0 ? (value - min) / span : 0.5;
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
 * (title + aria-label), guaranteed-square cells via aspect-ratio, and a color ramp
 * mixed straight from the theme's tokens with zero extra markup.
 */
export default function Heatmap({ title, grid, max, min = 0, mode = 'count', note }: Props) {
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
                  className={`heatcell${v === null ? ' empty' : ''}`}
                  style={v === null ? undefined : heatStyle(v, max, min)}
                  title={cellTitle(wd, hi, v, mode)}
                  aria-label={cellTitle(wd, hi, v, mode)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="heatmap-legend">
        <div className="heatmap-ramp">
          <span className="lbl">
            {mode === 'duration' ? `Shortest — ${Math.round(min * 10) / 10} min` : 'Quiet'}
          </span>
          {ramp.map(t => <span key={t} className="swatch" style={heatStyle(min + t * (max - min), max, min)} />)}
          <span className="lbl">
            {mode === 'duration' ? `Longest — ${Math.round(max * 10) / 10} min` : `Busiest — ${max.toLocaleString('en-US')} flights`}
          </span>
        </div>
        {mode === 'duration' && (
          <div className="heatmap-ramp">
            <span className="swatch empty" />
            <span className="lbl">No flight with a recorded length</span>
          </div>
        )}
      </div>
      {note && <div className="small">{note}</div>}
    </div>
  );
}
