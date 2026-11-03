// Shared HTTP helper for all Actors. Deterministic: retries with exponential
// backoff, structured failure classes, no LLM anywhere.
// Synced into each actor's src/lib/ by scripts/sync_shared.py — edit ONLY in shared/js/.

export const FailureClass = {
  HTTP_ERROR: 'http_error',
  TIMEOUT: 'timeout',
  BLOCKED: 'blocked',
  SELECTOR_MISS: 'selector_miss',
  SCHEMA_CHANGE: 'schema_change',
  SITE_DOWN: 'site_down',
};

export class FetchError extends Error {
  constructor(message, failureClass, status) {
    super(message);
    this.failureClass = failureClass;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retry-After header (seconds or HTTP date) -> milliseconds, or null. */
export function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined || value === '') return null;
  const v = String(value).trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/**
 * GET/POST JSON with retries. opts: { method, headers, body, retries=3,
 * timeoutMs=30000, minDelayMs=1000, maxRetryAfterMs=60000 }. Throws FetchError with failureClass.
 * A 429/503 with Retry-After waits that long before the next attempt; a Retry-After longer than
 * maxRetryAfterMs is not waited out: it throws at once (blocked, err.retryAfterMs set) so the caller
 * can stop calling that host.
 */
export async function fetchJson(url, opts = {}) {
  const { method = 'GET', headers = {}, body, retries = 3, timeoutMs = 30000, minDelayMs = 1000, maxRetryAfterMs = 60000 } = opts;
  let lastErr;
  let waitMs = 0;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.max(minDelayMs * 2 ** (attempt - 1), waitMs));
    waitMs = 0;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { accept: 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
      const ra = res.status === 429 || res.status === 503 ? retryAfterMs(res.headers?.get?.('retry-after')) : null;
      if (ra !== null && ra > maxRetryAfterMs) {
        throw Object.assign(new FetchError(`HTTP ${res.status} at ${url} (Retry-After ${Math.round(ra / 1000)} s)`, FailureClass.BLOCKED, res.status), { retryAfterMs: ra });
      }
      if (ra !== null) waitMs = ra;
      if (res.status === 403 || res.status === 429) {
        lastErr = new FetchError(`HTTP ${res.status} at ${url}`, FailureClass.BLOCKED, res.status);
        continue; // retry with backoff
      }
      if (res.status >= 500) {
        lastErr = new FetchError(`HTTP ${res.status} at ${url}`, FailureClass.SITE_DOWN, res.status);
        continue;
      }
      if (!res.ok) {
        throw new FetchError(`HTTP ${res.status} at ${url}`, FailureClass.HTTP_ERROR, res.status);
      }
      try {
        return await res.json();
      } catch {
        throw new FetchError(`Non-JSON response at ${url}`, FailureClass.SCHEMA_CHANGE, res.status);
      }
    } catch (e) {
      if (e instanceof FetchError && (e.failureClass === FailureClass.HTTP_ERROR || e.retryAfterMs !== undefined)) throw e;
      if (e.name === 'AbortError') {
        lastErr = new FetchError(`Timeout after ${timeoutMs}ms at ${url}`, FailureClass.TIMEOUT);
      } else if (!(e instanceof FetchError)) {
        lastErr = new FetchError(`${e.message} at ${url}`, FailureClass.SITE_DOWN);
      } else {
        lastErr = e;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Simple serial rate limiter: at most one call per intervalMs. */
export function rateLimiter(intervalMs) {
  let next = 0;
  return async () => {
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + intervalMs;
    if (wait > 0) await sleep(wait);
  };
}
