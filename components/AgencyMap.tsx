'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
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
};

/**
 * A dot per agency, sized by how many flights it has published.
 *
 * Everything geographic was decided on the server: this receives finished path
 * strings and placed dots, and adds what needs a browser — zoom, pan, hover,
 * keyboard focus, and following a dot to its agency.
 *
 * Zoom is a transform on the drawing rather than a reprojection, so it costs
 * nothing and stays exact. Strokes and dot radii are divided by the scale as
 * it grows, which keeps hairlines hairline and stops dots swelling into blobs:
 * zooming in separates the agencies stacked over Los Angeles or the Bay Area
 * rather than magnifying one large circle.
 *
 * Dot area, not radius, is proportional to flight count, so the largest
 * programs do not swamp the map by squaring a difference the reader is being
 * shown once already.
 *
 * Colors and the dots' sizes are SVG presentation attributes as well as CSS
 * rules. CSS wins whenever it loads and carries the light and dark themes; the
 * attributes are there because an SVG with no styling at all fills solid black
 * and sizes itself to its container.
 */

const MIN_SCALE = 1;
const MAX_SCALE = 14;
const ZOOM_STEP = 1.6;

export default function AgencyMap({ outlines, dots, offMap, width, height }: Props) {
  const router = useRouter();
  const [hover, setHover] = useState<Dot | null>(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(null);

  const open = (d: Dot) => router.push(`/agency/${d.agency_id}`);

  /** Keep the drawing inside its frame, whatever the scale. */
  const clamp = useCallback((v: { scale: number; x: number; y: number }) => {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale));
    const limitX = (width * (scale - 1)) / scale;
    const limitY = (height * (scale - 1)) / scale;
    return {
      scale,
      x: Math.min(0, Math.max(-limitX, v.x)),
      y: Math.min(0, Math.max(-limitY, v.y)),
    };
  }, [width, height]);

  /** Viewbox coordinates for a pointer position. */
  const atPointer = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: width / 2, y: height / 2 };
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    };
  }, [width, height]);

  /** Zoom about a fixed point, so what is under the cursor stays under it. */
  const zoomAbout = useCallback((factor: number, px: number, py: number) => {
    setView(v => {
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, v.scale * factor));
      if (scale === v.scale) return v;
      const worldX = px / v.scale - v.x;
      const worldY = py / v.scale - v.y;
      return clamp({ scale, x: px / scale - worldX, y: py / scale - worldY });
    });
  }, [clamp]);

  const zoomCenter = (factor: number) => zoomAbout(factor, width / 2, height / 2);
  const reset = () => setView({ scale: 1, x: 0, y: 0 });

  // Wheel zoom is registered by hand because React's onWheel is passive, and a
  // passive listener cannot stop the page scrolling behind the map.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = atPointer(e.clientX, e.clientY);
      zoomAbout(e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, p.x, p.y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAbout, atPointer]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const p = atPointer(e.clientX, e.clientY);
    drag.current = { px: p.x, py: p.y, x: view.x, y: view.y, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = atPointer(e.clientX, e.clientY);
    const dx = (p.x - d.px) / view.scale;
    const dy = (p.y - d.py) / view.scale;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) d.moved = true;
    setView(v => clamp({ ...v, x: d.x + dx, y: d.y + dy }));
  };

  // A drag that moved should not also open whatever it finished on top of, so
  // the flag outlives the click that follows pointerup by one tick.
  const onPointerUp = () => { setTimeout(() => { drag.current = null; }, 0); };

  const zoomed = view.scale > 1;
  const strokeScale = 1 / view.scale;

  return (
    <div className="mapcard">
      <div className="mapwrap">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={`Map of ${dots.length} agencies that publish drone flight logs, each sized by number of published flights`}
          className={zoomed ? 'is-zoomed' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={e => { const p = atPointer(e.clientX, e.clientY); zoomAbout(ZOOM_STEP, p.x, p.y); }}
        >
          <g transform={`scale(${view.scale}) translate(${view.x} ${view.y})`}>
            <g className="map-states">
              {outlines.map(s => (
                <path key={s.name} d={s.d} fill="#e8ecf2" stroke="#b8c1d0" strokeWidth={0.8 * strokeScale} />
              ))}
            </g>
            <g className="map-dots">
              {dots.map(d => (
                <circle
                  key={d.agency_id}
                  cx={d.x}
                  cy={d.y}
                  r={d.r * strokeScale}
                  fill="#0060df"
                  stroke="#ffffff"
                  strokeWidth={1.1 * strokeScale}
                  tabIndex={0}
                  role="link"
                  aria-label={`${d.display_name}${d.state ? `, ${d.state}` : ''} — ${fmtInt(d.flight_count)} published flights`}
                  onMouseEnter={() => setHover(d)}
                  onMouseLeave={() => setHover(h => (h?.agency_id === d.agency_id ? null : h))}
                  onFocus={() => setHover(d)}
                  onBlur={() => setHover(null)}
                  onClick={() => { if (!drag.current?.moved) open(d); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(d); } }}
                />
              ))}
            </g>
          </g>
        </svg>

        <div className="map-zoom">
          <button type="button" onClick={() => zoomCenter(ZOOM_STEP)} disabled={view.scale >= MAX_SCALE} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => zoomCenter(1 / ZOOM_STEP)} disabled={!zoomed} aria-label="Zoom out">−</button>
          <button type="button" onClick={reset} disabled={!zoomed} aria-label="Reset the map">Reset</button>
        </div>

        {hover && (
          <div
            className="map-tip"
            style={{
              left: `${(((hover.x + view.x) * view.scale) / width) * 100}%`,
              top: `${(((hover.y + view.y) * view.scale) / height) * 100}%`,
            }}
          >
            <strong>{hover.display_name}</strong>
            {hover.state ? <span className="map-tip-state">{hover.state}</span> : null}
            <span className="map-tip-n">{fmtInt(hover.flight_count)} flights</span>
          </div>
        )}
      </div>

      <div className="map-foot">
        <div className="small">
          Scroll or double-click to zoom, drag to pan. Each dot is one agency, sized by its published
          flights and placed at the center of the area it flies in, not at any individual flight.
          Click a dot to open that agency.
          {offMap > 0 ? ` ${offMap} ${offMap === 1 ? 'agency is' : 'agencies are'} outside the map and appear only in the full list.` : ''}
        </div>
      </div>
    </div>
  );
}
