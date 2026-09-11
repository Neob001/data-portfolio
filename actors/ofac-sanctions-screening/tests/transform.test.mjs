import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv, buildEntries, screenName, normalizeName, scoreNames, nameTokens } from '../src/transform.js';

const load = (f) => readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'latin1');
const entries = buildEntries(parseCsv(load('sdn_sample.csv')), parseCsv(load('alt_sample.csv')));

test('parses SDN + ALT samples into entries with aliases', () => {
  assert.ok(entries.length >= 5);
  const aero = entries.find((e) => e.uid === '36');
  assert.equal(aero.name, 'AEROCARIBBEAN AIRLINES');
  assert.equal(aero.programs, 'CUBA');
  assert.deepEqual(aero.aliases, ['AERO-CARIBBEAN']);
});

test('csv parser handles quoted fields with commas', () => {
  const rows = parseCsv('1,"ANGLO-CARIBBEAN CO., LTD.","x"\n2,plain,y\n');
  assert.equal(rows[0][1], 'ANGLO-CARIBBEAN CO., LTD.');
  assert.equal(rows.length, 2);
});

test('exact and alias matches score 1.0; screening returns hits', () => {
  const r = screenName('Aerocaribbean Airlines', entries, 0.85);
  assert.equal(r.matched, true);
  assert.equal(r.top_match_score, 1);
  const viaAlias = screenName('AERO-CARIBBEAN', entries, 0.85);
  assert.equal(viaAlias.matched, true);
  assert.equal(viaAlias.top_match_name, 'AEROCARIBBEAN AIRLINES');
});

test('clean names do not match', () => {
  const r = screenName('Wholesome Bakery of Vermont', entries, 0.85);
  assert.equal(r.matched, false);
  assert.equal(r.match_count, 0);
  assert.equal(r.top_match_name, null);
});

test('normalization strips accents/punctuation; corporate stopwords ignored', () => {
  assert.equal(normalizeName('Ángl?o-Caribbean  co., ltd.'), 'ANGL O CARIBBEAN CO LTD');
  assert.deepEqual(nameTokens('Anglo-Caribbean Co., Ltd.'), ['ANGLO', 'CARIBBEAN']);
  const q = 'Anglo Caribbean';
  const s = scoreNames(normalizeName(q), nameTokens(q), 'ANGLO-CARIBBEAN CO., LTD.');
  assert.ok(s >= 0.99, `expected ~1, got ${s}`);
});

test('empty SDN raises schema_change', () => {
  assert.throws(() => buildEntries([], []), (e) => e.failureClass === 'schema_change');
});
