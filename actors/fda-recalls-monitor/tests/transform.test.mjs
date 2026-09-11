import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnforcementResponse, recallToRecord, buildUrl } from '../src/transform.js';

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../golden/enforcement_response.json', import.meta.url)), 'utf8'),
);

test('parses golden openFDA response into flat records', () => {
  const { total, records } = parseEnforcementResponse(golden);
  assert.ok(total > 0);
  assert.equal(records.length, 2);
  const r = records[0];
  assert.equal(r.recall_number, 'F-0609-2015');
  assert.equal(r.classification, 'Class I');
  assert.equal(r.product_type, 'Food');
  assert.equal(r.recalling_firm, 'Oasis Brands, Inc');
});

test('fda dates converted, malformed dropped, schema flagged', () => {
  assert.equal(recallToRecord({ recall_number: 'X', report_date: '20260115' }).report_date, '2026-01-15');
  assert.equal(recallToRecord({ recall_number: 'X', report_date: 'bogus' }).report_date, null);
  assert.equal(recallToRecord({}), null);
  assert.throws(() => parseEnforcementResponse({}), (e) => e.failureClass === 'schema_change');
});

test('buildUrl composes search clauses and validates category', () => {
  const url = buildUrl({ category: 'drug', searchTerm: 'insulin pump', classifications: ['Class I'], reportedAfter: '2026-01-01', skip: 100 });
  assert.ok(url.startsWith('https://api.fda.gov/drug/enforcement.json?'));
  assert.ok(url.includes('"insulin"+AND+"pump"'));
  assert.ok(url.includes('classification:"Class I"'));
  assert.ok(url.includes('report_date:[20260101+TO+99991231]'));
  assert.ok(url.includes('skip=100'));
  assert.throws(() => buildUrl({ category: 'toys' }));
});
