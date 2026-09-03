import 'server-only';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { statesGeo } from '@/pipeline/places';
import type { SiteAgency } from '@/pipeline/build';

/**
 * Project the map on the server and send the browser only what it draws.
 *
 * The state outline is a hundred kilobytes of coordinates and the projection
 * maths is the same for every visitor, so both stay here. The client receives
 * finished path strings and dot positions, which keeps the projection library
 * out of the bundle entirely.
 *
 * Albers with Alaska and Hawaii inset, because a web-mercator United States
 * either loses those two states or wastes half its height on Canada.
 */

export const MAP_W = 960;
export const MAP_H = 560;

export type StateOutline = { name: string; d: string };
export type Dot = {
  agency_id: string;
  display_name: string;
  state: string | null;
  flight_count: number;
  x: number;
  y: number;
  r: number;
};

const MIN_R = 2.5;
const MAX_R = 17;

/** Dot radius from flight count. Area is proportional, so radius goes as the square root. */
export function radiusFor(flights: number, max: number): number {
  if (max <= 0) return MIN_R;
  return MIN_R + (MAX_R - MIN_R) * Math.sqrt(Math.max(0, flights) / max);
}

function projection() {
  return geoAlbersUsa().fitSize([MAP_W, MAP_H], statesGeo());
}

export function stateOutlines(): StateOutline[] {
  const path = geoPath(projection());
  return statesGeo().features
    .map(f => ({ name: f.properties.name, d: path(f) ?? '' }))
    .filter(o => o.d.length > 0);
}

/**
 * Place each agency. Agencies outside the projection's frame — the handful of
 * non-US dashboards in the data — come back as null and are reported rather
 * than silently dropped.
 */
export function agencyDots(agencies: SiteAgency[]): { dots: Dot[]; offMap: number; maxFlights: number } {
  const proj = projection();
  const withPoints = agencies.filter(a => a.lat !== null && a.lon !== null);
  const maxFlights = Math.max(1, ...withPoints.map(a => a.flight_count));

  const dots: Dot[] = [];
  let offMap = agencies.length - withPoints.length;

  for (const a of withPoints) {
    const xy = proj([a.lon!, a.lat!]);
    if (!xy) { offMap++; continue; }
    dots.push({
      agency_id: a.agency_id,
      display_name: a.display_name,
      state: a.state,
      flight_count: a.flight_count,
      x: Math.round(xy[0] * 10) / 10,
      y: Math.round(xy[1] * 10) / 10,
      r: Math.round(radiusFor(a.flight_count, maxFlights) * 10) / 10,
    });
  }

  // Largest first, so a small agency is never buried under a big one.
  dots.sort((a, b) => b.r - a.r);
  return { dots, offMap, maxFlights };
}
