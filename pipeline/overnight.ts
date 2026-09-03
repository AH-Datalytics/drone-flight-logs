import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The unattended backfill.
 *
 * Reading three hundred thousand flights out of ninety-five dashboards takes
 * hours, so this is written to be left alone: it keeps the machine awake while
 * it works, retries a source that fails, and resumes wherever the last attempt
 * stopped. Every collector stores what it has already fetched, so a run that
 * dies halfway costs the time and nothing else.
 *
 * Flock and AirData run at the same time because they are unrelated hosts and
 * one is browser-bound while the other is plain HTTP; running them in sequence
 * would roughly double the wall clock for no benefit to either.
 *
 * When both finish it merges everything and writes the site's files, so the
 * morning's first look is at finished data rather than a half-built store.
 */

const LOG = join('data', 'overnight.log');
const MAX_ATTEMPTS = 3;

function say(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG, line + '\n');
}

type Job = { name: string; args: string[] };

function runOnce(job: Job): Promise<number> {
  return new Promise(resolve => {
    const child = spawn('npx', ['tsx', ...job.args], { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    const line = (buf: Buffer) => {
      for (const l of buf.toString().split('\n')) if (l.trim()) say(`  ${job.name}: ${l.trim()}`);
    };
    child.stdout.on('data', line);
    child.stderr.on('data', line);
    child.on('close', code => resolve(code ?? 1));
  });
}

/** Run a collector, retrying if it dies. Each attempt resumes from stored state. */
async function runWithRetries(job: Job): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    say(`${job.name}: attempt ${attempt} of ${MAX_ATTEMPTS}`);
    const code = await runOnce(job);
    if (code === 0) { say(`${job.name}: finished`); return true; }
    say(`${job.name}: exited ${code}`);
    if (attempt < MAX_ATTEMPTS) {
      say(`${job.name}: waiting two minutes, then resuming from where it stopped`);
      await new Promise(r => setTimeout(r, 120_000));
    }
  }
  say(`${job.name}: gave up after ${MAX_ATTEMPTS} attempts`);
  return false;
}

function storedFlights(source: string): number {
  const p = join('data', 'raw', source, '_state.json');
  if (!existsSync(p)) return 0;
  try {
    const s = JSON.parse(readFileSync(p, 'utf8')) as { agencies: Record<string, { total_flights: number }> };
    return Object.values(s.agencies).reduce((t, a) => t + (a.total_flights ?? 0), 0);
  } catch { return 0; }
}

async function main(): Promise<number> {
  mkdirSync('data', { recursive: true });
  const started = Date.now();
  say('=== overnight backfill started ===');
  say(`already stored: flock ${storedFlights('flock')}, airdata ${storedFlights('airdata')}, cape ${storedFlights('cape')}`);

  const results = await Promise.all([
    runWithRetries({ name: 'flock', args: ['pipeline/flock/collect.ts', '--since', '2023-01', '--concurrency', '4'] }),
    runWithRetries({ name: 'airdata', args: ['pipeline/airdata/collect.ts'] }),
  ]);

  say(`collected: flock ${storedFlights('flock')}, airdata ${storedFlights('airdata')}, cape ${storedFlights('cape')}`);
  say('merging sources and writing the site files');

  for (const step of [['merge', 'pipeline/build.ts'], ['site files', 'scripts/prebuild.ts']] as const) {
    const res = spawnSync('npx', ['tsx', step[1]], { shell: process.platform === 'win32', encoding: 'utf8' });
    for (const l of (res.stdout ?? '').split('\n')) if (l.trim()) say(`  ${step[0]}: ${l.trim()}`);
    if (res.status !== 0) say(`  ${step[0]}: FAILED (exit ${res.status}) ${(res.stderr ?? '').slice(0, 400)}`);
  }

  const hours = ((Date.now() - started) / 3_600_000).toFixed(1);
  const failed = results.filter(r => !r).length;
  say(failed === 0
    ? `=== overnight backfill complete in ${hours}h — everything collected and rebuilt ===`
    : `=== overnight backfill finished in ${hours}h with ${failed} source(s) incomplete; re-run overnight.bat to resume ===`);
  return failed === 0 ? 0 : 1;
}

const isMain = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('pipeline/overnight.ts');
if (isMain) main().then(code => process.exit(code));
