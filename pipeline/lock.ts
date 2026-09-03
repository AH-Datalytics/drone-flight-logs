import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One collector per source at a time.
 *
 * The raw stores are append-only logs and each collector deduplicates against
 * its own reading of the file. Two collectors on one source therefore cannot
 * see each other's writes, and both happily append the same flights: an
 * orphaned run once doubled eight agencies' records that way. The counts were
 * recoverable, but only because the ids were intact.
 *
 * So a collector claims its source directory first. A stale claim left behind
 * by a killed process is taken over rather than treated as a blocker, because
 * the alternative is a scheduled monthly refresh that silently stops running
 * after the first crash.
 */

export type LockInfo = { pid: number; started_utc: string; source: string };

function lockPath(dir: string): string {
  return join(dir, '_lock.json');
}

/** Whether a process is still running. Signal 0 tests existence without signalling. */
export function isAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but belongs to someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function readLock(dir: string): LockInfo | null {
  const p = lockPath(dir);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as LockInfo;
  } catch {
    return null;
  }
}

/**
 * Claim a source for this process. Throws if another live process holds it,
 * naming the process so the caller can decide what to do about it.
 */
export function acquireLock(dir: string, source: string): () => void {
  mkdirSync(dir, { recursive: true });
  const held = readLock(dir);
  if (held && held.pid !== process.pid && isAlive(held.pid)) {
    throw new Error(
      `${source} is already being collected by process ${held.pid}, started ${held.started_utc}. ` +
      `Two collectors on one source duplicate records, so this run is stopping. ` +
      `Stop that process, or wait for it to finish.`,
    );
  }

  const info: LockInfo = { pid: process.pid, started_utc: new Date().toISOString(), source };
  writeFileSync(lockPath(dir), JSON.stringify(info, null, 1) + '\n');

  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const current = readLock(dir);
      if (current && current.pid === process.pid) rmSync(lockPath(dir), { force: true });
    } catch { /* nothing useful to do while exiting */ }
  };

  process.once('exit', release);
  process.once('SIGINT', () => { release(); process.exit(130); });
  process.once('SIGTERM', () => { release(); process.exit(143); });
  return release;
}
