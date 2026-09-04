import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { decodeFlightFile, type FlightFile } from '../pipeline/flightfile.js';
import { purposeTop } from '../lib/aggregate.js';

/**
 * The dashboards nobody has identified yet, as one CSV to work through.
 *
 * Skydio discovery finds dashboards by enumerating the vendor's index, which
 * gives a title but not always an agency. Some titles are plainly an agency,
 * some are a business unit, and some are an internal test org. Anything not
 * confidently matched is marked needs_review and excluded from the site
 * entirely, so this backlog is agencies the site is missing.
 *
 * Each row carries what a person needs to make the call quickly: the title as
 * published, a link to the live dashboard, how much data sits behind it, and
 * the purposes the flights state — a utility inspecting power lines reads very
 * differently from a police department answering calls.
 *
 * To resolve one: set display_name, state and org_type in data/registry.json
 * and change status from needs_review to ok.
 *
 * Regenerate with: npx tsx scripts/unnamed-csv.ts
 */

type Agency = {
  agency_id: string;
  display_name: string;
  state: string | null;
  org_type: string;
  official_url: string;
  status: string;
  flight_count: number;
  first_flight: string | null;
  last_flight: string | null;
  source_config: { orgs?: { org_uuid: string; dashboard_item_id: string; title: string }[] };
};

const registry = JSON.parse(readFileSync(join('data', 'registry.json'), 'utf8')) as { agencies: Agency[] };
const unnamed = registry.agencies.filter(a => a.status === 'needs_review');

const q = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

const rows = unnamed.map(a => {
  const org = a.source_config.orgs?.[0];
  const p = join('data', 'flights', `${a.agency_id}.json`);
  const recs = existsSync(p) ? decodeFlightFile(JSON.parse(readFileSync(p, 'utf8')) as FlightFile) : [];

  // The stated purposes are usually the giveaway: "Call for Service" is a
  // police department, "Distribution Line Patrol" is a utility.
  const purposes = purposeTop(recs, 5)
    .filter(b => !/^Other \(/.test(b.label))
    .map(b => `${b.label} (${b.value})`)
    .join(' | ');

  const places = [...new Set(recs.map(r => r.description).filter(Boolean))].slice(0, 3).join(' | ');

  return {
    dashboard_title: org?.title ?? a.display_name,
    current_guess: a.display_name,
    guessed_type: a.org_type,
    flights: a.flight_count,
    first_flight: a.first_flight ?? '',
    last_flight: a.last_flight ?? '',
    stated_purposes: purposes,
    sample_locations: places,
    dashboard_url: a.official_url,
    agency_id: a.agency_id,
  };
});

rows.sort((a, b) => b.flights - a.flights);

const headers = Object.keys(rows[0] ?? {});
const csv = [headers.join(','), ...rows.map(r => headers.map(h => q((r as Record<string, unknown>)[h])).join(','))];

mkdirSync(join('research', 'census'), { recursive: true });
const out = join('research', 'census', 'unnamed-dashboards.csv');
writeFileSync(out, csv.join('\r\n') + '\r\n');

const withFlights = rows.filter(r => r.flights > 0).length;
console.log(`${out}: ${rows.length} unnamed dashboards, ${withFlights} with published flights`);
console.log(`total flights behind them: ${rows.reduce((t, r) => t + r.flights, 0).toLocaleString('en-US')}`);
