import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { loadEngine } from '../src/detect.js';
import { analyzeTarget } from '../src/pipeline.js';
import { fetchPage, pickCharset, MAX_REDIRECTS } from '../src/fetch.js';
import { dedupeTargets, sanitizeCategoriesFilter, isChargeable } from '../src/transform.js';
import { FIXTURES, load, fakeFetch, fakeDns, page, netError, assertMatchesSchema, stamped } from './helpers.mjs';

const engine = loadEngine();
const target = (raw) => dedupeTargets([raw]).valid[0];
const noSleep = async () => {};
const expected = load('expected.json');

test('golden fixtures: expected technologies, flat fields, schema and charge', async () => {
  const { fetchPage: fp } = fakeFetch();
  for (const f of FIXTURES) {
    const d = load(f);
    const row = await analyzeTarget(target(d.url), { engine, fetchPage: fp, lookupDns: fakeDns(), sleep: noSleep });
    const exp = expected[f];
    assert.deepEqual(row.technologies.map((t) => ({ name: t.name, version: t.version, confidence: t.confidence })), exp.technologies, f);
    for (const [k, v] of Object.entries(exp)) if (k !== 'technologies') assert.deepEqual(row[k], v, `${f} ${k}`);
    assert.equal(row.ok, true);
    assert.equal(row.status_code, 200);
    assert.equal(row.final_url, d.url);
    assertMatchesSchema(stamped(row));
    assert.equal(isChargeable(row), true);
  }
});

test('golden: the Shopify store, WordPress site and Next.js/Vercel site are recognized', async () => {
  const { fetchPage: fp } = fakeFetch();
  const rows = {};
  for (const f of FIXTURES) rows[f] = await analyzeTarget(target(load(f).url), { engine, fetchPage: fp, lookupDns: fakeDns() });
  assert.equal(rows['shopify_store.json'].ecommerce_platform, 'Shopify');
  assert.equal(rows['shopify_store.json'].cdn, 'Cloudflare');
  assert.equal(rows['wordpress_site.json'].cms, 'WordPress');
  assert.equal(rows['wordpress_site.json'].technologies.find((t) => t.name === 'WordPress').version, '7.2');
  assert.equal(rows['nextjs_vercel.json'].hosting_or_paas, 'Vercel');
  assert.ok(rows['nextjs_vercel.json'].technology_names.includes('Next.js'));
});

test('includeDns=false: no DNS signals, DNS-only technologies disappear, has_spf unknown', async () => {
  const { fetchPage: fp } = fakeFetch();
  const row = await analyzeTarget(target('https://www.allbirds.com/'), { engine, fetchPage: fp, lookupDns: null });
  assert.equal(row.mail_provider, null);
  assert.equal(row.has_spf, null);
  assert.ok(!row.technology_names.includes('Microsoft 365'));
  assert.ok(row.technology_names.includes('Shopify'));
  assertMatchesSchema(stamped(row));
});

test('categoriesFilter: narrows technologies; zero matches -> delivered, not charged', async () => {
  const { fetchPage: fp } = fakeFetch();
  const names = [...engine.categories.values()].map((c) => c.name);
  const { keep } = sanitizeCategoriesFilter(['ecommerce'], names);
  const shop = await analyzeTarget(target('https://www.allbirds.com/'), { engine, fetchPage: fp, lookupDns: fakeDns(), keep });
  assert.deepEqual(shop.technology_names, ['Shopify']);
  assert.equal(shop.cdn, 'Cloudflare'); // flat columns always filled
  assert.equal(isChargeable(shop), true);
  const wp = await analyzeTarget(target('https://wordpress.org/news/'), { engine, fetchPage: fp, lookupDns: fakeDns(), keep });
  assert.equal(wp.technology_count, 0);
  assert.equal(wp.ok, true);
  assert.equal(isChargeable(wp), false);
});

test('errors: dns_not_found from fetch or from our resolvers; blocked and http_error keep header detections but are free', async () => {
  const { fetchPage: fp } = fakeFetch({
    'https://proxied-nx.example/': () => { throw netError('ECONNRESET'); },
    'https://blocked.example/': page({ url: 'https://blocked.example/', status: 403, headers: { server: 'cloudflare', 'cf-ray': '1' }, html: '<title>Just a moment...</title>' }),
    'https://gone.example/': page({ url: 'https://gone.example/', status: 404, headers: { server: 'nginx' }, html: 'nope' }),
  });
  const nx = await analyzeTarget(target('https://nonexistent-domain-for-tests.example/'), { engine, fetchPage: fp, lookupDns: fakeDns(), sleep: noSleep });
  assert.equal(nx.error, 'dns_not_found');
  // A proxy can turn NXDOMAIN into a connection error; our own resolvers settle it.
  const nx2 = await analyzeTarget(target('https://proxied-nx.example/'), { engine, fetchPage: fp, lookupDns: fakeDns(), sleep: noSleep });
  assert.equal(nx2.error, 'dns_not_found');
  const blocked = await analyzeTarget(target('https://blocked.example/'), { engine, fetchPage: fp, lookupDns: null });
  assert.equal(blocked.error, 'blocked');
  assert.equal(blocked.status_code, 403);
  assert.ok(blocked.technology_names.includes('Cloudflare'));
  assert.equal(isChargeable(blocked), false);
  const gone = await analyzeTarget(target('https://gone.example/'), { engine, fetchPage: fp, lookupDns: null });
  assert.equal(gone.error, 'http_error');
  for (const r of [nx, nx2, blocked, gone]) assertMatchesSchema(stamped(r));
});

test('retry: one retry on timeout / 5xx, never on 404 or blocked', async () => {
  const flaky = fakeFetch({ 'https://flaky.example/': (url, n) => { if (n === 1) throw Object.assign(new Error('t'), { name: 'TimeoutError' }); return page({ url, headers: { server: 'nginx' } }); } });
  const r = await analyzeTarget(target('https://flaky.example/'), { engine, fetchPage: flaky.fetchPage, lookupDns: null, sleep: noSleep });
  assert.equal(r.ok, true);
  assert.equal(flaky.calls.length, 2);
  const down = fakeFetch({ 'https://down.example/': (url) => page({ url, status: 503 }) });
  const d = await analyzeTarget(target('https://down.example/'), { engine, fetchPage: down.fetchPage, lookupDns: null, sleep: noSleep });
  assert.equal(d.error, 'http_error');
  assert.equal(down.calls.length, 2);
  const nf = fakeFetch({ 'https://nf.example/': (url) => page({ url, status: 404 }) });
  await analyzeTarget(target('https://nf.example/'), { engine, fetchPage: nf.fetchPage, lookupDns: null, sleep: noSleep });
  assert.equal(nf.calls.length, 1);
  // Close to the run deadline there is no retry.
  const late = fakeFetch({ 'https://late.example/': () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } });
  const l = await analyzeTarget(target('https://late.example/'), { engine, fetchPage: late.fetchPage, lookupDns: null, sleep: noSleep, timeLeftMs: () => 20000 });
  assert.equal(l.error, 'timeout');
  assert.equal(late.calls.length, 1);
  assert.equal(late.calls[0].timeoutMs, 5000); // attempt timeout shrinks with the time left
});

test('bare domains fall back from https to http on TLS errors; explicit https URLs do not', async () => {
  const net = fakeFetch({
    'https://oldsite.example/': () => { throw netError('ERR_SSL_WRONG_VERSION_NUMBER'); },
    'http://oldsite.example/': (url) => page({ url, headers: { server: 'Apache' }, html: '<meta name="generator" content="WordPress 5.0">' }),
  });
  const r = await analyzeTarget(target('oldsite.example'), { engine, fetchPage: net.fetchPage, lookupDns: null, sleep: noSleep });
  assert.equal(r.ok, true);
  assert.equal(r.final_url, 'http://oldsite.example/');
  assert.equal(r.cms, 'WordPress');
  const r2 = await analyzeTarget(target('https://oldsite.example/'), { engine, fetchPage: net.fetchPage, lookupDns: null, sleep: noSleep });
  assert.equal(r2.error, 'tls_error');
});

// ---- real fetchPage against a local server ----

function server(handler) {
  const srv = http.createServer(handler);
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve({ base: `http://127.0.0.1:${srv.address().port}`, close: () => new Promise((r) => srv.close(r)) })));
}

test('fetchPage: follows redirects manually, keeps cookies from every hop, final headers', async () => {
  const s = await server((req, res) => {
    if (req.url === '/') { res.writeHead(301, { location: '/step', 'set-cookie': 'first=1; Path=/' }); return res.end(); }
    if (req.url === '/step') { res.writeHead(302, { location: `${'/final'}`, 'set-cookie': ['_shopify_y=abc', 'b=2'] }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', server: 'nginx/1.2', 'x-powered-by': 'PHP/8.1' });
    return res.end('<html><head><meta name="generator" content="WordPress 6.1"></head><body>ok</body></html>');
  });
  try {
    const p = await fetchPage(`${s.base}/`, { timeoutMs: 5000 });
    assert.equal(p.status, 200);
    assert.equal(p.finalUrl, `${s.base}/final`);
    assert.deepEqual(p.setCookies.map((c) => c.split('=')[0]), ['first', '_shopify_y', 'b']);
    assert.equal(p.headers.get('server'), 'nginx/1.2');
    assert.match(p.html, /WordPress 6\.1/);
  } finally { await s.close(); }
});

test('fetchPage: body capped, gzip decoded, legacy charset decoded, non-HTML body skipped, redirect loop -> http_error', async () => {
  const s = await server((req, res) => {
    if (req.url === '/big') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(`<p>${'a'.repeat(3000)}</p>`); }
    if (req.url === '/gz') { res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' }); return res.end(gzipSync('<p>zipped</p>')); }
    if (req.url === '/latin1') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(Buffer.from('<meta charset="iso-8859-1"><p>caf\xe9</p>', 'latin1')); }
    if (req.url === '/json') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"a":1}'); }
    res.writeHead(302, { location: '/loop' }); return res.end();
  });
  try {
    const big = await fetchPage(`${s.base}/big`, { maxBytes: 1000 });
    assert.equal(big.truncated, true);
    assert.equal(big.html.length, 1000);
    assert.equal((await fetchPage(`${s.base}/gz`)).html, '<p>zipped</p>');
    assert.match((await fetchPage(`${s.base}/latin1`)).html, /café/);
    const json = await fetchPage(`${s.base}/json`);
    assert.equal(json.html, '');
    assert.equal(json.status, 200);
    await assert.rejects(fetchPage(`${s.base}/loop`), (e) => e.errorCode === 'http_error');
    assert.equal(MAX_REDIRECTS, 10);
  } finally { await s.close(); }
});

test('fetchPage: timeout aborts a hanging server', async () => {
  const s = await server(() => { /* never responds */ });
  try {
    await assert.rejects(fetchPage(`${s.base}/`, { timeoutMs: 300 }), (e) => e.name === 'TimeoutError' || e.cause?.name === 'TimeoutError');
  } finally { s.close(); }
});

test('pickCharset: header first, then meta, else utf-8', () => {
  assert.equal(pickCharset('text/html; charset=Shift_JIS', Buffer.from('')), 'shift_jis');
  assert.equal(pickCharset('text/html', Buffer.from('<meta charset="windows-1252">')), 'windows-1252');
  assert.equal(pickCharset('', Buffer.from('<p>')), 'utf-8');
});
