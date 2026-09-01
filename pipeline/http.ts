export type FetchInit = { headers?: Record<string, string>; method?: string; body?: string };
export type FetchJson = (url: string, init?: FetchInit) => Promise<any>;

export function createFetchJson(opts: {
  retries?: number;
  baseDelayMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
} = {}): FetchJson {
  const retries = opts.retries ?? 4;
  const base = opts.baseDelayMs ?? 1000;
  const f = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)));

  return async (url, init) => {
    let lastErr: Error = new Error('unreachable');
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await f(url, {
          method: init?.method ?? 'GET',
          headers: { 'user-agent': 'police-drone-logs pipeline (github)', accept: 'application/json', ...(init?.headers ?? {}) },
          body: init?.body,
        });
        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 200)}`);
        try { return JSON.parse(text); }
        catch { throw new Error(`Unparsable JSON from ${url}: ${text.slice(0, 120)}`); }
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (attempt < retries) await sleep(base * 2 ** attempt);
      }
    }
    throw lastErr;
  };
}

export const fetchJson: FetchJson = createFetchJson();
