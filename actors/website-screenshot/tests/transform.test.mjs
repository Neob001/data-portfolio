import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeUrl, dedupeUrls, screenshotKey, contentTypeFor, screenshotUrlFor,
  classifyNavigationError, cookieBannerCss, COOKIE_BANNER_SELECTORS, deviceViewport, buildRow,
} from '../src/transform.js';

// Apify rejects dataset pushes that violate .actor/actor.json field schemas (a staging run
// crashing on this is exactly the failure mode we are guarding against here), so every row built
// in these tests is checked against the declared types and enums, same as broken-link-checker.
const DATASET_FIELDS = JSON.parse(readFileSync(new URL('../.actor/actor.json', import.meta.url), 'utf8')).storages.dataset.fields.properties;
function assertMatchesSchema(row) {
  for (const [key, value] of Object.entries(row)) {
    const spec = DATASET_FIELDS[key];
    if (!spec) continue;
    const types = [].concat(spec.type);
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const ok = types.includes(actual) || (actual === 'integer' && types.includes('number'));
    assert.ok(ok, `field ${key}=${JSON.stringify(value)} is ${actual}, schema allows ${types}`);
    if (spec.enum && !spec.enum.includes(value)) assert.fail(`field ${key}=${JSON.stringify(value)} not in enum ${JSON.stringify(spec.enum)}`);
  }
}

test('normalizeUrl: accepts bare domains and http(s), rejects everything else', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUrl('http://Example.com/a?b=1'), 'http://example.com/a?b=1');
  assert.equal(normalizeUrl('https://apify.com'), 'https://apify.com/');
  assert.equal(normalizeUrl('ftp://example.com'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('localhost'), null);
  assert.equal(normalizeUrl('not a url at all'), null);
  assert.equal(normalizeUrl(''), null);
  assert.equal(normalizeUrl(null), null);
});

test('dedupeUrls: normalizes, dedupes valid URLs, and reports each bad input once', () => {
  const { valid, invalid } = dedupeUrls([
    'https://example.com',
    'example.com',
    'https://EXAMPLE.com/',
    'https://apify.com',
    'not a url',
    'not a url',
    'ftp://bad.example',
  ]);
  assert.deepEqual(valid, ['https://example.com/', 'https://apify.com/']);
  assert.deepEqual(invalid, ['not a url', 'ftp://bad.example']);
});

test('dedupeUrls: empty/missing input yields no valid or invalid entries', () => {
  assert.deepEqual(dedupeUrls([]), { valid: [], invalid: [] });
  assert.deepEqual(dedupeUrls(undefined), { valid: [], invalid: [] });
});

test('screenshotKey: stable per url+format, differs across formats, matching extension', () => {
  const pngKey = screenshotKey('https://example.com/', 'png');
  const pngKeyAgain = screenshotKey('https://example.com/', 'png');
  const jpegKey = screenshotKey('https://example.com/', 'jpeg');
  assert.equal(pngKey, pngKeyAgain);
  assert.notEqual(pngKey, jpegKey);
  assert.match(pngKey, /^[0-9a-f]{40}\.png$/);
  assert.match(jpegKey, /^[0-9a-f]{40}\.jpg$/);
});

test('contentTypeFor: maps image format to MIME type', () => {
  assert.equal(contentTypeFor('png'), 'image/png');
  assert.equal(contentTypeFor('jpeg'), 'image/jpeg');
});

test('screenshotUrlFor: builds the public key-value-store record URL', () => {
  assert.equal(
    screenshotUrlFor('abcXYZ123', 'deadbeef.png'),
    'https://api.apify.com/v2/key-value-stores/abcXYZ123/records/deadbeef.png',
  );
});

test('classifyNavigationError: status codes take priority over message sniffing', () => {
  assert.equal(classifyNavigationError(new Error('boom'), 403), 'blocked');
  assert.equal(classifyNavigationError(new Error('boom'), 429), 'blocked');
  assert.equal(classifyNavigationError(new Error('boom'), 404), 'http_error');
  assert.equal(classifyNavigationError(new Error('boom'), 500), 'http_error');
});

test('classifyNavigationError: message-based classification for navigation failures', () => {
  assert.equal(classifyNavigationError(new Error('net::ERR_NAME_NOT_RESOLVED at https://nx.example')), 'dns_error');
  assert.equal(classifyNavigationError(new Error('getaddrinfo ENOTFOUND nx.example')), 'dns_error');
  assert.equal(classifyNavigationError(new Error('Navigation timeout of 30000 ms exceeded')), 'navigation_timeout');
  assert.equal(classifyNavigationError({ name: 'TimeoutError', message: 'Waiting failed: 30000ms exceeded' }), 'navigation_timeout');
  assert.equal(classifyNavigationError(new Error('net::ERR_BLOCKED_BY_CLIENT at https://ads.example')), 'blocked');
  assert.equal(classifyNavigationError(new Error('net::ERR_CONNECTION_REFUSED')), 'http_error');
});

test('cookieBannerCss: hides selectors, never contains a click/accept action', () => {
  const css = cookieBannerCss();
  assert.ok(css.includes('display: none !important'));
  assert.ok(!/accept/i.test(css), 'must never reference clicking accept');
  for (const sel of COOKIE_BANNER_SELECTORS) assert.ok(css.includes(sel));
});

test('deviceViewport: mobile preset is 390x844 @3x with a mobile UA; desktop uses requested size', () => {
  const mobile = deviceViewport({ device: 'mobile', viewportWidth: 1280, viewportHeight: 800 });
  assert.deepEqual(mobile.viewport, { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  assert.match(mobile.userAgent, /Mobile/);

  const desktop = deviceViewport({ device: 'desktop', viewportWidth: 1440, viewportHeight: 900 });
  assert.deepEqual(desktop.viewport, { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
  assert.equal(desktop.userAgent, null);

  const defaults = deviceViewport({});
  assert.equal(defaults.viewport.width, 1280);
  assert.equal(defaults.viewport.height, 800);
});

test('buildRow: success row matches the declared dataset schema', () => {
  const row = buildRow({
    url: 'https://example.com/',
    format: 'png',
    ok: true,
    statusCode: 200,
    finalUrl: 'https://example.com/',
    capture: {
      key: screenshotKey('https://example.com/', 'png'),
      screenshotUrl: 'https://api.apify.com/v2/key-value-stores/abc/records/x.png',
      width: 1280,
      height: 940,
      bytes: 12345,
      pageTitle: 'Example Domain',
      takenAt: '2026-09-18T12:00:00.000Z',
    },
  });
  assertMatchesSchema(row);
  assert.equal(row.ok, true);
  assert.equal(row.error, null);
  assert.equal(row.width, 1280);
  assert.equal(row.page_title, 'Example Domain');
});

test('buildRow: failure rows (invalid_url, navigation_timeout, dns_error, http_error, blocked) all match the schema', () => {
  for (const error of ['invalid_url', 'navigation_timeout', 'dns_error', 'http_error', 'blocked']) {
    const row = buildRow({ url: 'https://nx.example/', format: 'jpeg', ok: false, statusCode: null, error });
    assertMatchesSchema(row);
    assert.equal(row.ok, false);
    assert.equal(row.error, error);
    assert.equal(row.screenshot_key, null);
    assert.equal(row.screenshot_url, null);
    assert.equal(row.width, null);
    assert.equal(row.bytes, null);
  }
});

test('buildRow: an unknown/garbage error value would fail the schema guard (sanity check on the guard itself)', () => {
  const row = buildRow({ url: 'https://nx.example/', format: 'png', ok: false, error: 'totally_made_up' });
  assert.throws(() => assertMatchesSchema(row), /not in enum/);
});
