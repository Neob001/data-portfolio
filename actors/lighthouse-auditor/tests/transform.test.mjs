import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lhrToRecord, normalizeUrl, rate } from '../src/transform.js';

const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8'));

test('real mobile LHR (example.com) -> scores, vitals and ratings', () => {
  const r = lhrToRecord(load('lhr_example_mobile.json'), 'mobile');
  assert.equal(r.ok, true);
  assert.equal(r.performance_score, 100);
  assert.equal(r.accessibility_score, 100);
  assert.equal(r.seo_score, 80);
  assert.equal(r.lcp_ms, 901);
  assert.equal(r.cls, 0);
  assert.equal(r.core_web_vitals_lab, 'pass');
  assert.equal(r.final_url, 'https://example.com/');
  assert.ok(r.failing_seo_audits.length >= 1, 'seo 80 must come with failing seo audits');
  assert.match(r.lighthouse_version, /^12\./);
});

test('real desktop LHR (wikipedia.org) -> opportunities sorted, insights listed', () => {
  const r = lhrToRecord(load('lhr_wiki_desktop.json'), 'desktop');
  assert.equal(r.strategy, 'desktop');
  assert.equal(r.performance_score, 98);
  assert.ok(r.top_opportunities.some((o) => o.id === 'modern-image-formats'));
  assert.ok(r.failing_insights.includes('cache-insight'));
  const savings = r.top_opportunities.map((o) => o.estimated_savings_ms);
  assert.deepEqual(savings, [...savings].sort((a, b) => b - a));
});

test('runtime error (unreachable site) -> not ok, never charged', () => {
  const r = lhrToRecord(load('lhr_nxdomain.json'), 'mobile');
  assert.equal(r.ok, false);
  assert.equal(r.error_code, 'CHROME_INTERSTITIAL_ERROR');
});

test('schema change raises typed error', () => {
  assert.throws(() => lhrToRecord({ foo: 1 }, 'mobile'), (e) => e.failureClass === 'schema_change');
});

test('url normalization', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(normalizeUrl('http://Example.com/a?b=1'), 'http://example.com/a?b=1');
  assert.equal(normalizeUrl('ftp://example.com'), null);
  assert.equal(normalizeUrl('localhost'), null);
  assert.equal(normalizeUrl('not a url at all'), null);
});

test('core web vitals thresholds', () => {
  assert.equal(rate('lcp_ms', 2500), 'good');
  assert.equal(rate('lcp_ms', 3000), 'needs_improvement');
  assert.equal(rate('cls', 0.3), 'poor');
  assert.equal(rate('tbt_ms', null), null);
});
