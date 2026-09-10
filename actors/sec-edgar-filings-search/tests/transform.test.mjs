import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseFtsResponse, hitToRecord, buildFtsUrl } from '../src/transform.js';

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../golden/fts_response.json', import.meta.url)), 'utf8'),
);

test('parses golden FTS response into flat records', () => {
  const { total, records } = parseFtsResponse(golden);
  assert.ok(total > 0);
  assert.equal(records.length, 3);
  const r = records[0];
  assert.equal(r.accession_number, '0001144204-11-036302');
  assert.equal(r.cik, '1334699');
  assert.equal(r.company_name, 'Li3 Energy, Inc.');
  assert.equal(r.form_type, '8-K');
  assert.equal(r.filed_at, '2011-06-17');
  assert.match(r.document_url, /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/1334699\/000114420411036302\/.+/);
  assert.match(r.filing_index_url, /-index\.htm$/);
  assert.deepEqual(r.items, ['7.01', '9.01']);
});

test('drops malformed hits instead of crashing', () => {
  assert.equal(hitToRecord({}), null);
  assert.equal(hitToRecord({ _source: { adsh: null } }), null);
  const resp = { hits: { total: { value: 1 }, hits: [{}, golden.hits.hits[0]] } };
  assert.equal(parseFtsResponse(resp).records.length, 1);
});

test('schema change raises typed error', () => {
  assert.throws(() => parseFtsResponse({ unexpected: true }), (e) => e.failureClass === 'schema_change');
});

test('builds FTS urls with filters and paging', () => {
  const url = buildFtsUrl({ query: 'lithium', forms: ['8-K', '10-K'], startDate: '2026-01-01', from: 20 });
  assert.ok(url.startsWith('https://efts.sec.gov/LATEST/search-index?'));
  assert.ok(url.includes('forms=8-K%2C10-K'));
  assert.ok(url.includes('startdt=2026-01-01'));
  assert.ok(url.includes('from=20'));
});
