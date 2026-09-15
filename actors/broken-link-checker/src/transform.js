// Pure logic: lightweight HTML link extraction, URL normalization, same-site and robots.txt
// checks, and outcome classification. No DOM/cheerio — a small regex tokenizer is enough for
// a[href], img[src], link[rel=stylesheet][href], script[src] and <base href>, and it keeps the
// image (~few hundred MB smaller than a headless-browser Actor) and dependency count down.
// Every function here is deterministic and network-free so it can be unit-tested directly.

const SKIP_PROTOCOLS = new Set(['mailto:', 'tel:', 'javascript:', 'data:']);
const REDIRECT_LIKE_ERRORS = new Set([
  'dns_not_found', 'connection_refused', 'tls_error', 'timeout', 'redirect_loop', 'too_many_redirects',
]);

function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

/** Read one attribute's value from a raw `<tag ...>` attribute string. Handles double-quoted,
 * single-quoted and bare/unquoted values, case-insensitive attribute names. */
function getAttr(attrString, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i');
  const m = String(attrString || '').match(re);
  if (!m) return null;
  const raw = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3];
  return decodeEntities(raw).trim();
}

function hasRelStylesheet(attrString) {
  const rel = getAttr(attrString, 'rel');
  return Boolean(rel && rel.toLowerCase().split(/\s+/).includes('stylesheet'));
}

function cleanAnchorText(raw) {
  const text = decodeEntities(String(raw || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 200) : null;
}

function safeResolve(href, base) {
  try { return new URL(href, base).toString(); } catch { return null; }
}

/**
 * Extract checkable links from one HTML page: `<a href>`, `<img src>`,
 * `<link rel="stylesheet" href>` and `<script src>`. Relative URLs resolve against a `<base href>`
 * tag when present, otherwise against `pageUrl`. `srcset` is intentionally never read.
 * Returns `{ url, element, anchor_text }[]` — url is always an absolute http(s) URL with no
 * fragment; unresolvable or non-http(s)/mailto/tel/javascript/data hrefs are dropped.
 */
export function extractLinks(html, pageUrl) {
  // Strip HTML comments first so commented-out markup (common in real-world pages) never
  // produces a phantom link.
  const text = String(html || '').replace(/<!--[\s\S]*?-->/g, '');
  let effectiveBase = pageUrl;
  const baseMatch = text.match(/<base\b([^>]*)>/i);
  if (baseMatch) {
    const href = getAttr(baseMatch[1], 'href');
    const resolved = href && safeResolve(href, pageUrl);
    if (resolved) effectiveBase = resolved;
  }

  const links = [];

  const aRx = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = aRx.exec(text)) !== null) {
    const href = getAttr(m[1], 'href');
    const url = href ? normalizeUrl(href, effectiveBase) : null;
    if (!url) continue;
    links.push({ url, element: 'a', anchor_text: cleanAnchorText(m[2]) });
  }

  const tagRx = /<(img|script|link)\b([^>]*)>/gi;
  while ((m = tagRx.exec(text)) !== null) {
    const tag = m[1].toLowerCase();
    const attrs = m[2];
    if (tag === 'link' && !hasRelStylesheet(attrs)) continue;
    const attrName = tag === 'link' ? 'href' : 'src';
    const raw = getAttr(attrs, attrName);
    const url = raw ? normalizeUrl(raw, effectiveBase) : null;
    if (!url) continue;
    links.push({ url, element: tag, anchor_text: null });
  }

  return links;
}

/** Resolve `href` against `base`, strip the #fragment, keep the query string. Returns null for
 * mailto:/tel:/javascript:/data: and anything else that isn't http(s) or fails to parse. */
export function normalizeUrl(href, base) {
  if (href === null || href === undefined) return null;
  const trimmed = String(href).trim();
  if (!trimmed) return null;
  let u;
  try { u = new URL(trimmed, base); } catch { return null; }
  if (SKIP_PROTOCOLS.has(u.protocol)) return null;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  u.hash = '';
  return u.toString();
}

function hostOf(u) {
  try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

/** True when `url` and `siteUrl` share a hostname, ignoring a leading "www.". */
export function isSameSite(url, siteUrl) {
  const a = hostOf(url);
  const b = hostOf(siteUrl);
  return Boolean(a && b && a === b);
}

/**
 * True if robots.txt disallows crawling `pathAndQuery` for user-agent `*`. Groups are delimited
 * by User-agent lines; within the `*` group the longest matching Disallow/Allow prefix wins
 * (a bare "Disallow:" with no value means no restriction, per convention).
 */
export function robotsDisallows(robotsTxt, pathAndQuery) {
  const path = pathAndQuery || '/';
  let inStarGroup = false;
  let best = null;
  for (const rawLine of String(robotsTxt || '').split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === 'user-agent') { inStarGroup = value === '*'; continue; }
    if (!inStarGroup || (field !== 'disallow' && field !== 'allow')) continue;
    if (value === '') continue;
    const rulePath = value.replace(/\*+$/, '');
    if (path.startsWith(rulePath) && (!best || rulePath.length > best.path.length)) {
      best = { type: field, path: rulePath };
    }
  }
  return best ? best.type === 'disallow' : false;
}

/**
 * Classify one checked link's outcome. `status`: HTTP status or null (network failure);
 * `errorCode`: a transport failure code or 'rate_limited', or null; `redirectCount`: hops
 * followed. Never marks a 429 broken — "don't cry wolf" on rate limiting.
 */
export function classifyResult({ status = null, errorCode = null, redirectCount = 0 } = {}) {
  if (errorCode === 'rate_limited') {
    return { is_broken: false, reason: 'rate_limited_unverified', error: null };
  }
  if (errorCode) {
    const error = REDIRECT_LIKE_ERRORS.has(errorCode) ? errorCode : errorCode;
    return { is_broken: true, reason: `error_${error}`, error };
  }
  if (typeof status === 'number' && status >= 400) {
    return { is_broken: true, reason: `http_${status}`, error: null };
  }
  return { is_broken: false, reason: redirectCount > 0 ? 'ok_after_redirect' : 'ok', error: null };
}

/**
 * Fold one more occurrence of a link into its aggregate: first page it was found on, the number
 * of *distinct pages* linking to it (a link repeated many times on the same page — e.g. a nav
 * dropdown — still counts as one page), up to 5 sample page URLs, and the first non-empty anchor
 * text. Pass the previous aggregate (or null for the first occurrence) plus
 * `{ found_on_url, anchor_text }`. The returned `_seenPages` is internal bookkeeping (needed so a
 * page seen again after the 5-sample cap still doesn't double-count) — callers only need the
 * other four fields.
 */
export function mergeOccurrence(existing, occurrence) {
  const seenPages = existing?._seenPages ? new Set(existing._seenPages) : new Set();
  const isNewPage = !seenPages.has(occurrence.found_on_url);
  seenPages.add(occurrence.found_on_url);

  const found_on_url = existing?.found_on_url || occurrence.found_on_url;
  const found_on_count = seenPages.size;
  const found_on_sample = existing?.found_on_sample ? [...existing.found_on_sample] : [];
  if (isNewPage && found_on_sample.length < 5) found_on_sample.push(occurrence.found_on_url);
  const anchor_text = existing?.anchor_text || occurrence.anchor_text || null;
  return {
    found_on_url, found_on_count, found_on_sample, anchor_text, _seenPages: seenPages,
  };
}

/** Map a fetch() network failure to a structured error code. Pure — inspects e.name/e.cause.code,
 * no network — so the crawler's error handling is unit-testable without real DNS/TLS failures. */
export function classifyFetchError(e) {
  if (!e) return null;
  if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'timeout';
  const code = e.cause?.code || e.code;
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_not_found';
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return 'connection_refused';
  if (code && /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return 'tls_error';
  return null;
}

/**
 * Decide one site's terminal `status` for its site_summary row. Priority (first match wins):
 * the start URL never loading at all outranks every other outcome; a run-wide charge-limit stop
 * outranks a run-wide time-budget stop, which outranks simply hitting this site's own page cap.
 */
export function deriveSiteStatus({
  unreachable = false, chargeLimitReached = false, timeLimitReached = false, pageLimitReached = false,
} = {}) {
  if (unreachable) return 'start_url_unreachable';
  if (chargeLimitReached) return 'charge_limit_reached';
  if (timeLimitReached) return 'time_limit_reached';
  if (pageLimitReached) return 'page_limit_reached';
  return 'completed';
}
