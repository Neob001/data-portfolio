import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTarget, dedupeTargets, registrableDomain, sanitizeCategoriesFilter, dnsSummary, mergeDnsTechnologies,
  detectMailProvider, detectDnsProvider, detectVerificationTokens, isNxDomain, classifyFetchError, classifyResponse,
  isChallengePage, isRetryable, flatFields, filterTechnologies, buildRow, isChargeable, OUTPUT_FIELDS,
} from '../src/transform.js';
import { assertMatchesSchema, stamped, netError } from './helpers.mjs';

test('normalizeTarget: domains and URLs in, junk out', () => {
  assert.deepEqual(normalizeTarget('Shopify.com'), { url: 'https://shopify.com/', host: 'shopify.com', key: 'shopify.com' });
  assert.deepEqual(normalizeTarget(' https://www.Example.com/pricing?x=1#top '), { url: 'https://www.example.com/pricing?x=1', host: 'www.example.com', key: 'example.com' });
  assert.equal(normalizeTarget('http://blog.example.co.uk').url, 'http://blog.example.co.uk/');
  assert.equal(normalizeTarget('example.com:8080/a').url, 'https://example.com:8080/a');
  for (const bad of ['', 'not a url', 'localhost', 'ftp://example.com', 'mailto:a@b.com', 'javascript:alert(1)', '127.0.0.1', 'https://user:pw@example.com', 'exa_mple.com', 'example.123']) {
    assert.equal(normalizeTarget(bad), null, bad);
  }
});

test('dedupeTargets: by host, www-insensitive, first URL wins; invalid inputs reported', () => {
  const { valid, invalid } = dedupeTargets(['https://www.shopify.com', 'shopify.com', 'SHOPIFY.COM/pricing', 'github.com', 'not a url', '', null, 'blog.shopify.com']);
  assert.deepEqual(valid.map((t) => t.url), ['https://www.shopify.com/', 'https://github.com/', 'https://blog.shopify.com/']);
  assert.deepEqual(invalid, ['not a url']);
  assert.equal(valid[0].raw, 'https://www.shopify.com');
});

test('registrableDomain uses the public suffix list', () => {
  assert.equal(registrableDomain('www.shop.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('blog.hubspot.com'), 'hubspot.com');
  assert.equal(registrableDomain('nextjs.org'), 'nextjs.org');
});

test('sanitizeCategoriesFilter: case-insensitive, unknown names reported, empty = no filter', () => {
  const known = ['CMS', 'Ecommerce', 'Analytics'];
  const r = sanitizeCategoriesFilter(['cms', ' ANALYTICS ', 'Nope'], known);
  assert.deepEqual([...r.keep], ['CMS', 'Analytics']);
  assert.deepEqual(r.unknown, ['Nope']);
  assert.equal(sanitizeCategoriesFilter([], known).keep, null);
  assert.equal(sanitizeCategoriesFilter(undefined, known).keep, null);
});

test('DNS detectors (copied from dns-records-lookup) still behave', () => {
  assert.equal(detectMailProvider(['allbirds-com.mail.protection.outlook.com']), 'Microsoft 365');
  assert.equal(detectMailProvider(['aspmx.l.google.com']), 'Google Workspace');
  assert.equal(detectMailProvider(['mx.example.com']), null);
  assert.equal(detectDnsProvider(['dana.ns.cloudflare.com']), 'Cloudflare');
  assert.equal(detectDnsProvider(['ns-1283.awsdns-32.org']), 'AWS Route 53');
  assert.deepEqual(detectVerificationTokens(['google-site-verification=x', 'MS=ms1', 'zoom_verify_abc', 'v=spf1 -all']), ['google', 'microsoft', 'zoom']);
});

test('dnsSummary: signals for fingerprints + provider/SPF/DMARC/token hints; unknown when lookups failed', () => {
  const d = dnsSummary({
    mx: [{ exchange: 'aspmx.l.google.com', priority: 1 }],
    txt: [['v=spf1 include:_spf.google.com ', '~all'], ['hubspot-developer-verification=abc']],
    ns: ['dana.ns.cloudflare.com'],
    soa: { nsname: 'dana.ns.cloudflare.com', hostmaster: 'dns.cloudflare.com', serial: 1 },
    dmarcTxt: [['v=DMARC1; p=reject']],
    cname: { error: 'ENODATA' },
  });
  assert.deepEqual(d.signals.mx, ['aspmx.l.google.com']);
  assert.deepEqual(d.signals.txt, ['v=spf1 include:_spf.google.com ~all', 'hubspot-developer-verification=abc']);
  assert.equal(d.signals.soa[0].startsWith('dana.ns.cloudflare.com'), true);
  assert.deepEqual(d.signals.cname, []);
  assert.equal(d.mail_provider, 'Google Workspace');
  assert.equal(d.dns_provider, 'Cloudflare');
  assert.equal(d.has_spf, true);
  assert.equal(d.has_dmarc, true);
  const failed = dnsSummary({ mx: { error: 'ETIMEOUT' }, txt: { error: 'ETIMEOUT' }, ns: [], soa: null, dmarcTxt: { error: 'ENODATA' }, cname: null });
  assert.equal(failed.has_spf, null); // could not tell
  assert.equal(failed.has_dmarc, false); // definitive "no record"
  const off = dnsSummary(null);
  assert.deepEqual([off.mail_provider, off.has_spf, off.has_dmarc, off.verification_tokens], [null, null, null, []]);
});

test('mergeDnsTechnologies: MX mail provider added once, with fingerprint categories and dns evidence', () => {
  const lookup = (n) => ({ 'Google Workspace': ['Webmail', 'Email'] }[n] ?? null);
  const evidence = new Map();
  const merged = mergeDnsTechnologies([{ name: 'Shopify', categories: ['Ecommerce'], version: null, confidence: 100 }], { mail_provider: 'Google Workspace' }, lookup, evidence);
  assert.deepEqual(merged.map((t) => t.name), ['Shopify', 'Google Workspace']);
  assert.deepEqual([...evidence.get('Google Workspace')], ['dns']);
  assert.equal(mergeDnsTechnologies(merged, { mail_provider: 'Google Workspace' }, lookup).length, 2);
  assert.equal(mergeDnsTechnologies([], { mail_provider: 'Mimecast' }, lookup).length, 0); // no fingerprint -> flat field only
});

test('isNxDomain: NS and SOA both NXDOMAIN', () => {
  assert.equal(isNxDomain({ ns: { error: 'ENOTFOUND' }, soa: { error: 'ENOTFOUND' } }), true);
  assert.equal(isNxDomain({ ns: { error: 'ENOTFOUND' }, soa: { error: 'ETIMEOUT' } }), false);
  assert.equal(isNxDomain(null), false);
});

test('classifyFetchError: undici error chains -> error enum', () => {
  assert.equal(classifyFetchError(netError('ENOTFOUND')), 'dns_not_found');
  assert.equal(classifyFetchError(netError('EAI_AGAIN')), 'dns_not_found');
  assert.equal(classifyFetchError(netError('UND_ERR_CONNECT_TIMEOUT')), 'timeout');
  assert.equal(classifyFetchError(Object.assign(new Error('aborted'), { name: 'TimeoutError' })), 'timeout');
  assert.equal(classifyFetchError(netError('CERT_HAS_EXPIRED')), 'tls_error');
  assert.equal(classifyFetchError(netError('ERR_TLS_CERT_ALTNAME_INVALID')), 'tls_error');
  assert.equal(classifyFetchError(netError('DEPTH_ZERO_SELF_SIGNED_CERT')), 'tls_error');
  assert.equal(classifyFetchError(netError('ECONNREFUSED')), 'connection_error');
  assert.equal(classifyFetchError(netError('ECONNRESET')), 'connection_error');
  assert.equal(classifyFetchError(Object.assign(new Error('Too many redirects'), { errorCode: 'http_error' })), 'http_error');
});

test('classifyResponse: challenge pages and 401/403/429 are blocked, other 4xx/5xx http_error', () => {
  assert.equal(classifyResponse(200, new Headers(), '<html>ok</html>'), null);
  assert.equal(classifyResponse(301, new Headers(), ''), null);
  assert.equal(classifyResponse(403, new Headers(), '<html><title>Just a moment...</title></html>'), 'blocked');
  assert.equal(classifyResponse(503, new Headers(), '<script src="https://ct.captcha-delivery.com/c.js"></script>'), 'blocked');
  assert.equal(classifyResponse(200, new Headers({ 'cf-mitigated': 'challenge' }), ''), 'blocked');
  assert.equal(classifyResponse(429, new Headers(), ''), 'blocked');
  assert.equal(classifyResponse(404, new Headers(), 'not found'), 'http_error');
  assert.equal(classifyResponse(503, new Headers(), 'maintenance'), 'http_error');
  assert.equal(isChallengePage(200, new Headers(), '<title>Just a moment...</title>'), false); // a 200 page talking about it
});

test('isRetryable: timeouts, connection errors and 5xx only', () => {
  assert.equal(isRetryable('timeout', null), true);
  assert.equal(isRetryable('connection_error', null), true);
  assert.equal(isRetryable('http_error', 503), true);
  assert.equal(isRetryable('http_error', 404), false);
  assert.equal(isRetryable('blocked', 403), false);
  assert.equal(isRetryable('dns_not_found', null), false);
});

const T = (name, categories, extra = {}) => ({ name, categories, version: null, confidence: 100, ...extra });
const TECHS = [
  T('WordPress', ['CMS', 'Blogs']), T('WooCommerce', ['Ecommerce']), T('Cart Functionality', ['Ecommerce']),
  T('cdnjs', ['CDN']), T('Cloudflare', ['CDN']), T('Next.js', ['Web frameworks', 'Web servers']), T('Nginx', ['Web servers', 'Reverse proxies']),
  T('Google Analytics', ['Analytics']), T('Google Tag Manager', ['Tag managers']), T('React', ['JavaScript frameworks']),
  T('PHP', ['Programming languages']), T('HubSpot', ['Marketing automation']), T('Stripe', ['Payment processors']),
  T('Atlassian Statuspage', ['Issue trackers', 'PaaS']), T('Vercel', ['PaaS']),
];

test('flatFields without evidence: first technology per category', () => {
  const f = flatFields(TECHS);
  assert.equal(f.cms, 'WordPress');
  assert.equal(f.ecommerce_platform, 'WooCommerce');
  assert.equal(f.web_server, 'Nginx'); // pure web server preferred over a framework
  assert.deepEqual(f.analytics, ['Google Analytics']);
  assert.deepEqual(f.tag_managers, ['Google Tag Manager']);
  assert.deepEqual(f.javascript_frameworks, ['React']);
  assert.deepEqual(f.programming_languages, ['PHP']);
  assert.deepEqual(f.marketing_automation, ['HubSpot']);
  assert.deepEqual(f.payment_processors, ['Stripe']);
});

test('flatFields with evidence: server evidence wins for infra; DNS-only never fills website columns', () => {
  const ev = new Map([
    ['WordPress', new Set(['page'])], ['WooCommerce', new Set(['dns'])], ['cdnjs', new Set(['page'])], ['Cloudflare', new Set(['server'])],
    ['Next.js', new Set(['server'])], ['Nginx', new Set(['dns'])], ['Google Analytics', new Set(['dns'])],
    ['HubSpot', new Set(['dns'])], ['Stripe', new Set(['dns'])], ['Atlassian Statuspage', new Set(['dns'])], ['Vercel', new Set(['server', 'dns'])],
  ]);
  const f = flatFields(TECHS, ev);
  assert.equal(f.cdn, 'Cloudflare'); // not the script CDN listed first
  assert.equal(f.ecommerce_platform, null); // DNS-only
  assert.equal(f.web_server, 'Next.js'); // Nginx is DNS-only here
  assert.equal(f.hosting_or_paas, 'Vercel'); // Statuspage TXT record is not hosting
  assert.deepEqual(f.analytics, []);
  assert.deepEqual(f.marketing_automation, ['HubSpot']); // org-level SaaS signals are kept
  assert.deepEqual(f.payment_processors, ['Stripe']);
  assert.deepEqual(f.javascript_frameworks, []); // React has no evidence entry -> treated as DNS-only
});

test('filterTechnologies + buildRow: filter narrows the list, flat columns stay filled', () => {
  const keep = new Set(['CMS']);
  assert.deepEqual(filterTechnologies(TECHS, keep).map((t) => t.name), ['WordPress']);
  const row = buildRow({ url: 'https://x.com/', finalUrl: 'https://x.com/', domain: 'x.com', statusCode: 200, techs: TECHS, keep });
  assert.deepEqual(Object.keys(row), OUTPUT_FIELDS.slice(0, -2));
  assert.deepEqual(row.technology_names, ['WordPress']);
  assert.deepEqual(row.categories, ['CMS', 'Blogs']);
  assert.equal(row.technology_count, 1);
  assert.equal(row.cdn, 'cdnjs');
  assertMatchesSchema(stamped(row));
});

test('buildRow: failure rows are schema-valid with every declared field', () => {
  for (const error of ['invalid_url', 'dns_not_found', 'timeout', 'http_error', 'blocked', 'tls_error', 'connection_error']) {
    const row = buildRow({ url: 'not a url', error });
    assert.equal(row.ok, false);
    assert.equal(row.technology_count, 0);
    assertMatchesSchema(stamped(row));
  }
});

test('isChargeable: ok and at least one technology', () => {
  assert.equal(isChargeable({ ok: true, technology_count: 3 }), true);
  assert.equal(isChargeable({ ok: true, technology_count: 0 }), false);
  assert.equal(isChargeable({ ok: false, technology_count: 5 }), false); // e.g. blocked page with Cloudflare headers
  assert.equal(isChargeable(null), false);
});
