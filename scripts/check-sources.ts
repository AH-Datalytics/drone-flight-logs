import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Fails the run if any source is quietly broken.
 *
 * The collectors isolate failures per agency and exit zero on purpose: one
 * dashboard behind a new challenge should not cost the other hundred. That
 * makes a run look green while a source has stopped working, so this reads
 * back what each collector recorded and turns it into an exit code.
 *
 * It also reports any AirData month that came up short of the count the portal
 * itself published — the one source that states how many flights it has, and
 * therefore the one place a silent truncation is detectable.
 */

type RawState = { agencies: Record<string, { last_error?: string | null; slug?: string; months?: Record<string, { published: number; collected: number; complete: boolean }> }> };

const read = <T,>(p: string): T | null => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) as T : null);

const errors: string[] = [];
const short: string[] = [];

for (const source of ['flock', 'airdata', 'cape'] as const) {
  const state = read<RawState>(join('data', 'raw', source, '_state.json'));
  if (!state) continue;
  for (const [id, agency] of Object.entries(state.agencies)) {
    if (agency.last_error) errors.push(`${source}/${id}: ${agency.last_error}`);
    // Only AirData states how many flights each month holds; Flock's month
    // records track pages fetched and carry no published count to compare to.
    if (source !== 'airdata') continue;
    for (const [month, m] of Object.entries(agency.months ?? {})) {
      if (!m.complete) short.push(`${id} ${month}: collected ${m.collected} of ${m.published} published`);
    }
  }
}

const manifest = read<{ discovery_error?: string | null }>(join('data', 'manifest.json'));
if (manifest?.discovery_error) errors.push(`skydio discovery: ${manifest.discovery_error}`);

if (short.length) {
  console.log(`Months short of the count the portal published (${short.length}):`);
  for (const s of short) console.log(`  ${s}`);
} else {
  console.log('Every AirData month matched the count its portal published.');
}

if (errors.length) {
  console.error(`\nSources reporting an error (${errors.length}):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}

console.log('Every source reported clean.');
