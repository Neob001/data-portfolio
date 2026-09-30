import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parsePattern, compilePattern, compileRegex, boundQuantifiers, trimLeadingWildcard, requiredLiteral, interiorWord,
  resolveVersion, compileFingerprints, extractSignals, detect, detectWithEvidence, analyze,
  selectorRequirements, domCandidate, buildAttrIndex, parseSetCookies, normalizeHeaders, capHtml, LIMITS,
} from '../src/detect.js';
import { load as loadHtml } from 'cheerio/lib/slim';

// A tiny fingerprint set exercising every supported pattern type and relation.
const DATA = {
  categories: {
    1: { name: 'CMS', priority: 1 },
    6: { name: 'Ecommerce', priority: 1 },
    10: { name: 'Analytics', priority: 9 },
    12: { name: 'JavaScript frameworks', priority: 8 },
    22: { name: 'Web servers', priority: 8 },
    27: { name: 'Programming languages', priority: 5 },
    31: { name: 'CDN', priority: 9 },
    34: { name: 'Databases', priority: 5 },
    51: { name: 'Page builders', priority: 2 },
    87: { name: 'WordPress plugins', priority: 8 },
  },
  technologies: {
    WordPress: {
      cats: [1],
      meta: { generator: '^WordPress(?: ([\\d.]+))?\\;version:\\1' },
      scriptSrc: '/wp-(?:content|includes)/',
      headers: { 'X-Pingback': '/xmlrpc\\.php$' },
      implies: ['PHP', 'MySQL\\;confidence:50'],
      excludes: 'Squarespace',
    },
    Squarespace: { cats: [1], headers: { server: 'Squarespace' } },
    PHP: { cats: [27], headers: { 'x-powered-by': '^php/?([\\d.]+)?\\;version:\\1' }, cookies: { PHPSESSID: '' } },
    MySQL: { cats: [34] },
    'Yoast SEO': { cats: [87], requires: 'WordPress', html: '<!-- This site is optimized with the Yoast (?:WordPress )?SEO plugin v([\\d.]+) -\\;version:\\1' },
    Shopify: { cats: [6], cookies: { _shopify_y: '' }, headers: { 'x-shopid': '\\;confidence:50' }, implies: 'Cloudflare' },
    Cloudflare: { cats: [31], headers: { server: '^cloudflare$', 'cf-ray': '' }, dns: { NS: '\\.ns\\.cloudflare\\.com' } },
    'Google Analytics': {
      cats: [10],
      cookies: { '_ga_*': '\\;version:GA4' },
      scripts: ["gtag\\([^)]+'(G-)\\;version:\\1?GA4:"],
      scriptSrc: 'googletagmanager\\.com/gtag/js',
    },
    Webflow: { cats: [51], dom: 'html[data-wf-site]', meta: { generator: 'Webflow' } },
    jQuery: { cats: [12], dom: { "script[src*='jquery']": { attributes: { src: 'jquery[.-]([\\d.]*\\d)[^/]*\\.js\\;version:\\1' } } } },
    Nginx: { cats: [22], headers: { server: 'nginx(?:/([\\d.]+))?\\;version:\\1' } },
    HubSpot: { cats: [10], text: 'Powered by HubSpot', url: '\\.hubspot\\.com' },
    Broken: { cats: [10], html: '(unclosed' },
  },
};
const engine = compileFingerprints(DATA);
const names = (techs) => techs.map((t) => t.name).sort();
const find = (techs, n) => techs.find((t) => t.name === n);

test('parsePattern: regex, version template and confidence', () => {
  assert.deepEqual(parsePattern('^WordPress ([\\d.]+)\\;version:\\1\\;confidence:50'), { source: '^WordPress ([\\d.]+)', version: '\\1', confidence: 50 });
  assert.deepEqual(parsePattern(''), { source: '', version: '', confidence: 100 });
  assert.deepEqual(parsePattern('\\;confidence:25'), { source: '', version: '', confidence: 25 });
  assert.equal(parsePattern('x\\;version:\\1?GA4:').version, '\\1?GA4:');
});

test('compile: bounded quantifiers, exists patterns, invalid regex dropped', () => {
  assert.equal(boundQuantifiers('a+b*[+*]c\\+'), 'a{1,250}b{0,250}[+*]c\\+');
  assert.equal(compileRegex(''), null);
  assert.equal(compileRegex('(unclosed'), undefined);
  assert.equal(compilePattern('(unclosed'), null);
  assert.equal(engine.stats.droppedPatterns, 1); // Broken's html pattern
  assert.equal(engine.techs.get('Broken').detectable, false);
  assert.ok(compileRegex('ab+c').test('ABBBC')); // case-insensitive
});

test('trimLeadingWildcard and required literals speed up whole-page scans safely', () => {
  assert.equal(trimLeadingWildcard('.+latestVersion":"'), '.latestVersion":"');
  assert.equal(trimLeadingWildcard('.*foo'), 'foo');
  assert.equal(trimLeadingWildcard('.+(x)'), '.+(x)'); // group follows: untouched
  assert.equal(requiredLiteral('<[^>]+data-wf-site'), 'data-wf-site');
  assert.equal(requiredLiteral('^WordPress(?: ([\\d.]+))?'), 'wordpress');
  assert.equal(requiredLiteral('abc?def'), 'def');
  assert.equal(requiredLiteral('foo|barbaz'), '');
  assert.equal(requiredLiteral('cdn\\.shopify\\.com'), 'cdn.shopify.com');
  assert.equal(interiorWord('cdn.shopify.com'), 'shopify');
  assert.equal(interiorWord('wordpress'), '');
});

test('resolveVersion: back references, ternary and junk groups', () => {
  assert.equal(resolveVersion('\\1', /WordPress ([\d.]+)/i, 'WordPress 6.4.2'), '6.4.2');
  assert.equal(resolveVersion('\\1?GA4:', /'(G-)/i, "gtag('config', 'G-ABC')"), 'GA4');
  assert.equal(resolveVersion('\\1?GA4:', /'(G-)?x/i, "'x"), '');
  assert.equal(resolveVersion('\\1', /v=(\w+)/i, 'v=0123456789abcdef'), ''); // > 10 chars ignored
  assert.equal(resolveVersion('GA4', null, 'anything'), 'GA4');
});

test('headers, cookies (incl. wildcard), meta, scriptSrc, scripts and versions', () => {
  const signals = extractSignals({
    url: 'https://blog.example.com/',
    headers: { Server: 'nginx/1.25.3', 'X-Powered-By': 'PHP/8.2.1' },
    setCookies: ['_ga_ABC123=GS1.1; Path=/', 'PHPSESSID=deadbeef; HttpOnly'],
    html: `<html><head><meta name="generator" content="WordPress 6.4.2">
      <script src="/wp-includes/js/jquery/jquery.min.js"></script>
      <script>gtag('config', 'G-XYZ');</script></head><body>Hi</body></html>`,
  });
  const techs = detect(engine, signals);
  assert.deepEqual(names(techs), ['Google Analytics', 'MySQL', 'Nginx', 'PHP', 'WordPress']);
  assert.equal(find(techs, 'WordPress').version, '6.4.2');
  assert.equal(find(techs, 'Nginx').version, '1.25.3');
  assert.equal(find(techs, 'PHP').version, '8.2.1'); // detected directly, not only implied
  assert.equal(find(techs, 'Google Analytics').version, 'GA4');
  assert.equal(find(techs, 'MySQL').confidence, 50); // implied with \;confidence:50
  assert.deepEqual(find(techs, 'WordPress').categories, ['CMS']);
});

test('confidence sums per technology and caps at 100; low-confidence alone is kept', () => {
  const half = detect(engine, extractSignals({ headers: { 'x-shopid': '1' } }));
  assert.equal(find(half, 'Shopify').confidence, 50);
  assert.equal(find(half, 'Cloudflare').confidence, 50); // implied: min(parent, 100)
  const full = detect(engine, extractSignals({ headers: { 'x-shopid': '1' }, setCookies: ['_shopify_y=1'] }));
  assert.equal(find(full, 'Shopify').confidence, 100);
});

test('implies is transitive and does not duplicate directly detected technologies', () => {
  const t = compileFingerprints({
    categories: { 1: { name: 'CMS', priority: 1 } },
    technologies: { A: { cats: [1], headers: { x: '' }, implies: 'B\\;confidence:80' }, B: { cats: [1], implies: 'C\\;confidence:60' }, C: { cats: [1] } },
  });
  const out = detect(t, extractSignals({ headers: { x: '1' } }));
  assert.deepEqual(out.map((x) => [x.name, x.confidence]), [['A', 100], ['B', 80], ['C', 60]]);
});

test('excludes removes the excluded technology', () => {
  const s = extractSignals({ headers: { server: 'Squarespace' }, html: '<meta name="generator" content="WordPress">' });
  assert.deepEqual(names(detect(engine, s)), ['MySQL', 'PHP', 'WordPress']);
});

test('requires: dependent technologies only match once the required one is detected', () => {
  const html = '<html><!-- This site is optimized with the Yoast SEO plugin v21.7 - https://yoast.com/ --></html>';
  assert.equal(find(detect(engine, extractSignals({ html })), 'Yoast SEO'), undefined);
  const withWp = detect(engine, extractSignals({ html: `${html}<meta name="generator" content="WordPress 6.4">` }));
  assert.equal(find(withWp, 'Yoast SEO').version, '21.7');
});

test('dom: exists and attribute patterns with version; text and url patterns', () => {
  const html = '<html data-wf-site="abc"><head><script src="https://code.jquery.com/jquery-3.7.1.min.js"></script></head><body><footer>Powered by HubSpot</footer></body></html>';
  const techs = detect(engine, extractSignals({ url: 'https://x.example.com/', html }));
  assert.equal(find(techs, 'Webflow').confidence, 100);
  assert.equal(find(techs, 'jQuery').version, '3.7.1');
  assert.ok(find(techs, 'HubSpot'), 'text pattern');
  assert.ok(find(detect(engine, extractSignals({ url: 'https://app.hubspot.com/x' })), 'HubSpot'), 'url pattern');
});

test('dns signals are matched by record type', () => {
  const r = detectWithEvidence(engine, extractSignals({ dns: { ns: ['dana.ns.cloudflare.com'] } }));
  assert.deepEqual(names(r.technologies), ['Cloudflare']);
  assert.deepEqual([...r.evidence.get('Cloudflare')], ['dns']);
});

test('evidence: server vs page vs dns; implied technologies inherit the parent evidence', () => {
  const r = detectWithEvidence(engine, extractSignals({ headers: { 'x-shopid': '1' }, html: '<meta name="generator" content="WordPress">' }));
  assert.deepEqual([...r.evidence.get('Shopify')], ['server']);
  assert.deepEqual([...r.evidence.get('Cloudflare')], ['server']);
  assert.deepEqual([...r.evidence.get('WordPress')], ['page']);
  assert.deepEqual([...r.evidence.get('PHP')], ['page']);
});

test('selector pre-filter: requirements per branch and attribute index', () => {
  assert.deepEqual(selectorRequirements("link[href*='shopify.com']"), [{ attrs: [], ids: [], classes: [], values: [{ attr: 'href', value: 'shopify.com' }] }]);
  const [a, b] = selectorRequirements('#recaptcha_image, div.g-recaptcha:not(.x)');
  assert.deepEqual(a.ids, ['recaptcha_image']);
  assert.deepEqual(b.classes, ['g-recaptcha']);
  const idx = buildAttrIndex(loadHtml('<div class="g-recaptcha foo"></div><link href="https://cdn.shopify.com/a.css">'));
  const entry = (sel) => ({ branches: selectorRequirements(sel) });
  assert.equal(domCandidate(entry('#recaptcha_image, div.g-recaptcha'), idx), true);
  assert.equal(domCandidate(entry("link[href*='shopify.com']"), idx), true);
  assert.equal(domCandidate(entry("link[href*='wix.com']"), idx), false);
  assert.equal(domCandidate(entry('html[data-wf-site]'), idx), false);
});

test('signal extraction: headers/cookies normalized, relative script URLs resolved, caps applied', () => {
  assert.deepEqual(normalizeHeaders(new Headers({ 'X-A': '1', 'set-cookie': 'a=b' })), { 'x-a': ['1'] });
  assert.deepEqual(parseSetCookies(['Foo=bar; Path=/', 'flag; Secure', '=x']), { foo: ['bar'], flag: [''] });
  const s = extractSignals({ url: 'https://ex.com/a/', html: '<script src="../js/app.js"></script><script src="data:text/javascript,1"></script>' });
  assert.deepEqual(s.scriptSrc, ['https://ex.com/js/app.js']);
  const big = `<p>${'x'.repeat(LIMITS.htmlHead + LIMITS.htmlTail + 5000)}</p>`;
  assert.equal(capHtml(big).length, LIMITS.htmlHead + LIMITS.htmlTail + 1);
  assert.equal(extractSignals({ html: '' }).$, null);
});

test('regex guard: a pattern disabled as slow is skipped afterwards', () => {
  const e = compileFingerprints({ categories: { 1: { name: 'CMS', priority: 1 } }, technologies: { A: { cats: [1], html: 'needle' } } });
  const s = extractSignals({ html: '<p>needle</p>' });
  assert.equal(analyze(e, s, e.base).length, 1);
  e.techs.get('A').html[0].disabled = true;
  assert.equal(analyze(e, s, e.base).length, 0);
});
