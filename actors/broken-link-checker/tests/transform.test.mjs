import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  extractLinks, normalizeUrl, isSameSite, robotsDisallows, classifyResult, mergeOccurrence, classifyFetchError,
  deriveSiteStatus,
} from '../src/transform.js';

const load = (f) => readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8');

// --- extractLinks -----------------------------------------------------------------------------

test('example.com: single external link, data: icon ignored', () => {
  const links = extractLinks(load('example_com.html'), 'https://example.com/');
  assert.equal(links.length, 1);
  assert.equal(links[0].url, 'https://iana.org/domains/example');
  assert.equal(links[0].element, 'a');
  assert.equal(links[0].anchor_text, 'Learn more');
});

test('crawlee.dev: real-world unquoted attributes, self-closing void tags, stylesheet/script/img all found', () => {
  const links = extractLinks(load('crawlee_dev.html'), 'https://crawlee.dev/');
  const byElement = (el) => links.filter((l) => l.element === el);

  assert.ok(byElement('a').length >= 5, 'expected several <a> links');
  assert.ok(links.some((l) => l.url === 'https://crawlee.dev/js' && l.element === 'a'));
  assert.ok(links.some((l) => l.url === 'https://crawlee.dev/python' && l.element === 'a'));
  assert.ok(links.some((l) => l.url === 'https://crawlee.dev/blog'));
  assert.ok(links.some((l) => l.url === 'https://docusaurus.io/docs/docusaurus.config.js/'), 'fragment stripped from quoted href');

  // <link rel=stylesheet href=... /> with unquoted attrs, no closing slash requirement
  assert.ok(links.some((l) => l.element === 'link' && l.url === 'https://crawlee.dev/assets/css/styles.9a26c47a.css'));
  // <link rel=icon> and rel=canonical/alternate must NOT be treated as stylesheets
  assert.ok(!links.some((l) => l.element === 'link' && /favicon|rss|atom/.test(l.url)));

  // <script src=...> (both with and without defer, with/without closing tag)
  assert.ok(links.some((l) => l.element === 'script' && l.url === 'https://crawlee.dev/js/custom.js'));
  assert.ok(links.some((l) => l.element === 'script' && l.url === 'https://crawlee.dev/assets/js/main.90441cdf.js'));

  // <img src=... /> unquoted, self-closing
  assert.ok(links.some((l) => l.element === 'img' && l.url === 'https://crawlee.dev/img/crawlee-light.svg'));

  // anchor text captured and trimmed
  const star = links.find((l) => l.url === 'https://github.com/apify/crawlee');
  assert.equal(star.anchor_text, 'Star');
});

test('tricky fixture: base href, relative "../", fragments, skipped schemes, protocol-relative, srcset ignored', () => {
  const links = extractLinks(load('tricky.html'), 'https://example.com/blog/2026/post/');

  // <base href="https://example.com/blog/2026/"> changes resolution for the whole document
  assert.ok(links.some((l) => l.url === 'https://example.com/blog/about' && l.element === 'a'), 'relative "../about" resolved against <base>');
  assert.ok(links.some((l) => l.url === 'https://example.com/assets/site.css' && l.element === 'link'));

  // fragment stripped, query kept
  assert.ok(links.some((l) => l.url === 'https://example.com/blog/2026/post-42?ref=home'));

  // mailto/tel/javascript/data all skipped entirely
  assert.ok(!links.some((l) => l.url.startsWith('mailto:')));
  assert.ok(!links.some((l) => l.url.startsWith('tel:')));
  assert.ok(!links.some((l) => l.url.startsWith('javascript:')));
  assert.ok(!links.some((l) => l.url.startsWith('data:')));
  assert.equal(links.filter((l) => /Email us|Call us|JS no-op|Data URI/.test(l.anchor_text || '')).length, 0);

  // protocol-relative //cdn resolved to https (base protocol), unquoted attribute value
  assert.ok(links.some((l) => l.url === 'https://cdn.example.com/lib.js' && l.element === 'a'));
  assert.ok(links.some((l) => l.url === 'https://cdn.example.com/logo.png' && l.element === 'img'));

  // srcset must never be read: the srcset-only <img> (no src) contributes nothing
  assert.ok(!links.some((l) => /only-srcset/.test(l.url)));
  assert.ok(!links.some((l) => /logo@2x|logo@3x/.test(l.url)));

  // empty href / no href / inline script (no src) produce nothing
  assert.ok(!links.some((l) => l.anchor_text === 'Empty href'));
  assert.ok(!links.some((l) => l.anchor_text === 'No href at all'));

  // uppercase <A>/<HTML> tags still matched
  assert.ok(links.some((l) => l.anchor_text === 'Uppercase tag, relative parent'));

  // preload link (not rel=stylesheet) must be excluded
  assert.ok(!links.some((l) => /hero\.png/.test(l.url)));
  // plain <script> with no src produces nothing (only real script srcs counted)
  assert.equal(links.filter((l) => l.element === 'script').length, 1);
});

// --- normalizeUrl ------------------------------------------------------------------------------

test('normalizeUrl: resolves relative, strips fragment, keeps query, rejects unsupported schemes', () => {
  assert.equal(normalizeUrl('/a/b?x=1#frag', 'https://example.com/base/'), 'https://example.com/a/b?x=1');
  assert.equal(normalizeUrl('../up', 'https://example.com/a/b/'), 'https://example.com/a/up');
  assert.equal(normalizeUrl('//cdn.example.com/x.js', 'https://example.com/'), 'https://cdn.example.com/x.js');
  assert.equal(normalizeUrl('mailto:a@b.com', 'https://example.com/'), null);
  assert.equal(normalizeUrl('tel:+1234', 'https://example.com/'), null);
  assert.equal(normalizeUrl('javascript:void(0)', 'https://example.com/'), null);
  assert.equal(normalizeUrl('data:text/plain,x', 'https://example.com/'), null);
  assert.equal(normalizeUrl('', 'https://example.com/'), null);
  assert.equal(normalizeUrl(null, 'https://example.com/'), null);
  assert.equal(normalizeUrl('ftp://example.com/f', 'https://example.com/'), null);
});

// --- isSameSite ----------------------------------------------------------------------------------

test('isSameSite: hostname match is www-insensitive, scheme/port/path independent', () => {
  assert.equal(isSameSite('https://www.example.com/a', 'https://example.com/'), true);
  assert.equal(isSameSite('http://example.com/a', 'https://www.example.com/'), true);
  assert.equal(isSameSite('https://blog.example.com/a', 'https://example.com/'), false);
  assert.equal(isSameSite('https://example.org/a', 'https://example.com/'), false);
  assert.equal(isSameSite('not a url', 'https://example.com/'), false);
});

// --- robotsDisallows -----------------------------------------------------------------------------

test('robotsDisallows: user-agent * group, longest-prefix wins, empty Disallow means allowed', () => {
  const robots = [
    'User-agent: Googlebot',
    'Disallow: /',
    '',
    'User-agent: *',
    'Disallow: /private',
    'Allow: /private/public-ok',
    'Disallow: /tmp/',
  ].join('\n');
  assert.equal(robotsDisallows(robots, '/private/secret'), true);
  assert.equal(robotsDisallows(robots, '/private/public-ok'), false, 'more specific Allow wins');
  assert.equal(robotsDisallows(robots, '/tmp/file'), true);
  assert.equal(robotsDisallows(robots, '/blog/post-1'), false);
  assert.equal(robotsDisallows('', '/anything'), false, 'no robots.txt -> nothing disallowed');
});

test('robotsDisallows: bare "Disallow:" with no path means no restriction', () => {
  const robots = 'User-agent: *\nDisallow:\n';
  assert.equal(robotsDisallows(robots, '/whatever'), false);
});

// --- classifyResult ------------------------------------------------------------------------------

test('classifyResult: 404 and 410 are broken', () => {
  assert.deepEqual(classifyResult({ status: 404 }), { is_broken: true, reason: 'http_404', error: null });
  assert.deepEqual(classifyResult({ status: 410 }), { is_broken: true, reason: 'http_410', error: null });
});

test('classifyResult: 500 after retry (still failing) is broken', () => {
  assert.deepEqual(classifyResult({ status: 500 }), { is_broken: true, reason: 'http_500', error: null });
});

test('classifyResult: network failures map to structured, broken errors', () => {
  assert.deepEqual(classifyResult({ errorCode: 'dns_not_found' }), { is_broken: true, reason: 'error_dns_not_found', error: 'dns_not_found' });
  assert.deepEqual(classifyResult({ errorCode: 'timeout' }), { is_broken: true, reason: 'error_timeout', error: 'timeout' });
  assert.deepEqual(classifyResult({ errorCode: 'connection_refused' }), { is_broken: true, reason: 'error_connection_refused', error: 'connection_refused' });
  assert.deepEqual(classifyResult({ errorCode: 'redirect_loop' }), { is_broken: true, reason: 'error_redirect_loop', error: 'redirect_loop' });
  assert.deepEqual(classifyResult({ errorCode: 'too_many_redirects' }), { is_broken: true, reason: 'error_too_many_redirects', error: 'too_many_redirects' });
});

test('classifyResult: 429 is never broken ("do not cry wolf")', () => {
  assert.deepEqual(
    classifyResult({ status: 429, errorCode: 'rate_limited' }),
    { is_broken: false, reason: 'rate_limited_unverified', error: null },
  );
});

test('classifyResult: 301 -> 200 is ok, with an ok_after_redirect reason', () => {
  assert.deepEqual(classifyResult({ status: 200, redirectCount: 1 }), { is_broken: false, reason: 'ok_after_redirect', error: null });
  assert.deepEqual(classifyResult({ status: 200, redirectCount: 0 }), { is_broken: false, reason: 'ok', error: null });
});

// --- mergeOccurrence -------------------------------------------------------------------------------

test('mergeOccurrence: counts distinct pages (not raw occurrences), keeps first page/anchor, caps sample at 5 uniques', () => {
  let agg = null;
  agg = mergeOccurrence(agg, { found_on_url: 'https://x.com/p1', anchor_text: null });
  agg = mergeOccurrence(agg, { found_on_url: 'https://x.com/p2', anchor_text: 'Second anchor' });
  // A link repeated many times on the same page (e.g. a nav dropdown) must not inflate the count.
  agg = mergeOccurrence(agg, { found_on_url: 'https://x.com/p2', anchor_text: 'Repeated on same page' });
  agg = mergeOccurrence(agg, { found_on_url: 'https://x.com/p2', anchor_text: 'Repeated on same page again' });
  for (let i = 3; i <= 10; i += 1) {
    agg = mergeOccurrence(agg, { found_on_url: `https://x.com/p${i}`, anchor_text: null });
  }
  // One more occurrence on a page already seen after the 5-sample cap must still not double-count.
  agg = mergeOccurrence(agg, { found_on_url: 'https://x.com/p2', anchor_text: null });

  assert.equal(agg.found_on_url, 'https://x.com/p1', 'first page is sticky');
  assert.equal(agg.found_on_count, 10, 'counts distinct pages, not raw link occurrences');
  assert.equal(agg.found_on_sample.length, 5);
  assert.deepEqual(agg.found_on_sample, ['https://x.com/p1', 'https://x.com/p2', 'https://x.com/p3', 'https://x.com/p4', 'https://x.com/p5']);
  assert.equal(agg.anchor_text, 'Second anchor', 'first non-empty anchor text wins');
});

// --- classifyFetchError ---------------------------------------------------------------------------

test('classifyFetchError: maps common transport failures', () => {
  assert.equal(classifyFetchError({ name: 'TimeoutError' }), 'timeout');
  assert.equal(classifyFetchError({ name: 'AbortError' }), 'timeout');
  assert.equal(classifyFetchError({ cause: { code: 'ENOTFOUND' } }), 'dns_not_found');
  assert.equal(classifyFetchError({ cause: { code: 'ECONNREFUSED' } }), 'connection_refused');
  assert.equal(classifyFetchError({ cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } }), 'tls_error');
  assert.equal(classifyFetchError({ cause: { code: 'CERT_HAS_EXPIRED' } }), 'tls_error');
  assert.equal(classifyFetchError({ cause: { code: 'ECONNRESET' } }), 'connection_refused');
  assert.equal(classifyFetchError({ name: 'TypeError', message: 'fetch failed' }), null);
  assert.equal(classifyFetchError(null), null);
});

// --- deriveSiteStatus ------------------------------------------------------------------------------

test('deriveSiteStatus: defaults to completed, unreachable beats every other flag', () => {
  assert.equal(deriveSiteStatus(), 'completed');
  assert.equal(deriveSiteStatus({}), 'completed');
  assert.equal(
    deriveSiteStatus({ unreachable: true, chargeLimitReached: true, timeLimitReached: true, pageLimitReached: true }),
    'start_url_unreachable',
  );
});

test('deriveSiteStatus: charge limit outranks time limit, which outranks page limit', () => {
  assert.equal(deriveSiteStatus({ chargeLimitReached: true, timeLimitReached: true, pageLimitReached: true }), 'charge_limit_reached');
  assert.equal(deriveSiteStatus({ timeLimitReached: true, pageLimitReached: true }), 'time_limit_reached');
  assert.equal(deriveSiteStatus({ pageLimitReached: true }), 'page_limit_reached');
});
