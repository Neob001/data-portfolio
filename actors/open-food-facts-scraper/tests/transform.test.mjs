import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  FIELDS, normalizeBarcode, countryTag, buildSearchQuery, parseProductResponse, parseSearchResponse,
  toProductRecord, hasPayload, LICENSE,
} from '../src/transform.js';

const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8'));

test('normalizes barcodes strictly', () => {
  assert.equal(normalizeBarcode('3017624010701'), '3017624010701');
  assert.equal(normalizeBarcode(' 0 851087-000687 '), '0851087000687');
  assert.equal(normalizeBarcode(12345678), '12345678');
  assert.equal(normalizeBarcode('1234567'), null);
  assert.equal(normalizeBarcode('abc'), null);
  assert.equal(normalizeBarcode(null), null);
});

test('builds search queries without Lucene injection', () => {
  assert.equal(countryTag('United States'), 'en:united-states');
  assert.equal(countryTag('en:france'), 'en:france');
  assert.equal(countryTag(''), null);
  assert.equal(buildSearchQuery('peanut butter'), 'peanut butter');
  assert.equal(buildSearchQuery('peanut butter', 'united-states'), 'countries_tags:"en:united-states" AND peanut AND butter');
  assert.equal(buildSearchQuery('a:"b" (c) OR d'), 'a b c d');
  assert.equal(buildSearchQuery('  '), null);
});

test('never requests contributor fields', () => {
  assert.ok(!/creator|editors|informers|photographers/.test(FIELDS));
});

test('parses golden found / missing product responses', () => {
  const p = parseProductResponse(load('product_found.json'));
  assert.equal(p.code, '3017624010701');
  assert.equal(parseProductResponse(load('product_missing.json')), null);
  assert.throws(() => parseProductResponse({}), (e) => e.failureClass === 'schema_change');
});

test('builds flat product records with nutrition and attribution', () => {
  const r = toProductRecord(parseProductResponse(load('product_found.json')));
  assert.equal(r.barcode, '3017624010701');
  assert.equal(r.product_name, 'Nutella');
  assert.deepEqual(r.brands, ['Ferrero']);
  assert.ok(r.categories.includes('spreads'));
  assert.ok(r.allergens.includes('nuts'));
  assert.equal(r.nutriscore_grade, 'e');
  assert.equal(typeof r.energy_kcal_100g, 'number');
  assert.equal(typeof r.sugars_100g, 'number');
  assert.match(r.last_modified_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(r.product_url, 'https://world.openfoodfacts.org/product/3017624010701');
  assert.equal(r.license, LICENSE);
  assert.ok(hasPayload(r));
});

test('parses golden search hits (brands as arrays, unknown grades nulled)', () => {
  const { hits, pageCount } = parseSearchResponse(load('search_response.json'));
  assert.equal(hits.length, 3);
  assert.ok(pageCount > 1);
  const records = hits.map(toProductRecord);
  assert.deepEqual(records[0].brands, ['Peanut Butter & Co']);
  assert.equal(records[0].nutriscore_grade, null); // "unknown"
  assert.ok(records.every((r) => r.countries.includes('united-states')));
  assert.throws(() => parseSearchResponse({}), (e) => e.failureClass === 'schema_change');
});

test('empty product shells are not chargeable', () => {
  assert.equal(hasPayload(toProductRecord({ code: '12345678' })), false);
});
