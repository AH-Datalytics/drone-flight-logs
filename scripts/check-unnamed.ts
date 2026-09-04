import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Notices when a dashboard nobody has named starts publishing.
 *
 * Discovery finds Skydio dashboards by enumerating the vendor's index, which
 * gives a title but not always an agency. Anything not confidently matched is
 * marked needs_review, and the pull skips those — so a dashboard that was
 * empty when it was found stays invisible even after it fills up. Every one of
 * them published nothing when this was written; the point is to catch the day
 * that changes rather than to keep asking a person to check.
 *
 * One row-count request per unnamed dashboard, which is cheap, and it writes
 * what it found to data/unnamed_status.json so a change is visible in the
 * commit rather than only in a log that scrolls away.
 */

type Agency = {
  agency_id: string;
  display_name: string;
  status: string;
  official_url: string;
  source: string;
  source_config: { orgs?: { org_uuid: string; title: string }[] };
};

const SERVICES = 'https://services7.arcgis.com/mnhQTdIYDA7UoY2l/arcgis/rest/services';
const OUT = join('data', 'unnamed_status.json');

async function rowCount(orgUuid: string): Promise<number | null> {
  const url = `${SERVICES}/${orgUuid}-production/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json`;
  try {
    const res = await fetch(url, { headers: { 'user-agent': 'drone-flight-logs (+https://github.com/AH-Datalytics/drone-flight-logs)' } });
    if (!res.ok) return null;
    const j = await res.json() as { count?: number };
    return typeof j.count === 'number' ? j.count : null;
  } catch {
    return null;
  }
}

const registry = JSON.parse(readFileSync(join('data', 'registry.json'), 'utf8')) as { agencies: Agency[] };
const unnamed = registry.agencies.filter(a => a.status === 'needs_review' && a.source === 'skydio_arcgis');

const previous: Record<string, number | null> = existsSync(OUT)
  ? (JSON.parse(readFileSync(OUT, 'utf8')).rows ?? {})
  : {};

const rows: Record<string, number | null> = {};
const started: string[] = [];

for (const a of unnamed) {
  const org = a.source_config.orgs?.[0];
  if (!org) continue;
  const count = await rowCount(org.org_uuid);
  rows[a.agency_id] = count;
  const before = previous[a.agency_id] ?? 0;
  if ((count ?? 0) > 0 && (before ?? 0) === 0) {
    started.push(`${org.title} — ${count} rows — ${a.official_url}`);
  }
  await new Promise(r => setTimeout(r, 250));
}

const publishing = Object.entries(rows).filter(([, n]) => (n ?? 0) > 0);

writeFileSync(OUT, JSON.stringify({
  note: 'Row counts for discovered Skydio dashboards that have not been matched to an agency. The pull skips them, so this is what notices one starting to publish. A non-zero count means it should be named in data/registry.json and its status changed from needs_review to ok.',
  checked_utc: new Date().toISOString(),
  rows,
}, null, 1) + '\n');

console.log(`Checked ${unnamed.length} unnamed dashboards: ${publishing.length} publishing, ${unnamed.length - publishing.length} still empty.`);

if (started.length) {
  console.log('\nThese have started publishing since the last check and should be named:');
  for (const s of started) console.log(`  ${s}`);
  console.log('\nSet display_name, state and org_type in data/registry.json and change status to ok.');
} else if (publishing.length) {
  console.log('Already-publishing dashboards still awaiting a name:');
  for (const [id, n] of publishing) console.log(`  ${id}: ${n} rows`);
}
