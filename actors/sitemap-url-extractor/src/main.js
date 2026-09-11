import { Actor } from 'apify';
import { rateLimiter, FetchError } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { parseSitemap, sitemapsFromRobots, DEFAULT_SITEMAP_PATHS } from './transform.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; factpipe-sitemap/1.0)' };
const MAX_CHILD_SITEMAPS = 50;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { websiteUrls = [], checkStatus = false, maxUrlsPerSite = 2000 } = input;

if (!Array.isArray(websiteUrls) || websiteUrls.length === 0) {
  throw new Error('Provide "websiteUrls": site roots or direct sitemap URLs.');
}

const limit = rateLimiter(300);

async function get(url, asText = true) {
  await limit();
  const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new FetchError(`HTTP ${res.status} at ${url}`, res.status >= 500 ? 'site_down' : 'http_error', res.status);
  return asText ? res.text() : res;
}

async function headStatus(url) {
  try {
    await limit();
    const res = await fetch(url, { method: 'HEAD', headers: UA, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    return res.status;
  } catch { return null; }
}

let pushed = 0;
let charged = 0;
let misses = 0;

try {
  for (const raw of websiteUrls) {
    const inputUrl = String(raw || '').trim();
    if (!inputUrl) continue;
    const url = /^https?:\/\//i.test(inputUrl) ? inputUrl : `https://${inputUrl}`;
    const origin = new URL(url).origin;

    // Resolve entry sitemaps: direct XML input > robots.txt > default paths.
    let entrySitemaps = [];
    if (/\.xml(\?.*)?$/i.test(url)) entrySitemaps = [url];
    if (entrySitemaps.length === 0) {
      try { entrySitemaps = sitemapsFromRobots(await get(`${origin}/robots.txt`)); } catch { /* fall through */ }
    }
    if (entrySitemaps.length === 0) {
      for (const p of DEFAULT_SITEMAP_PATHS) {
        try { await get(origin + p); entrySitemaps = [origin + p]; break; } catch { /* next */ }
      }
    }
    if (entrySitemaps.length === 0) {
      await Actor.pushData(stamp({ site: inputUrl, found: false, reason: 'no_sitemap_found' }, origin));
      misses += 1; // never charged
      continue;
    }

    // Walk index sitemaps one level deep; collect url entries.
    let siteCount = 0;
    const queue = [...entrySitemaps.slice(0, MAX_CHILD_SITEMAPS)];
    const visited = new Set();
    while (queue.length > 0 && siteCount < maxUrlsPerSite) {
      const smUrl = queue.shift();
      if (visited.has(smUrl)) continue;
      visited.add(smUrl);
      let parsed;
      try {
        parsed = parseSitemap(await get(smUrl));
      } catch (e) {
        if (e.failureClass === 'schema_change' || (e instanceof FetchError && e.status && e.status < 500)) continue;
        throw e;
      }
      if (parsed.kind === 'index') {
        for (const s of parsed.entries.slice(0, MAX_CHILD_SITEMAPS)) queue.push(s.loc);
        continue;
      }
      for (const entry of parsed.entries) {
        if (siteCount >= maxUrlsPerSite) break;
        const status = checkStatus ? await headStatus(entry.loc) : null;
        await Actor.pushData(stamp({
          site: inputUrl, found: true, sitemap_url: smUrl, url: entry.loc,
          lastmod: entry.lastmod, changefreq: entry.changefreq, priority: entry.priority,
          http_status: status, ok: status === null ? null : status >= 200 && status < 400,
        }, smUrl));
        pushed += 1;
        siteCount += 1;
        // PPE: charge per URL row delivered; sites without sitemaps are free.
        const { eventChargeLimitReached } = await Actor.charge({ eventName: 'url-result' });
        charged += 1;
        if (eventChargeLimitReached) {
          await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
          await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
        }
      }
    }
    if (siteCount === 0) {
      await Actor.pushData(stamp({ site: inputUrl, found: false, reason: 'sitemaps_empty' }, origin));
      misses += 1;
    }
  }
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed + misses, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
