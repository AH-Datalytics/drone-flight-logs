import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireLock, readLock, isAlive } from '../lock.js';

describe('isAlive', () => {
  it('recognizes this process', () => {
    expect(isAlive(process.pid)).toBe(true);
  });

  it('rejects a pid that cannot exist', () => {
    expect(isAlive(0)).toBe(false);
    expect(isAlive(-1)).toBe(false);
    expect(isAlive(2_147_483_600)).toBe(false);
  });
});

describe('acquireLock', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lock-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('claims a free source and names the holder', () => {
    const release = acquireLock(dir, 'flock');
    const held = readLock(dir)!;
    expect(held.pid).toBe(process.pid);
    expect(held.source).toBe('flock');
    release();
    expect(readLock(dir)).toBeNull();
  });

  it('refuses to start when a live process holds the source', () => {
    writeFileSync(join(dir, '_lock.json'), JSON.stringify({ pid: process.pid + 0, started_utc: 'x', source: 'flock' }));
    // A lock naming this very process is treated as our own and taken over, so
    // use a different live pid: the parent, which is alive while we run.
    writeFileSync(join(dir, '_lock.json'), JSON.stringify({ pid: process.ppid, started_utc: '2026-09-03T00:00:00Z', source: 'flock' }));
    expect(() => acquireLock(dir, 'flock')).toThrow(/already being collected by process/);
  });

  it('takes over a claim left behind by a process that is gone', () => {
    writeFileSync(join(dir, '_lock.json'), JSON.stringify({ pid: 2_147_483_600, started_utc: '2026-01-01T00:00:00Z', source: 'flock' }));
    const release = acquireLock(dir, 'flock');
    expect(readLock(dir)!.pid).toBe(process.pid);
    release();
  });

  it('takes over an unreadable claim rather than blocking forever', () => {
    writeFileSync(join(dir, '_lock.json'), 'not json');
    const release = acquireLock(dir, 'flock');
    expect(readLock(dir)!.pid).toBe(process.pid);
    release();
  });

  it('is safe to release twice', () => {
    const release = acquireLock(dir, 'flock');
    release();
    expect(() => release()).not.toThrow();
  });

  it('leaves another process’s claim in place when releasing', () => {
    const release = acquireLock(dir, 'flock');
    writeFileSync(join(dir, '_lock.json'), JSON.stringify({ pid: 999_999, started_utc: 'x', source: 'flock' }));
    release();
    expect(readLock(dir)!.pid).toBe(999_999);
  });

  it('creates the source directory if it does not exist yet', () => {
    const nested = join(dir, 'raw', 'flock');
    const release = acquireLock(nested, 'flock');
    expect(existsSync(join(nested, '_lock.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(nested, '_lock.json'), 'utf8')).source).toBe('flock');
    release();
  });
});
