import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  isValidLanguage, parseArticleRef, chunk, parseSearch, mergeQueryResponse, resolvePage,
  isHumanClaims, toArticleRecord, parseFullText, LICENSE,
} from '../src/transform.js';

const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8'));
const merged = () => mergeQueryResponse({ pages: new Map(), aliases: new Map() }, load('query_response.json'));

test('parses titles and Wikipedia URLs, rejecting junk', () => {
  assert.deepEqual(parseArticleRef('Web_scraping'), { lang: 'en', title: 'Web scraping' });
  assert.deepEqual(parseArticleRef('Paris', 'fr'), { lang: 'fr', title: 'Paris' });
  assert.deepEqual(parseArticleRef('https://de.wikipedia.org/wiki/K%C3%B6ln'), { lang: 'de', title: 'Köln' });
  assert.deepEqual(parseArticleRef('https://en.m.wikipedia.org/wiki/New_York_City'), { lang: 'en', title: 'New York City' });
  assert.deepEqual(parseArticleRef('https://en.wikipedia.org/w/index.php?title=Mercury_(planet)'), { lang: 'en', title: 'Mercury (planet)' });
  assert.equal(parseArticleRef('https://example.com/wiki/Paris'), null);
  assert.equal(parseArticleRef('https://en.wikipedia.org/'), null);
  assert.equal(parseArticleRef('   '), null);
  assert.equal(parseArticleRef('a|b'), null);
  assert.ok(isValidLanguage('en') && isValidLanguage('zh-yue'));
  assert.ok(!isValidLanguage('EN;drop') && !isValidLanguage(''));
});

test('chunks batches', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test('parses golden search response', () => {
  assert.deepEqual(parseSearch(load('search_response.json')), ['Web scraping', 'Data scraping', 'Perplexity AI']);
  assert.throws(() => parseSearch({}), (e) => e.failureClass === 'schema_change');
  assert.throws(() => parseSearch({ error: { code: 'badvalue' } }), (e) => e.failureClass === 'http_error');
});

test('resolves normalization, redirects and missing pages', () => {
  const acc = merged();
  assert.equal(resolvePage(acc, 'web_scraping').title, 'Web scraping');
  assert.equal(resolvePage(acc, 'UK').title, 'United Kingdom');
  assert.equal(resolvePage(acc, 'Nonexistent page zz').missing, true);
  assert.equal(resolvePage(acc, 'Never requested'), null);
  assert.throws(() => mergeQueryResponse({ pages: new Map(), aliases: new Map() }, {}), (e) => e.failureClass === 'schema_change');
});

test('merges continued responses by concatenating array props', () => {
  const acc = { pages: new Map(), aliases: new Map() };
  mergeQueryResponse(acc, { query: { pages: [{ pageid: 1, ns: 0, title: 'A', categories: [{ title: 'Category:X' }] }] } });
  mergeQueryResponse(acc, { query: { pages: [{ pageid: 1, ns: 0, title: 'A', categories: [{ title: 'Category:Y' }], extract: 'e' }] } });
  const p = resolvePage(acc, 'A');
  assert.equal(p.categories.length, 2);
  assert.equal(p.extract, 'e');
});

test('builds flat article records with attribution', () => {
  const acc = merged();
  const r = toArticleRecord(resolvePage(acc, 'web_scraping'), 'en');
  assert.equal(r.found, true);
  assert.equal(r.title, 'Web scraping');
  assert.equal(r.page_id, 2696619);
  assert.ok(r.summary.length > 50);
  assert.equal(r.full_text, null);
  assert.equal(r.word_count, null);
  assert.equal(r.is_disambiguation, false);
  assert.match(r.wikidata_id, /^Q\d+$/);
  assert.ok(r.categories.every((c) => !c.startsWith('Category:')));
  assert.match(r.article_url, /^https:\/\/en\.wikipedia\.org\/wiki\//);
  assert.match(r.last_edited_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(r.license, LICENSE);
  assert.equal(r.attribution_url, 'https://en.wikipedia.org/w/index.php?curid=2696619&action=history');

  const m = toArticleRecord(resolvePage(acc, 'Mercury'), 'en');
  assert.equal(m.is_disambiguation, true);

  const withText = toArticleRecord(resolvePage(acc, 'web_scraping'), 'en', parseFullText(load('fulltext_response.json')));
  assert.ok(withText.full_text.startsWith('Web scraping'));
  assert.ok(withText.word_count > 50);
});

test('detects person articles via Wikidata P31=Q5', () => {
  assert.equal(isHumanClaims(load('claims_human.json')), true);
  assert.equal(isHumanClaims(load('claims_city.json')), false);
  assert.equal(isHumanClaims({}), false);
});
