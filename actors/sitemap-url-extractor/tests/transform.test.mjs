import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSitemap, sitemapsFromRobots } from '../src/transform.js';

const load = (f) => readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8');

test('parses a real urlset sitemap', () => {
  const { kind, entries } = parseSitemap(load('urlset.xml'));
  assert.equal(kind, 'urlset');
  assert.ok(entries.length > 3);
  assert.match(entries[0].loc, /^https?:\/\//);
});

test('parses a sitemapindex and extracts child sitemaps with lastmod', () => {
  const { kind, entries } = parseSitemap(load('sitemapindex.xml'));
  assert.equal(kind, 'index');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].loc, 'https://example.com/sitemap-posts.xml');
  assert.equal(entries[0].lastmod, '2026-08-01');
  assert.equal(entries[1].lastmod, null);
});

test('non-sitemap content raises schema_change; XML entities decoded', () => {
  assert.throws(() => parseSitemap('<html>nope</html>'), (e) => e.failureClass === 'schema_change');
  const { entries } = parseSitemap('<urlset><url><loc>https://x.com/a?b=1&amp;c=2</loc></url></urlset>');
  assert.equal(entries[0].loc, 'https://x.com/a?b=1&c=2');
});

test('reads Sitemap lines from robots.txt case-insensitively', () => {
  const robots = 'User-agent: *\nDisallow:\nSitemap: https://a.com/s1.xml\nsitemap: https://a.com/s2.xml\n';
  assert.deepEqual(sitemapsFromRobots(robots), ['https://a.com/s1.xml', 'https://a.com/s2.xml']);
  assert.deepEqual(sitemapsFromRobots('no sitemaps here'), []);
});
