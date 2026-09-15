// Crawl + link-check engine. Framework-agnostic: takes { fetchImpl, pushData, charge } so it runs
// against a plain node:http fixture server in tests, with no Apify SDK involved.
import {
  extractLinks, normalizeUrl, isSameSite, robotsDisallows, classifyResult, mergeOccurrence, classifyFetchError,
  deriveSiteStatus,
} from './transform.js';
import { stamp } from './lib/records.js';

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (compatible; factpipe-broken-link-checker/1.0; +https://apify.com/factpipe/broken-link-checker)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const METHOD_FALLBACK_STATUSES = new Set([403, 405, 501]);

async function cancelBody(res) {
  if (res?.body) { try { await res.body.cancel(); } catch { /* ignore */ } }
}

function hostKey(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return url; }
}

function combineSignals(timeoutMs, extraSignal) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!extraSignal) return timeoutSignal;
  return AbortSignal.any([timeoutSignal, extraSignal]);
}

async function rawFetch(fetchImpl, url, method, timeoutMs, userAgent, extraSignal) {
  try {
    const res = await fetchImpl(url, {
      method,
      redirect: 'manual',
      headers: { 'User-Agent': userAgent },
      signal: combineSignals(timeoutMs, extraSignal),
    });
    return { res };
  } catch (e) {
    return { errorCode: classifyFetchError(e) || 'connection_refused' };
  }
}

/** Follow redirects manually (max 5 hops) for one fixed HTTP method. `extraSignal` (the run's
 * wind-down signal) aborts the request regardless of the per-request timeout — used to cut off
 * in-flight checks once the run's time budget plus grace period has elapsed. */
async function fetchChain(fetchImpl, startUrl, { method, readBody, timeoutMs, userAgent, extraSignal, maxRedirects = 5 }) {
  let url = startUrl;
  let redirectCount = 0;
  const seen = new Set([url]);
  for (;;) {
    const { res, errorCode } = await rawFetch(fetchImpl, url, method, timeoutMs, userAgent, extraSignal);
    if (errorCode) return { errorCode, finalUrl: url, redirectCount };
    if (REDIRECT_STATUSES.has(res.status)) {
      const loc = res.headers.get('location');
      await cancelBody(res);
      if (!loc) return { status: res.status, finalUrl: url, redirectCount, headers: res.headers, contentType: '' };
      const next = normalizeUrl(loc, url);
      if (!next) return { status: res.status, finalUrl: url, redirectCount, headers: res.headers, contentType: '' };
      redirectCount += 1;
      if (redirectCount > maxRedirects) return { errorCode: 'too_many_redirects', finalUrl: next, redirectCount };
      if (seen.has(next)) return { errorCode: 'redirect_loop', finalUrl: next, redirectCount };
      seen.add(next);
      url = next;
      continue;
    }
    const contentType = res.headers.get('content-type') || '';
    let body = null;
    if (readBody) {
      body = await res.text().catch(() => '');
    } else {
      await cancelBody(res);
    }
    return { status: res.status, finalUrl: url, redirectCount, headers: res.headers, contentType, body };
  }
}

/**
 * HEAD first; fall back to GET on 403/405/501 or a network oddity; 1 retry on timeout/5xx; on
 * 429, sleep up to Retry-After (capped 10s) and try once more — still 429 comes back as
 * errorCode 'rate_limited' (classifyResult never marks that broken). `forceGet` skips the HEAD
 * attempt entirely, for page fetches that need the body anyway.
 */
async function performCheck(fetchImpl, url, { timeoutMs, userAgent, readBody, forceGet, extraSignal }) {
  let method = forceGet ? 'GET' : 'HEAD';
  let result = await fetchChain(fetchImpl, url, { method, readBody: forceGet ? readBody : false, timeoutMs, userAgent, extraSignal });
  if (!forceGet && (result.errorCode || METHOD_FALLBACK_STATUSES.has(result.status))) {
    method = 'GET';
    result = await fetchChain(fetchImpl, url, { method, readBody, timeoutMs, userAgent, extraSignal });
  }
  if (result.errorCode === 'timeout' || (typeof result.status === 'number' && result.status >= 500)) {
    result = await fetchChain(fetchImpl, url, { method, readBody, timeoutMs, userAgent, extraSignal }); // 1 retry
  }
  if (result.status === 429) {
    const retryAfter = result.headers?.get?.('retry-after');
    let waitMs = 1000;
    if (retryAfter) {
      const n = Number(retryAfter);
      if (Number.isFinite(n)) waitMs = n * 1000;
    }
    waitMs = Math.min(Math.max(waitMs, 0), 10000);
    await sleep(waitMs);
    result = await fetchChain(fetchImpl, url, { method, readBody, timeoutMs, userAgent, extraSignal });
    if (result.status === 429) return { ...result, errorCode: 'rate_limited' };
  }
  return result;
}

const checkLink = (fetchImpl, url, opts) => performCheck(fetchImpl, url, { ...opts, readBody: false, forceGet: false });
const fetchPage = (fetchImpl, url, opts) => performCheck(fetchImpl, url, { ...opts, readBody: true, forceGet: true });

function pathForRobots(url) {
  try { const u = new URL(url); return u.pathname + u.search; } catch { return '/'; }
}

async function fetchRobotsTxt(fetchImpl, siteUrl, opts) {
  try {
    const robotsUrl = new URL('/robots.txt', siteUrl).toString();
    const result = await fetchChain(fetchImpl, robotsUrl, { method: 'GET', readBody: true, ...opts });
    if (typeof result.status === 'number' && result.status < 400 && typeof result.body === 'string') return result.body;
  } catch { /* no robots.txt reachable -> no restrictions */ }
  return '';
}

/** Run `worker` over a queue that may grow while draining (BFS), up to `concurrency` at once. */
async function runPool(queue, shouldStop, worker, concurrency) {
  async function runOne() {
    while (queue.length > 0 && !shouldStop()) {
      const item = queue.shift();
      if (item === undefined) break;
      // eslint-disable-next-line no-await-in-loop
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, runOne));
}

/**
 * Dual-constrained scheduler: at most `globalLimit` tasks running at once overall, and at most
 * `perHostLimit` running for any single hostname at once. External/asset (and any not-crawled
 * internal) link checks are submitted here as soon as they're discovered, so they run
 * concurrently with — not serialized behind — each site's own page-crawl loop.
 */
export function createHostPool({ globalLimit, perHostLimit }) {
  let globalActive = 0;
  let pending = 0;
  const hostActive = new Map();
  const queue = [];
  const idleWaiters = [];

  function pump() {
    while (globalActive < globalLimit) {
      const i = queue.findIndex((item) => (hostActive.get(item.host) || 0) < perHostLimit);
      if (i === -1) return;
      const [item] = queue.splice(i, 1);
      globalActive += 1;
      hostActive.set(item.host, (hostActive.get(item.host) || 0) + 1);
      run(item);
    }
  }

  async function run(item) {
    try {
      item.resolve(await item.task());
    } catch (e) {
      item.reject(e);
    } finally {
      globalActive -= 1;
      hostActive.set(item.host, Math.max(0, (hostActive.get(item.host) || 1) - 1));
      pending -= 1;
      if (pending === 0) idleWaiters.splice(0).forEach((r) => r());
      pump();
    }
  }

  return {
    add(host, task) {
      pending += 1;
      return new Promise((resolve, reject) => {
        queue.push({ host, task, resolve, reject });
        pump();
      });
    },
    whenIdle() {
      return pending === 0 ? Promise.resolve() : new Promise((resolve) => idleWaiters.push(resolve));
    },
    get pendingCount() { return pending; },
  };
}

function emptySummary(startUrl, status) {
  return {
    site: startUrl,
    start_url: startUrl,
    pages_scanned: 0,
    links_checked: 0,
    broken_links: 0,
    rate_limited_unverified: 0,
    external_links_checked: 0,
    top_broken: [],
    status,
  };
}

/**
 * Crawl and link-check one site (BFS over same-host HTML pages, up to maxPagesPerSite), pushing
 * one dataset row per unique broken link (and OK links too if includeOkLinks), each tagged
 * `record_type: "broken_link"|"ok_link"`. Always finishes by pushing exactly one
 * `record_type: "site_summary"` row for this start URL — Apify's daily auto-test on the default
 * input requires a non-empty dataset, which a healthy site with includeOkLinks=false would
 * otherwise never produce. Returns that summary object.
 */
export async function crawlSite(startUrlRaw, options, deps) {
  const {
    maxPagesPerSite = 50,
    checkExternalLinks = true,
    checkImagesAndAssets = true,
    includeOkLinks = false,
    respectRobotsTxt = true,
  } = options || {};
  const {
    fetchImpl = globalThis.fetch,
    pushData = async () => {},
    charge = async () => ({ eventChargeLimitReached: false }),
    userAgent = DEFAULT_USER_AGENT,
    timeoutMs = 10000,
    concurrency = 4,
    limitState = { reached: false },
    timeState = { deadlineAt: Infinity, signal: undefined },
    checkPool = createHostPool({ globalLimit: 24, perHostLimit: 4 }),
  } = deps || {};

  const startUrl = normalizeUrl(startUrlRaw, startUrlRaw) || String(startUrlRaw);
  const timeUp = () => Date.now() >= timeState.deadlineAt;

  if (limitState.reached) {
    const summary = emptySummary(startUrl, 'charge_limit_reached');
    await pushData(stamp({ record_type: 'site_summary', ...summary }, startUrl));
    return summary;
  }

  const links = new Map(); // url -> { element, linkType, occ, result, _checkPromise }
  const visitedForCrawl = new Set();
  const queuedForCrawl = new Set();
  const queue = [startUrl];
  queuedForCrawl.add(startUrl);
  let pagesScanned = 0;
  let unreachable = false;
  const pendingCharges = [];

  const robotsTxt = respectRobotsTxt
    ? await fetchRobotsTxt(fetchImpl, startUrl, { timeoutMs, userAgent, extraSignal: timeState.signal })
    : '';

  function ensureEntry(url, element, linkType) {
    let e = links.get(url);
    if (!e) { e = { element, linkType, occ: null, result: undefined }; links.set(url, e); }
    return e;
  }

  /** Submit a link that won't itself be crawled as a page to the shared host pool. Resolves
   * `{ skipped }` — `skipped: true` means the time budget was already exhausted (or the check
   * was aborted by the wind-down grace signal), so the caller must not charge for a page whose
   * link set included it. Checking each unique link happens at most once, however many pages
   * reference it. */
  function submitCheck(url) {
    const entry = links.get(url);
    if (entry.result !== undefined) return Promise.resolve({ skipped: false });
    if (entry._checkPromise) return entry._checkPromise;
    if (timeUp()) return Promise.resolve({ skipped: true });
    entry._checkPromise = checkPool
      .add(hostKey(url), async () => {
        entry.result = await checkLink(fetchImpl, url, { timeoutMs, userAgent, extraSignal: timeState.signal });
        return { skipped: false };
      })
      .catch(() => ({ skipped: true }));
    return entry._checkPromise;
  }

  async function processPage(pageUrl) {
    if (visitedForCrawl.has(pageUrl)) return;
    visitedForCrawl.add(pageUrl);

    const result = await fetchPage(fetchImpl, pageUrl, { timeoutMs, userAgent, extraSignal: timeState.signal });
    const entry = ensureEntry(pageUrl, 'a', 'internal');
    if (entry.result === undefined) entry.result = result;

    const isHtml2xx = typeof result.status === 'number' && result.status >= 200 && result.status < 300
      && /text\/html/i.test(result.contentType || '');

    if (pageUrl === startUrl && (result.errorCode || !isHtml2xx)) {
      unreachable = true;
      return;
    }
    if (!isHtml2xx) return;

    const extracted = extractLinks(result.body, result.finalUrl || pageUrl);
    const waitFor = [];
    for (const link of extracted) {
      const internal = isSameSite(link.url, startUrl);
      const isAsset = link.element !== 'a';
      if (isAsset && !checkImagesAndAssets) continue;
      if (!internal && !checkExternalLinks) continue;

      const e = ensureEntry(link.url, link.element, internal ? 'internal' : 'external');
      e.occ = mergeOccurrence(e.occ, { found_on_url: pageUrl, anchor_text: link.anchor_text });

      const crawlCandidate = link.element === 'a' && internal;
      const alreadyCrawledOrQueued = crawlCandidate && (visitedForCrawl.has(link.url) || queuedForCrawl.has(link.url));
      let willBeCrawled = alreadyCrawledOrQueued;
      if (crawlCandidate && !alreadyCrawledOrQueued) {
        const disallowed = respectRobotsTxt && robotsDisallows(robotsTxt, pathForRobots(link.url));
        if (!disallowed && !timeUp() && pagesScanned + queue.length < maxPagesPerSite) {
          queuedForCrawl.add(link.url);
          queue.push(link.url);
          willBeCrawled = true;
        }
      }
      // A link also being crawled as a page (by this call or an earlier one) gets its result
      // from that fetch; only links this page is solely responsible for discovering need an
      // explicit check here. This keeps two pages that link to each other from having to wait on
      // one another's charge task.
      if (!willBeCrawled) waitFor.push(submitCheck(link.url));
    }

    pagesScanned += 1;

    // Charge only once every link this page is responsible for has a result, without blocking
    // the crawl loop (other pages, and other hosts' checks) on that wait.
    pendingCharges.push((async () => {
      const outcomes = await Promise.all(waitFor);
      if (outcomes.some((o) => o.skipped)) return; // not fully checked -> never charged
      const chargeResult = await charge({ eventName: 'page-scanned' });
      if (chargeResult?.eventChargeLimitReached) limitState.reached = true;
    })());
  }

  await runPool(
    queue,
    () => limitState.reached || unreachable || pagesScanned >= maxPagesPerSite || timeUp(),
    processPage,
    concurrency,
  );

  if (unreachable) {
    const startResult = links.get(startUrl)?.result || {};
    const summary = emptySummary(startUrl, 'start_url_unreachable');
    await pushData(stamp({
      record_type: 'broken_link',
      site: startUrl,
      link_url: startUrl,
      final_url: startResult.finalUrl || null,
      status_code: typeof startResult.status === 'number' ? startResult.status : null,
      error: startResult.errorCode || null,
      is_broken: true,
      reason: 'start_url_unreachable',
      link_type: 'internal',
      element: null,
      found_on_url: null,
      found_on_count: 0,
      found_on_sample: [],
      anchor_text: null,
      redirect_count: startResult.redirectCount || 0,
    }, startUrl));
    summary.broken_links = 1;
    await pushData(stamp({ record_type: 'site_summary', ...summary }, startUrl));
    return summary;
  }

  // Bounded only by the shared wind-down signal (fires at the run's time budget + grace period);
  // in the common case every check finishes well before that and this resolves promptly.
  await Promise.all(pendingCharges);

  let linksChecked = 0;
  let brokenLinks = 0;
  let rateLimitedUnverified = 0;
  let externalLinksChecked = 0;
  const topBroken = [];

  for (const [url, e] of links) {
    if (e.occ === null || e.result === undefined) continue; // never actually linked-to, or never checked (time ran out)
    linksChecked += 1;
    if (e.linkType === 'external') externalLinksChecked += 1;
    const r = e.result;
    const c = classifyResult({ status: r.status ?? null, errorCode: r.errorCode ?? null, redirectCount: r.redirectCount ?? 0 });
    if (c.reason === 'rate_limited_unverified') rateLimitedUnverified += 1;
    if (c.is_broken) {
      brokenLinks += 1;
      if (topBroken.length < 10) topBroken.push(url);
    }
    if (!c.is_broken && !includeOkLinks) continue;
    // eslint-disable-next-line no-await-in-loop
    await pushData(stamp({
      record_type: c.is_broken ? 'broken_link' : 'ok_link',
      site: startUrl,
      link_url: url,
      final_url: r.finalUrl || url,
      status_code: typeof r.status === 'number' ? r.status : null,
      error: c.error,
      is_broken: c.is_broken,
      reason: c.reason,
      link_type: e.linkType,
      element: e.element,
      found_on_url: e.occ.found_on_url,
      found_on_count: e.occ.found_on_count,
      found_on_sample: e.occ.found_on_sample,
      anchor_text: e.occ.anchor_text,
      redirect_count: r.redirectCount || 0,
    }, r.finalUrl || url));
  }

  const status = deriveSiteStatus({
    unreachable: false,
    chargeLimitReached: limitState.reached,
    timeLimitReached: timeUp(),
    pageLimitReached: pagesScanned >= maxPagesPerSite,
  });

  const summary = {
    site: startUrl,
    start_url: startUrl,
    pages_scanned: pagesScanned,
    links_checked: linksChecked,
    broken_links: brokenLinks,
    rate_limited_unverified: rateLimitedUnverified,
    external_links_checked: externalLinksChecked,
    top_broken: topBroken,
    status,
  };
  await pushData(stamp({ record_type: 'site_summary', ...summary }, startUrl));
  return summary;
}

/**
 * Run crawlSite over every input startUrl, sharing one host-aware check pool (global concurrency
 * 24, per-host 4) and one run-wide time budget across all of them. A global charge-limit hit
 * (limitState.reached) makes every subsequent site a no-op (charge_limit_reached) summary. Once
 * `maxRunMinutes` elapses, no new pages/checks start anywhere; anything still in flight is given
 * `graceMs` (default 15s) before being aborted, and affected sites report time_limit_reached.
 */
export async function runCrawl(input, deps) {
  const {
    startUrls = [],
    maxPagesPerSite = 50,
    checkExternalLinks = true,
    checkImagesAndAssets = true,
    includeOkLinks = false,
    respectRobotsTxt = true,
    maxRunMinutes = Infinity,
  } = input || {};
  const { graceMs = 15000, ...restDeps } = deps || {};

  const limitState = { reached: false };
  const checkPool = restDeps.checkPool || createHostPool({ globalLimit: 24, perHostLimit: 4 });
  const deadlineAt = Number.isFinite(maxRunMinutes) ? Date.now() + maxRunMinutes * 60000 : Infinity;
  const windDown = new AbortController();
  let graceTimer;
  if (Number.isFinite(deadlineAt)) {
    graceTimer = setTimeout(() => windDown.abort(), Math.max(0, deadlineAt - Date.now()) + graceMs);
    graceTimer.unref?.();
  }
  const timeState = { deadlineAt, signal: windDown.signal };

  const summaries = [];
  try {
    for (const raw of startUrls) {
      const s = String(raw || '').trim();
      if (!s) continue;
      const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
      // eslint-disable-next-line no-await-in-loop
      const summary = await crawlSite(
        url,
        { maxPagesPerSite, checkExternalLinks, checkImagesAndAssets, includeOkLinks, respectRobotsTxt },
        { ...restDeps, limitState, timeState, checkPool },
      );
      summaries.push(summary);
    }
  } finally {
    if (graceTimer) clearTimeout(graceTimer);
  }
  return summaries;
}
