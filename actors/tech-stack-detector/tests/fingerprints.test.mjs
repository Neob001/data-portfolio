import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { loadEngine, compilePattern } from '../src/detect.js';

const FILE = new URL('../fingerprints/technologies.json.gz', import.meta.url);
const data = JSON.parse(gunzipSync(readFileSync(FILE)).toString('utf8'));
const engine = loadEngine();

test('vendored fingerprints: MIT source recorded, size sensible', () => {
  assert.equal(data.source.package, 'wappalyzer@6.10.54');
  assert.equal(data.source.license, 'MIT');
  assert.match(data.source.copyright, /Copyright 2008 Wappalyzer/);
  let bytes = 0;
  for (const f of readdirSync(new URL('../fingerprints/', import.meta.url))) bytes += statSync(new URL(`../fingerprints/${f}`, import.meta.url)).size;
  assert.ok(bytes < 3 * 1024 * 1024, `${bytes} bytes`);
  const lic = readFileSync(new URL('../FINGERPRINTS_LICENSE.md', import.meta.url), 'utf8');
  assert.match(lic, /Copyright 2008 Wappalyzer/);
  assert.match(lic, /Permission is hereby granted, free of charge/);
  assert.match(lic, /6\.10\.54/);
});

test('full fingerprint set compiles: >= 3,000 technologies, >= 100 categories, nothing dropped at runtime', () => {
  assert.ok(engine.stats.technologies >= 3000, `${engine.stats.technologies} technologies`);
  assert.ok(engine.stats.staticDetectable >= 2500, `${engine.stats.staticDetectable} statically detectable`);
  assert.ok(engine.categories.size >= 100);
  assert.ok(engine.stats.compiledPatterns >= 4500, `${engine.stats.compiledPatterns} patterns`);
  assert.equal(engine.stats.droppedPatterns, 0);
  for (const t of engine.techs.values()) {
    assert.ok(t.cats.length > 0, `${t.name} has a category`);
    for (const i of t.implies) assert.ok(engine.techs.has(i.name), `${t.name} implies ${i.name}`);
    for (const x of t.excludes) assert.ok(engine.techs.has(x), `${t.name} excludes ${x}`);
  }
  for (const name of ['WordPress', 'Shopify', 'Next.js', 'Vercel', 'Webflow', 'HubSpot', 'Cloudflare', 'Google Analytics', 'Google Tag Manager', 'Wix', 'Squarespace', 'Magento', 'Drupal', 'React', 'Nginx', 'Stripe', 'Google Workspace', 'Microsoft 365']) {
    assert.ok(engine.techs.has(name), name);
  }
});

test('every vendored regex is fast on adversarial input', () => {
  const inputs = ['a'.repeat(20000), '<'.repeat(20000), `${'/'.repeat(10000)}${'.'.repeat(10000)}`, '<div class="x" data-a="1"><a href="/p/q">t</a></div>\n'.repeat(1500)];
  let checked = 0;
  const started = performance.now();
  for (const t of engine.techs.values()) {
    for (const type of ['scriptSrc', 'scripts', 'html', 'text', 'url']) {
      for (const p of t[type]) {
        if (!p.regex) continue;
        for (const s of inputs) {
          const t0 = performance.now();
          p.regex.test(s);
          assert.ok(performance.now() - t0 < 100, `${t.name} ${type} ${p.regex.source}`);
        }
        checked += 1;
      }
    }
  }
  assert.ok(checked > 2000, `${checked} regexes checked`);
  assert.ok(performance.now() - started < 60000);
});

test('local overrides from the build script are applied', () => {
  assert.deepEqual(Object.keys(engine.techs.get('Amazon Web Services').dns), []);
  assert.deepEqual(engine.techs.get('Apple iCloud Mail').dns.txt.map((p) => p.regex.source), ['redirect=icloud\\.com']);
  assert.ok(!engine.techs.get('Nginx').implies.some((i) => i.name === 'C'));
  const manifest = JSON.parse(readFileSync(new URL('../fingerprints/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.technologies, engine.stats.technologies);
  assert.ok(manifest.overrides.includes('Amazon S3'));
  assert.equal(compilePattern('(?<=x)y').regex.source, '(?<=x)y');
});
