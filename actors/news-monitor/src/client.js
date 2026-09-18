// GDELT-specific fetch wrapper. Not part of src/lib (the mandatory shared helpers) because GDELT's
// failure modes don't fit the generic JSON-API assumptions baked into lib/http.js:
//
//  - Rate limit (verified live 2026-09-18): GDELT asks for "one request every 5 seconds" and, when
//    exceeded, replies with HTTP 429 *and a plain-text body* (not JSON) reading e.g. "Please limit
//    requests to one every 5 seconds or contact ...". We throttle proactively to one request per
//    RATE_LIMIT_MS, and additionally recognize that text pattern (in case it ever arrives on a 200,
//    as some third-party clients have reported) as a transient condition to retry, not a schema change.
const RATE_LIMIT_TEXT = /please limit requests/i;

export const RATE_LIMIT_MS = 5000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Build a throttled GDELT fetcher: fetchGdelt(url) -> parsed JSON. One shared instance should be
 * reused across an entire run (all queries, all windows) so the 5s spacing is enforced globally.
 */
export function createGdeltFetcher({ fetchImpl = fetch, retries = 5, timeoutMs = 30000, minDelayMs = RATE_LIMIT_MS } = {}) {
  let nextAt = 0;
  async function throttle() {
    const wait = Math.max(0, nextAt - Date.now());
    nextAt = Math.max(Date.now(), nextAt) + minDelayMs;
    if (wait > 0) await sleep(wait);
  }

  return async function fetchGdelt(url) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await throttle();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
        const text = await res.text();
        if (res.status === 429 || RATE_LIMIT_TEXT.test(text)) {
          lastErr = Object.assign(new Error(`GDELT rate limit at ${url}: ${text.slice(0, 160)}`), { failureClass: 'blocked' });
          continue; // retry after the throttle's own backoff on the next loop iteration
        }
        if (res.status >= 500) {
          lastErr = Object.assign(new Error(`HTTP ${res.status} at ${url}`), { failureClass: 'site_down' });
          continue;
        }
        if (!res.ok) {
          throw Object.assign(new Error(`HTTP ${res.status} at ${url}`), { failureClass: 'http_error' });
        }
        try {
          return text.trim() === '' ? {} : JSON.parse(text);
        } catch {
          throw Object.assign(new Error(`Non-JSON GDELT response at ${url}: ${text.slice(0, 160)}`), { failureClass: 'schema_change' });
        }
      } catch (e) {
        if (e.failureClass === 'http_error' || e.failureClass === 'schema_change') throw e;
        if (e.name === 'AbortError') {
          lastErr = Object.assign(new Error(`Timeout after ${timeoutMs}ms at ${url}`), { failureClass: 'timeout' });
        } else if (!e.failureClass) {
          lastErr = Object.assign(new Error(`${e.message} at ${url}`), { failureClass: 'site_down' });
        } else {
          lastErr = e;
        }
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  };
}
