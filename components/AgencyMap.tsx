'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { fmtInt } from '@/lib/format';
import type { Dot, StateOutline } from '@/lib/map';

type Props = {
  outlines: StateOutline[];
  dots: Dot[];
  offMap: number;
  maxFlights: number;
  width: number;
  height: number;
  /** Radii for the legend, computed with the same scale as the dots. */
  legend: { flights: number; r: number }[];
};

/**
 * A dot per agency, sized by how many flights it has published.
 *
 * Everything geographic was decided on the server: this receives finished path
 * strings and placed dots, and adds only what needs a browser — hover, keyboard
 * focus, and following a dot to its agency.
 *
 * Dot area, not radius, is proportional to flight count, so the largest
 * programmes do not swamp the map by squaring a difference the reader is being
 * shown once already.
 */
export default function AgencyMap({ outlines, dots, offMap, width, height, legend }: Props) {
  const router = useRouter();
  const [hover, setHover] = useState<Dot | null>(null);

  const open = (d: Dot) => router.push(`/agency/${d.agency_id}`);

  return (
    <div className="mapcard">
      <div className="mapwrap">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Map of ${dots.length} agencies that publish drone flight logs, each sized by number of published flights`}
        >
          <g className="map-states">
            {outlines.map(s => <path key={s.name} d={s.d} />)}
          </g>
          <g className="map-dots">
            {dots.map(d => (
              <circle
                key={d.agency_id}
                cx={d.x}
                cy={d.y}
                r={d.r}
                tabIndex={0}
                role="link"
                aria-label={`${d.display_name}${d.state ? `, ${d.state}` : ''} — ${fmtInt(d.flight_count)} published flights`}
                onMouseEnter={() => setHover(d)}
                onMouseLeave={() => setHover(h => (h?.agency_id === d.agency_id ? null : h))}
                onFocus={() => setHover(d)}
                onBlur={() => setHover(null)}
                onClick={() => open(d)}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(d); } }}
              />
            ))}
          </g>
        </svg>

        {hover && (
          <div
            className="map-tip"
            style={{ left: `${(hover.x / width) * 100}%`, top: `${(hover.y / height) * 100}%` }}
          >
            <strong>{hover.display_name}</strong>
            {hover.state ? <span className="map-tip-state">{hover.state}</span> : null}
            <span className="map-tip-n">{fmtInt(hover.flight_count)} flights</span>
          </div>
        )}
      </div>

      <div className="map-foot">
        <div className="map-legend" aria-hidden="true">
          {legend.map(l => (
            <span key={l.flights} className="map-legend-item">
              <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r={l.r} /></svg>
              {fmtInt(l.flights)}
            </span>
          ))}
          <span className="small">published flights</span>
        </div>
        <div className="small">
          Each dot is one agency, placed at the centre of the area it flies in, not at any individual
          flight. Click a dot to open that agency.
          {offMap > 0 ? ` ${offMap} ${offMap === 1 ? 'agency is' : 'agencies are'} outside the map and appear only in the full list.` : ''}
        </div>
      </div>
    </div>
  );
}
