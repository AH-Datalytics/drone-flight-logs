import { describe, it, expect, vi } from 'vitest';
import { createFetchJson } from '../http.js';

function responder(seq: Array<{ status?: number; body?: string; throws?: boolean }>) {
  let i = 0;
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    calls.push(url);
    const s = seq[Math.min(i++, seq.length - 1)];
    if (s.throws) throw new Error('ECONNRESET');
    return new Response(s.body ?? '{}', { status: s.status ?? 200, headers: { 'content-type': 'application/json' } });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('fetchJson', () => {
  it('returns parsed JSON on success', async () => {
    const { fetchImpl } = responder([{ body: '{"ok":1}' }]);
    const fj = createFetchJson({ fetchImpl, sleep: async () => {} });
    expect(await fj('https://x/a')).toEqual({ ok: 1 });
  });
  it('retries on network error and 5xx, then succeeds', async () => {
    const { fetchImpl, calls } = responder([{ throws: true }, { status: 503 }, { body: '{"ok":2}' }]);
    const delays: number[] = [];
    const fj = createFetchJson({ fetchImpl, baseDelayMs: 100, sleep: async ms => { delays.push(ms); } });
    expect(await fj('https://x/b')).toEqual({ ok: 2 });
    expect(calls.length).toBe(3);
    expect(delays).toEqual([100, 200]);
  });
  it('retries on unparsable body', async () => {
    const { fetchImpl } = responder([{ body: '<html>oops' }, { body: '{"ok":3}' }]);
    const fj = createFetchJson({ fetchImpl, sleep: async () => {} });
    expect(await fj('https://x/c')).toEqual({ ok: 3 });
  });
  it('throws after exhausting retries with the last error', async () => {
    const { fetchImpl, calls } = responder([{ status: 500, body: 'boom' }]);
    const fj = createFetchJson({ fetchImpl, retries: 2, sleep: async () => {} });
    await expect(fj('https://x/d')).rejects.toThrow(/HTTP 500/);
    expect(calls.length).toBe(3); // 1 + 2 retries
  });
  it('passes headers and method through', async () => {
    const fetchImpl = vi.fn(async (_u: string, init: RequestInit) => new Response('{"h":"' + (init.headers as Record<string, string>)['transparency-dashboard-path'] + '"}', { status: 200 }));
    const fj = createFetchJson({ fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {} });
    expect(await fj('https://x/e', { method: 'POST', headers: { 'transparency-dashboard-path': 'nopd' }, body: '{}' })).toEqual({ h: 'nopd' });
  });
});
