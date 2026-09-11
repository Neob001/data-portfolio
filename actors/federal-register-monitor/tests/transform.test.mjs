import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDocumentsResponse, docToRecord, buildUrl } from '../src/transform.js';

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../golden/documents_response.json', import.meta.url)), 'utf8'),
);

test('parses golden FR response into flat records', () => {
  const { total, records } = parseDocumentsResponse(golden);
  assert.ok(total > 0);
  assert.equal(records.length, 2);
  const r = records[0];
  assert.ok(r.document_number);
  assert.match(r.published_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Array.isArray(r.agencies) && r.agencies.length > 0);
  assert.match(r.html_url, /^https:\/\/www\.federalregister\.gov\//);
});

test('malformed docs dropped, schema change flagged', () => {
  assert.equal(docToRecord({}), null);
  assert.throws(() => parseDocumentsResponse({ nope: 1 }), (e) => e.failureClass === 'schema_change');
});

test('buildUrl composes conditions and validates input', () => {
  const url = buildUrl({ term: 'tariff', documentTypes: ['RULE'], publishedAfter: '2026-01-01', page: 2 });
  assert.ok(url.includes('conditions%5Bterm%5D=tariff'));
  assert.ok(url.includes('conditions%5Btype%5D%5B%5D=RULE'));
  assert.ok(url.includes('conditions%5Bpublication_date%5D%5Bgte%5D=2026-01-01'));
  assert.ok(url.includes('page=2'));
  assert.throws(() => buildUrl({}));
});
