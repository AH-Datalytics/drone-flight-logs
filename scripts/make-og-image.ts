import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { geoAlbersUsa, geoPath } from 'd3-geo';
import { statesGeo } from '../pipeline/places.js';

/**
 * Renders the social link card: the map itself, with the headline figures.
 *
 * A card is the only part of this site most people will ever see, so it shows
 * the actual dots rather than a logo on a colour field. It is generated from
 * the real data and written to app/opengraph-image.png, which Next serves as
 * the Open Graph and Twitter image for every page.
 *
 * Re-run after a collection so the numbers on the card do not drift:
 *   npx tsx scripts/make-og-image.ts
 */

const W = 1200, H = 630;
const MAP_W = 960, MAP_H = 560, MIN_R = 2.5, MAX_R = 17;

const site = JSON.parse(readFileSync(join('data', 'site', 'agencies.json'), 'utf8'));
const withPoints = site.agencies.filter((a: any) => a.lat !== null && a.lon !== null);
const maxFlights = Math.max(1, ...withPoints.map((a: any) => a.flight_count));

const projection = geoAlbersUsa().fitSize([MAP_W, MAP_H], statesGeo());
const path = geoPath(projection);
const outlines = statesGeo().features.map(f => path(f) ?? '').filter(Boolean);

const dots = withPoints
  .map((a: any) => {
    const xy = projection([a.lon, a.lat]);
    if (!xy) return null;
    const r = MIN_R + (MAX_R - MIN_R) * Math.sqrt(a.flight_count / maxFlights);
    return { x: xy[0], y: xy[1], r };
  })
  .filter(Boolean)
  .sort((a: any, b: any) => b.r - a.r);

const int = (n: number) => Math.round(n).toLocaleString('en-US');
const flights = site.agencies.reduce((t: number, a: any) => t + a.flight_count, 0);
const states = new Set(site.agencies.map((a: any) => a.state).filter(Boolean)).size;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600&family=IBM+Plex+Sans:wght@600;700&display=swap">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { width: ${W}px; height: ${H}px; background: #ffffff; color: #0d1117;
         font-family: "IBM Plex Sans", sans-serif; overflow: hidden; position: relative; }
  .map { position: absolute; inset: 92px 0 104px; display: flex; align-items: center;
         justify-content: center; overflow: hidden; }
  /* Height-constrained: the band between the two bars is the limit, and the
     map keeps its aspect inside it rather than growing under them. */
  .map svg { height: 100%; width: auto; }
  .bar { position: absolute; left: 0; right: 0; padding: 24px 48px; display: flex;
         align-items: baseline; justify-content: space-between; gap: 24px;
         background: #ffffff; z-index: 2; }
  .top { top: 0; border-bottom: 2px solid #0d1117; }
  .bot { bottom: 0; border-top: 1px solid #e3e6ec; }
  h1 { font-family: "IBM Plex Mono", monospace; font-weight: 600; font-size: 27px;
       letter-spacing: 0.04em; text-transform: uppercase; display: flex; align-items: center; gap: 14px; }
  .mark { width: 17px; height: 17px; background: #0060df; display: inline-block; }
  .kicker { font-family: "IBM Plex Mono", monospace; font-size: 15px; color: #8b93a1;
            letter-spacing: 0.08em; text-transform: uppercase; }
  .figs { display: flex; gap: 46px; }
  .fig { display: flex; flex-direction: column; gap: 4px; }
  .v { font-family: "IBM Plex Mono", monospace; font-weight: 600; font-size: 38px;
       font-variant-numeric: tabular-nums; letter-spacing: -0.02em; line-height: 1; }
  .l { font-family: "IBM Plex Mono", monospace; font-size: 13px; color: #8b93a1;
       letter-spacing: 0.08em; text-transform: uppercase; }
  .say { font-size: 20px; color: #4b5563; max-width: 400px; text-align: right; line-height: 1.35; }
</style></head><body>
  <div class="bar top">
    <h1><span class="mark"></span> Law Enforcement Drone Flight Log</h1>
    <span class="kicker">AH Datalytics</span>
  </div>
  <div class="map">
    <svg viewBox="0 0 ${MAP_W} ${MAP_H}">
      <rect width="${MAP_W}" height="${MAP_H}" fill="#f4f6f9"></rect>
      ${outlines.map(d => `<path d="${d}" fill="#e8ecf2" stroke="#b8c1d0" stroke-width="0.8"></path>`).join('')}
      ${dots.map((d: any) => `<circle cx="${d.x.toFixed(1)}" cy="${d.y.toFixed(1)}" r="${d.r.toFixed(1)}" fill="#0060df" fill-opacity="0.72" stroke="#ffffff" stroke-width="1.1"></circle>`).join('')}
    </svg>
  </div>
  <div class="bar bot">
    <div class="figs">
      <div class="fig"><span class="v">${int(site.agencies.length)}</span><span class="l">Agencies</span></div>
      <div class="fig"><span class="v">${int(states)}</span><span class="l">States</span></div>
      <div class="fig"><span class="v">${int(flights)}</span><span class="l">Reported flights</span></div>
    </div>
    <p class="say">How often police fly drones, when, and for what stated reason.</p>
  </div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
await page.screenshot({ path: join('app', 'opengraph-image.png') });
await browser.close();

const bytes = readFileSync(join('app', 'opengraph-image.png')).length;
writeFileSync(join('app', 'opengraph-image.alt.txt'), 'A map of the United States with a dot for each law-enforcement agency that publishes a drone flight log, sized by how many flights it has published.\n');
console.log(`app/opengraph-image.png — ${W}x${H}, ${Math.round(bytes / 1024)} KB, ${dots.length} dots`);
