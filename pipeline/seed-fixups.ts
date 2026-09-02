// One-time migration, already run against the committed registry on 2026-09-01.
//
// It merged five agencies that Skydio published as two-or-more separate
// dashboards (Oklahoma City, Brooklyn Park, Oakland County SO, Amarillo,
// Columbus GA) into single registry entries with multiple `source_config`
// entries, hand-set the timezone for four non-US/edge-case agencies the
// automatic ArcGIS-extent seeding could not place, and appended a
// multi-dashboard note to any agency left with more than one Skydio org.
//
// Kept for the record, not for re-use. Re-running it against the current
// registry would be wrong: the merges and timezone fixes it performs are
// idempotent-looking but not guaranteed safe against a registry that has
// since been further edited by hand or by the pipeline, and it has no
// dry-run or undo. There is no `npm run` entry for it on purpose.
import { join } from 'node:path';
import { loadRegistry, saveRegistry, mergeAgencies } from './registry.js';

const p = join(process.cwd(), 'data', 'registry.json');
const reg = loadRegistry(p);
const find = (needle: RegExp) => reg.agencies.filter(a => needle.test(a.display_name)).map(a => a.agency_id);

// Oklahoma City: general + "Docked" dashboards are one agency.
const [okcKeep, ...okcRest] = find(/^Oklahoma City Police Department/);
for (const id of okcRest) mergeAgencies(reg, okcKeep, id);
// Brooklyn Park: main org + dock-trial org.
const bp = find(/^Brooklyn Park/); const bpKeep = bp.find(id => !/trial/.test(id)) ?? bp[0];
for (const id of bp) if (id !== bpKeep) mergeAgencies(reg, bpKeep, id);
// Oakland County Sheriff: two dashboards.
const oc = find(/^Oakland County Sheriff/); for (const id of oc.slice(1)) mergeAgencies(reg, oc[0], id);
// Amarillo: two dashboards.
const am = find(/^Amarillo Police Department/); for (const id of am.slice(1)) mergeAgencies(reg, am[0], id);
// Columbus GA: DFR Day + main.
const cg = find(/^Columbus.*\(GA\)|Columbus GA/); for (const id of cg.slice(1)) mergeAgencies(reg, cg[0], id);

const tz: Record<string, string> = {};
for (const a of reg.agencies) {
  if (/medicine hat/i.test(a.display_name)) tz[a.agency_id] = 'America/Edmonton';
  if (/australian federal/i.test(a.display_name)) tz[a.agency_id] = 'Australia/Sydney';
  if (/newmont lihir/i.test(a.display_name)) tz[a.agency_id] = 'Pacific/Port_Moresby';
  if (/niras emea/i.test(a.display_name)) tz[a.agency_id] = 'Europe/Copenhagen';
}
for (const a of reg.agencies) if (tz[a.agency_id]) { a.timezone = tz[a.agency_id]; a.notes = (a.notes ?? '').replace(/timezone not detected automatically; set manually\.?\s*/, '') || null; }

for (const a of reg.agencies) {
  const n = (a.source_config as any).orgs?.length ?? 1;
  if (n > 1) a.notes = [a.notes, `Combines ${n} Skydio dashboards published by this agency.`].filter(Boolean).join(' ');
}
saveRegistry(p, reg);
console.log('merged; agencies now', reg.agencies.length);
