import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The monthly refresh: every source, then the merge, then the site's files.
 *
 * This site is a snapshot taken on a schedule, not a live feed, and the whole
 * point of running it monthly rather than never is that two of the five sources
 * forget. Flock shows about a month at a time and Motorola's portals mostly
 * show thirty or sixty days, so a month that passes without a run is a month
 * those agencies lose for good.
 *
 * Steps run in sequence and a failure in one does not stop the rest — a Flock
 * dashboard that has gone behind a harder challenge should not cost you the
 * Skydio refresh. What failed is reported at the end and the exit code says so,
 * so a scheduled run is not silently half-finished.
 */

export type Step = { name: string; args: string[]; note: string };

export const STEPS: Step[] = [
  { name: 'skydio + sfpd', args: ['pipeline/pull.ts'], note: 're-read in full' },
  { name: 'flock', args: ['pipeline/flock/collect.ts', '--concurrency', '4'], note: 'additive; the source keeps about a month' },
  { name: 'airdata', args: ['pipeline/airdata/collect.ts'], note: 'count-verified against each month the portal publishes' },
  { name: 'motorola cape', args: ['pipeline/cape/collect.ts'], note: 'additive; most portals keep 30 to 60 days' },
  { name: 'merge', args: ['pipeline/build.ts'], note: 'one agency per department, shared flights counted once' },
  { name: 'site files', args: ['scripts/prebuild.ts'], note: 'per-agency JSON and CSV for the site' },
];

export function main(): number {
  const started = new Date();
  mkdirSync('data', { recursive: true });
  const logPath = join('data', 'refresh.log');
  const say = (m: string) => { console.log(m); appendFileSync(logPath, m + '\n'); };

  say(`\n=== refresh started ${started.toISOString()} ===`);
  const failed: string[] = [];

  for (const step of STEPS) {
    const at = new Date();
    say(`\n--- ${step.name} (${step.note}) ---`);
    const res = spawnSync('npx', ['tsx', ...step.args], { stdio: 'inherit', shell: process.platform === 'win32' });
    const mins = Math.round((Date.now() - at.getTime()) / 60000);
    if (res.status === 0) {
      say(`--- ${step.name}: done in ${mins} min ---`);
    } else {
      failed.push(step.name);
      say(`--- ${step.name}: FAILED (exit ${res.status}) after ${mins} min ---`);
    }
  }

  const totalMins = Math.round((Date.now() - started.getTime()) / 60000);
  if (failed.length === 0) {
    say(`\n=== refresh complete in ${totalMins} min ===`);
    return 0;
  }
  say(`\n=== refresh finished in ${totalMins} min with ${failed.length} failed step(s): ${failed.join(', ')} ===`);
  say('The steps that succeeded have already written their data; re-run the refresh to retry the rest.');
  return 1;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pipeline/refresh.ts');
if (isMain) process.exit(main());
