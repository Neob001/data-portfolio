// Polite HTTP for the nightly build: one pacer per host (minimum spacing between request starts),
// retries with exponential backoff on network errors / 429 / 5xx, Retry-After honoured (a wait above
// maxRetryAfterMs fails fast so the source can stop for the night), per-request timeout.
export const UA = 'factpipe-tenders-index/1.0 (+https://github.com/Neob001/data-portfolio)';

export class HttpError extends Error {
  constructor(message, failureClass, status) {
    super(message);
    this.failureClass = failureClass;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pacers = new Map();

/** Wait for the host's turn: at most one request start per `minGapMs` per host. */
export async function pace(host, minGapMs) {
  const now = Date.now();
  const next = Math.max(now, pacers.get(host) ?? 0);
  pacers.set(host, next + minGapMs);
  if (next > now) await sleep(next - now);
}

function retryAfterMs(v) {
  if (!v) return null;
  if (/^\d+$/.test(v.trim())) return Number(v) * 1000;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, t - Date.now()) : null;
}

export const stats = { requests: 0, retries: 0, bytes: 0, byHost: {} };

/**
 * fetch with pacing + retries. Returns the Response (body unread) for 2xx (and 3xx when redirect='manual').
 * opts: { method, headers, body, minGapMs=1000, retries=4, timeoutMs=120000, maxRetryAfterMs=120000, redirect }
 */
export async function request(url, opts = {}) {
  const { method = 'GET', headers = {}, body, minGapMs = 1000, retries = 4, timeoutMs = 120000, maxRetryAfterMs = 120000, redirect = 'follow' } = opts;
  const host = new URL(url).host;
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await pace(host, minGapMs);
    stats.requests += 1;
    stats.byHost[host] = (stats.byHost[host] || 0) + 1;
    if (attempt) stats.retries += 1;
    let res;
    try {
      res = await fetch(url, {
        method, body, redirect,
        headers: { 'user-agent': UA, ...headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      last = new HttpError(`${timeout ? `timeout after ${timeoutMs} ms` : e.message} at ${url}`, timeout ? 'timeout' : 'site_down');
      await sleep(2000 * 2 ** attempt);
      continue;
    }
    if (res.ok || (redirect === 'manual' && res.status >= 300 && res.status < 400)) return res;
    const ra = retryAfterMs(res.headers.get('retry-after'));
    await res.arrayBuffer().catch(() => null);
    if (res.status === 429 || res.status >= 500) {
      last = new HttpError(`HTTP ${res.status} at ${url}`, res.status === 429 ? 'blocked' : 'site_down', res.status);
      if (ra !== null && ra > maxRetryAfterMs) throw Object.assign(last, { retryAfterMs: ra });
      await sleep(Math.max(ra ?? 0, 2000 * 2 ** attempt));
      continue;
    }
    throw new HttpError(`HTTP ${res.status} at ${url}`, res.status === 403 ? 'blocked' : 'http_error', res.status);
  }
  throw last;
}

export async function requestJson(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  stats.bytes += text.length;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(`non-JSON response at ${url}`, 'schema_change', res.status);
  }
}
