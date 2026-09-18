import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import http from 'node:http';
import { crawlSite, runCrawl, createHostPool } from '../src/crawler.js';

// Apify rejects dataset pushes that violate .actor/actor.json field schemas (staging run 2026-09-15 failed on
// an enum), so every row produced in these tests is checked against the declared types and enums.
const DATASET_FIELDS = JSON.parse(readFileSync(new URL('../.actor/actor.json', import.meta.url), 'utf8')).storages.dataset.fields.properties;
function assertMatchesSchema(row) {
  for (const [key, value] of Object.entries(row)) {
    const spec = DATASET_FIELDS[key];
    if (!spec) continue;
    const types = [].concat(spec.type);
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const ok = types.includes(actual) || (actual === 'integer' && types.includes('number'));
    assert.ok(ok, `field ${key}=${JSON.stringify(value)} is ${actual}, schema allows ${types}`);
    if (spec.enum && value !== null) assert.ok(spec.enum.includes(value), `field ${key}=${value} not in enum ${spec.enum}`);
  }
}


/** A port nothing listens on, for a deterministic connection_refused link/start-URL. */
async function unusedPort() {
  return new Promise((resolve) => {
    const s = http.createServer(() => {});
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Build+start a node:http fixture site. `extraHomeLinks` lets a test inject links that need a
 * value only known at test time (e.g. a dead port). Returns { url, requestLog, close }. */
function startFixtureSite(extraHomeLinks = '') {
  const requestLog = [];
  const html = (body) => ({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body });
  const routes = {
    '/': () => html(`<html><body>
      <a href="/page-b">Page B</a>
      <a href="/missing">Missing page</a>
      <a href="/broken">Broken endpoint</a>
      <a href="/redirect-start">Redirect chain</a>
      <a href="/private/secret">Private</a>
      <a href="/rate-limited">Rate limited</a>
      ${extraHomeLinks}
      <img src="/img.png" alt="logo">
    </body></html>`),
    '/page-b': () => html('<html><body><a href="/page-c">Page C</a><a href="/">Home</a></body></html>'),
    '/page-c': () => html('<html><body>No more links here.</body></html>'),
    '/missing': () => ({ status: 404, headers: {}, body: 'not found' }),
    '/broken': () => ({ status: 500, headers: {}, body: 'boom' }),
    '/redirect-start': () => ({ status: 302, headers: { location: '/redirect-mid' }, body: '' }),
    '/redirect-mid': () => ({ status: 302, headers: { location: '/redirect-final' }, body: '' }),
    '/redirect-final': () => html('<html><body>Landed.</body></html>'),
    '/private/secret': () => html('<html><body><a href="/private/should-not-be-crawled">Nested</a></body></html>'),
    '/private/should-not-be-crawled': () => html('<html><body>Should never be requested.</body></html>'),
    '/rate-limited': () => ({ status: 429, headers: { 'retry-after': '0' }, body: '' }),
    '/img.png': () => ({ status: 200, headers: { 'content-type': 'image/png' }, body: 'fake-png-bytes' }),
    '/robots.txt': () => ({ status: 200, headers: { 'content-type': 'text/plain' }, body: 'User-agent: *\nDisallow: /private/\n' }),
  };
  const server = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    requestLog.push({ method: req.method, path: pathname });
    const route = routes[pathname];
    if (!route) { res.writeHead(404); res.end('no route'); return; }
    const { status, headers, body } = route();
    res.writeHead(status, headers);
    if (req.method === 'HEAD') res.end();
    else res.end(body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, requestLog, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const summaryRowOf = (rows) => rows.find((r) => r.record_type === 'site_summary');

test('end-to-end crawl: 404, 500-after-retry, redirect chain, robots-respected, external connection_refused, rate-limited, images, always-on summary', async () => {
  const deadPort = await unusedPort();
  // "localhost" also resolves to loopback but is a *different hostname* from the site's
  // "127.0.0.1", so isSameSite correctly classifies it as external while still hitting a
  // deterministically closed port (ECONNREFUSED) with no real network dependency.
  const externalUrl = `http://localhost:${deadPort}/ext`;
  const site = await startFixtureSite(`<a href="${externalUrl}">External dead link</a>`);

  const rows = [];
  let chargeCalls = 0;
  const summary = await crawlSite(
    site.url,
    { maxPagesPerSite: 10, checkExternalLinks: true, checkImagesAndAssets: true, includeOkLinks: true, respectRobotsTxt: true },
    {
      fetchImpl: fetch,
      pushData: async (row) => { assertMatchesSchema(row); rows.push(row); },
      charge: async () => { chargeCalls += 1; return { eventChargeLimitReached: false }; },
      timeoutMs: 3000,
      concurrency: 3,
    },
  );

  await site.close();

  const byUrl = (path) => rows.find((r) => r.link_url === new URL(path, site.url).toString());

  // Pages actually crawled: /, /page-b, /page-c, /redirect-start (counts once despite 2 hops).
  assert.equal(summary.pages_scanned, 4);
  assert.equal(chargeCalls, 4);
  assert.equal(summary.status, 'completed');

  // 404
  const missing = byUrl('/missing');
  assert.equal(missing.record_type, 'broken_link');
  assert.equal(missing.is_broken, true);
  assert.equal(missing.status_code, 404);
  assert.equal(missing.reason, 'http_404');
  assert.equal(missing.link_type, 'internal');
  assert.equal(missing.element, 'a');
  assert.equal(missing.found_on_url, site.url);

  // 500, still failing after the one retry
  const broken = byUrl('/broken');
  assert.equal(broken.is_broken, true);
  assert.equal(broken.status_code, 500);
  assert.equal(broken.reason, 'http_500');
  assert.equal(site.requestLog.filter((r) => r.path === '/broken').length, 2, 'exactly one retry on 5xx');

  // Redirect chain: 2 hops, final 200, ok
  const redir = byUrl('/redirect-start');
  assert.equal(redir.record_type, 'ok_link');
  assert.equal(redir.is_broken, false);
  assert.equal(redir.status_code, 200);
  assert.equal(redir.redirect_count, 2);
  assert.equal(redir.final_url, new URL('/redirect-final', site.url).toString());
  assert.equal(redir.reason, 'ok_after_redirect');

  // robots.txt: /private/secret is checked (linked-to) but never crawled, so its own outbound
  // link to /private/should-not-be-crawled must never appear, and that path never requested.
  const secret = byUrl('/private/secret');
  assert.ok(secret, 'private/secret is still checked even though crawling it is disallowed');
  assert.equal(secret.is_broken, false);
  assert.equal(byUrl('/private/should-not-be-crawled'), undefined);
  assert.ok(!site.requestLog.some((r) => r.path === '/private/should-not-be-crawled'));

  // External connection-refused link
  const ext = rows.find((r) => r.link_url === externalUrl);
  assert.equal(ext.is_broken, true);
  assert.equal(ext.error, 'connection_refused');
  assert.equal(ext.link_type, 'external');
  assert.equal(ext.status_code, null);

  // 429 is reported but never marked broken
  const limited = byUrl('/rate-limited');
  assert.equal(limited.status_code, 429);
  assert.equal(limited.is_broken, false);
  assert.equal(limited.reason, 'rate_limited_unverified');
  assert.equal(limited.error, null);

  // Image asset checked (HEAD, not crawled as a page)
  const img = byUrl('/img.png');
  assert.equal(img.is_broken, false);
  assert.equal(img.element, 'img');
  assert.equal(site.requestLog.some((r) => r.path === '/img.png' && r.method === 'HEAD'), true);

  // stamp() fields present on every row
  for (const r of rows) {
    assert.equal(typeof r.source_url, 'string');
    assert.match(r.fetched_at, /^\d{4}-\d{2}-\d{2}T/);
  }

  assert.equal(summary.broken_links, rows.filter((r) => r.record_type === 'broken_link').length);

  // Always-on site_summary row: this is what keeps Apify's daily auto-test (which requires a
  // non-empty dataset on the default input) from marking a perfectly healthy Actor "under
  // maintenance" just because includeOkLinks was left off and there happened to be no broken
  // links -- here there ARE broken links, but the summary row must still be present and correct.
  const summaryRow = summaryRowOf(rows);
  assert.ok(summaryRow, 'a site_summary row is always pushed');
  assert.equal(summaryRow.site, site.url);
  assert.equal(summaryRow.start_url, site.url);
  assert.equal(summaryRow.status, 'completed');
  assert.equal(summaryRow.pages_scanned, 4);
  assert.equal(summaryRow.broken_links, summary.broken_links);
  assert.equal(summaryRow.rate_limited_unverified, 1);
  assert.ok(summaryRow.external_links_checked >= 1);
  assert.ok(Array.isArray(summaryRow.top_broken) && summaryRow.top_broken.length >= 1 && summaryRow.top_broken.length <= 10);
  assert.ok(summaryRow.top_broken.includes(externalUrl));
});

test('a healthy site with includeOkLinks=false still produces a non-empty dataset via the summary row', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body><a href="/ok">Fine</a></body></html>'); return; }
    if (req.url === '/ok') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>fine</body></html>'); return; }
    res.writeHead(404); res.end();
  });
  const siteUrl = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`)));

  const rows = [];
  const summary = await crawlSite(siteUrl, { includeOkLinks: false }, {
    fetchImpl: fetch, pushData: async (r) => { assertMatchesSchema(r); rows.push(r); }, charge: async () => ({ eventChargeLimitReached: false }), timeoutMs: 2000,
  });

  await new Promise((r) => server.close(r));

  assert.equal(summary.broken_links, 0);
  assert.equal(rows.length, 1, 'no broken/ok rows, but exactly the summary row');
  assert.equal(rows[0].record_type, 'site_summary');
  assert.equal(rows[0].status, 'completed');
});

test('checkExternalLinks:false and checkImagesAndAssets:false filter those links out entirely, summary row still pushed', async () => {
  const html = '<html><body><a href="/ok">Internal</a><a href="https://elsewhere.invalid/x">External</a><img src="/pic.png"></body></html>';
  const server = http.createServer((req, res) => {
    if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
    if (req.url === '/ok') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>ok</body></html>'); return; }
    if (req.url === '/pic.png') { res.writeHead(200, { 'content-type': 'image/png' }); res.end('x'); return; }
    res.writeHead(404); res.end();
  });
  const siteUrl = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`)));

  const rows = [];
  await crawlSite(siteUrl, {
    maxPagesPerSite: 10, checkExternalLinks: false, checkImagesAndAssets: false, includeOkLinks: true, respectRobotsTxt: false,
  }, { fetchImpl: fetch, pushData: async (r) => { assertMatchesSchema(r); rows.push(r); }, charge: async () => ({ eventChargeLimitReached: false }), timeoutMs: 2000 });

  await new Promise((r) => server.close(r));

  assert.ok(rows.some((r) => r.link_url === new URL('/ok', siteUrl).toString()));
  assert.ok(!rows.some((r) => r.link_type === 'external'));
  assert.ok(!rows.some((r) => r.element === 'img'));
  assert.ok(summaryRowOf(rows), 'summary row present even when some link kinds are filtered out');
});

test('start URL unreachable (connection refused) produces a broken_link row plus a start_url_unreachable summary, no charge', async () => {
  const deadPort = await unusedPort();
  const rows = [];
  let chargeCalls = 0;
  const summary = await crawlSite(`http://127.0.0.1:${deadPort}/`, {}, {
    fetchImpl: fetch,
    pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
    charge: async () => { chargeCalls += 1; return { eventChargeLimitReached: false }; },
    timeoutMs: 2000,
  });

  assert.equal(chargeCalls, 0);
  assert.equal(rows.length, 2, 'one broken_link row plus one site_summary row');
  const brokenRow = rows.find((r) => r.record_type === 'broken_link');
  assert.equal(brokenRow.reason, 'start_url_unreachable');
  assert.equal(brokenRow.is_broken, true);
  assert.equal(brokenRow.link_url, `http://127.0.0.1:${deadPort}/`);

  const summaryRow = summaryRowOf(rows);
  assert.equal(summaryRow.status, 'start_url_unreachable');
  assert.equal(summaryRow.broken_links, 1);
  assert.equal(summary.status, 'start_url_unreachable');
  assert.equal(summary.pages_scanned, 0);
  assert.equal(summary.broken_links, 1);
});

test('eventChargeLimitReached stops the crawl promptly and is reflected in the summary status', async () => {
  // A larger fan-out than the old exact-one-page test: charging is now decoupled from the crawl
  // loop (it waits on a page's own link checks without blocking the loop from moving on), so the
  // limit can propagate one page late. The meaningful guarantee is that it stops soon, not that
  // it stops after literally the very first page.
  const server = http.createServer((req, res) => {
    const n = Number((req.url.match(/^\/page(\d+)$/) || [])[1]);
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>' + Array.from({ length: 8 }, (_, i) => `<a href="/page${i}">p${i}</a>`).join('') + '<a href="/dead-link">Dead</a></body></html>');
      return;
    }
    if (Number.isInteger(n)) { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>leaf</body></html>'); return; }
    if (req.url === '/dead-link') { res.writeHead(404); res.end(); return; }
    res.writeHead(404); res.end();
  });
  const siteUrl = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`)));

  const rows = [];
  let chargeCalls = 0;
  const summary = await crawlSite(siteUrl, { maxPagesPerSite: 50, includeOkLinks: true }, {
    fetchImpl: fetch,
    pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
    charge: async () => { chargeCalls += 1; return { eventChargeLimitReached: true }; }, // limit hits on the very first charge
    timeoutMs: 2000,
  });

  await new Promise((r) => server.close(r));

  assert.ok(chargeCalls <= 2, `expected the crawl to stop within a page or two of the limit, saw ${chargeCalls} charges`);
  assert.ok(summary.pages_scanned < 9, 'did not crawl all 9 pages once the limit was hit');
  assert.equal(summary.status, 'charge_limit_reached');
  assert.equal(summaryRowOf(rows).status, 'charge_limit_reached');
});

test('runCrawl: a global charge-limit hit on the first site short-circuits later sites (each still gets a summary row)', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html><body>no links</body></html>');
  });
  const siteUrl = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`)));

  const rows = [];
  const summaries = await runCrawl(
    { startUrls: [siteUrl, siteUrl], maxPagesPerSite: 5 },
    {
      fetchImpl: fetch,
      pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
      charge: async () => ({ eventChargeLimitReached: true }),
      timeoutMs: 2000,
    },
  );

  await new Promise((r) => server.close(r));

  assert.equal(summaries.length, 2);
  assert.equal(summaries[0].pages_scanned, 1);
  assert.equal(summaries[1].pages_scanned, 0, 'second site is a no-op once the run-wide charge limit is reached');
  assert.equal(summaries[1].status, 'charge_limit_reached');
  const summaryRows = rows.filter((r) => r.record_type === 'site_summary');
  assert.equal(summaryRows.length, 2, 'every site gets its own summary row, including the short-circuited one');
});

test('createHostPool: enforces both the global cap and the per-host cap simultaneously', async () => {
  const pool = createHostPool({ globalLimit: 3, perHostLimit: 2 });
  let activeTotal = 0;
  let maxActiveTotal = 0;
  const activeByHost = new Map();
  let maxActiveHostA = 0;

  const makeTask = (host) => async () => {
    activeTotal += 1;
    maxActiveTotal = Math.max(maxActiveTotal, activeTotal);
    const h = (activeByHost.get(host) || 0) + 1;
    activeByHost.set(host, h);
    if (host === 'a') maxActiveHostA = Math.max(maxActiveHostA, h);
    await new Promise((r) => setTimeout(r, 40));
    activeTotal -= 1;
    activeByHost.set(host, activeByHost.get(host) - 1);
    return host;
  };

  const promises = [];
  for (let i = 0; i < 5; i += 1) promises.push(pool.add('a', makeTask('a')));
  for (let i = 0; i < 2; i += 1) promises.push(pool.add('b', makeTask('b')));

  const results = await Promise.all(promises);
  await pool.whenIdle();

  assert.equal(results.length, 7);
  assert.ok(maxActiveTotal <= 3, `global cap violated: saw ${maxActiveTotal} concurrent tasks`);
  assert.ok(maxActiveHostA <= 2, `per-host cap violated: saw ${maxActiveHostA} concurrent tasks for host "a"`);
  assert.equal(pool.pendingCount, 0);
});

test('external checks run concurrently with the internal crawl, not serialized behind it', async () => {
  const EXTERNAL_DELAY_MS = 400;
  const INTERNAL_DELAY_MS = 200;
  const INTERNAL_PAGES = 3; // home + 2 more, each discovered only once the previous one loads

  const external = http.createServer((req, res) => {
    setTimeout(() => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); }, EXTERNAL_DELAY_MS);
  });
  const externalUrl = await new Promise((resolve) => external.listen(0, '127.0.0.1', () => resolve(`http://localhost:${external.address().port}/`)));

  const site = http.createServer((req, res) => {
    const delay = (fn) => setTimeout(fn, INTERNAL_DELAY_MS);
    if (req.url === '/') {
      delay(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        // 3 external links on the same host, discovered immediately from the home page.
        res.end(`<html><body><a href="/p1">p1</a><a href="${externalUrl}a">e1</a><a href="${externalUrl}b">e2</a><a href="${externalUrl}c">e3</a></body></html>`);
      });
      return;
    }
    if (req.url === '/p1') { delay(() => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body><a href="/p2">p2</a></body></html>'); }); return; }
    if (req.url === '/p2') { delay(() => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>leaf</body></html>'); }); return; }
    res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
  });
  const siteUrl = await new Promise((resolve) => site.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${site.address().port}/`)));

  const started = Date.now();
  const summary = await crawlSite(siteUrl, { maxPagesPerSite: INTERNAL_PAGES, checkExternalLinks: true, includeOkLinks: true }, {
    fetchImpl: fetch,
    pushData: async () => {},
    charge: async () => ({ eventChargeLimitReached: false }),
    timeoutMs: 5000,
    checkPool: createHostPool({ globalLimit: 24, perHostLimit: 4 }),
  });
  const elapsed = Date.now() - started;

  await Promise.all([new Promise((r) => site.close(r)), new Promise((r) => external.close(r))]);

  const serialWorstCase = INTERNAL_PAGES * INTERNAL_DELAY_MS + EXTERNAL_DELAY_MS; // ~1000ms if serialized
  const concurrentExpected = INTERNAL_PAGES * INTERNAL_DELAY_MS; // ~600ms if external overlaps the crawl
  assert.ok(
    elapsed < (serialWorstCase + concurrentExpected) / 2,
    `expected external checks to overlap the internal crawl (~${concurrentExpected}ms), took ${elapsed}ms (serialized worst case ~${serialWorstCase}ms)`,
  );
  assert.equal(summary.pages_scanned, INTERNAL_PAGES);
  assert.equal(summary.external_links_checked, 3);
  assert.equal(summary.broken_links, 0);
});

test('maxRunMinutes: once the deadline has passed, a page still crawls fine but its links are never submitted, so it is never charged', async () => {
  const DEADLINE_MS = 40;
  const HOME_DELAY_MS = 250; // resolves well after the deadline has already passed
  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html><body><a href="/never-crawled">Never</a><a href="https://also-never.invalid/x">Never checked</a></body></html>');
      }, HOME_DELAY_MS);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html><body>ok</body></html>');
  });
  const siteUrl = await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}/`)));

  const rows = [];
  let chargeCalls = 0;
  const summaries = await runCrawl(
    { startUrls: [siteUrl], maxPagesPerSite: 50, maxRunMinutes: DEADLINE_MS / 60000 },
    {
      fetchImpl: fetch,
      pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
      charge: async () => { chargeCalls += 1; return { eventChargeLimitReached: false }; },
      timeoutMs: 2000,
      graceMs: 300,
    },
  );

  await new Promise((r) => server.close(r));

  assert.equal(chargeCalls, 0, 'the deadline had already passed by the time home\'s links were extracted, so none were submitted');
  assert.equal(summaries[0].pages_scanned, 1, 'the page itself was still successfully crawled');
  assert.equal(summaries[0].status, 'time_limit_reached');
  assert.equal(summaryRowOf(rows).status, 'time_limit_reached');
  assert.ok(!rows.some((r) => r.link_url && r.link_url.includes('never-crawled')), 'never-crawled was discovered too late to be enqueued');
});

test('maxRunMinutes: a check still in flight at deadline+grace is aborted, never reported as broken, and its page is not charged', async () => {
  const slow = http.createServer((req, res) => {
    setTimeout(() => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok'); }, 3000);
  });
  const slowUrl = await new Promise((resolve) => slow.listen(0, '127.0.0.1', () => resolve(`http://localhost:${slow.address().port}/slow`)));

  const site = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<html><body><a href="${slowUrl}">Slow external</a></body></html>`);
      return;
    }
    res.writeHead(404); res.end();
  });
  const siteUrl = await new Promise((resolve) => site.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${site.address().port}/`)));

  const rows = [];
  let chargeCalls = 0;
  const started = Date.now();
  const summaries = await runCrawl(
    { startUrls: [siteUrl], maxPagesPerSite: 50, maxRunMinutes: 30 / 60000 }, // deadline ~30ms out
    {
      fetchImpl: fetch,
      pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
      charge: async () => { chargeCalls += 1; return { eventChargeLimitReached: false }; },
      timeoutMs: 10000, // longer than the grace period -- only the wind-down abort can cut this off
      graceMs: 300,
    },
  );
  const elapsed = Date.now() - started;

  await Promise.all([new Promise((r) => site.close(r)), new Promise((r) => slow.close(r))]);

  // The wind-down signal cuts the 3s hang short at deadline+grace (~330ms). An interrupted check
  // is unknown, not broken: no row for it, and the page whose links were not all checked is free.
  assert.ok(elapsed < 2000, `expected the wind-down abort to cut the 3s hang short, took ${elapsed}ms`);
  assert.equal(chargeCalls, 0);
  assert.equal(rows.find((r) => r.link_url === slowUrl), undefined);
  assert.equal(summaries[0].broken_links, 0);
  assert.equal(summaries[0].status, 'time_limit_reached');
});
