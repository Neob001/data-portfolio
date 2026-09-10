import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseSearchResponse, noticeToRecord, buildQuery, pickLang } from '../src/transform.js';

const golden = JSON.parse(
  readFileSync(fileURLToPath(new URL('../golden/search_response.json', import.meta.url)), 'utf8'),
);

test('parses golden TED response into flat records', () => {
  const { total, records } = parseSearchResponse(golden);
  assert.ok(total > 0);
  assert.equal(records.length, 3);
  const r = records[0];
  assert.equal(r.publication_number, '602745-2026');
  assert.equal(r.buyer_name, 'LRA Lindau (Bodensee)');
  assert.equal(r.published_at, '2026-09-02');
  assert.equal(r.submission_deadline, '2026-10-02T10:00:00+02:00');
  assert.ok(r.cpv_codes.includes('45000000'));
  assert.equal(new Set(r.cpv_codes).size, r.cpv_codes.length, 'cpv codes deduplicated');
  assert.match(r.notice_url, /^https:\/\/ted\.europa\.eu\//);
  assert.ok(typeof r.title === 'string' && r.title.length > 0);
});

test('pickLang prefers English, tolerates shapes', () => {
  assert.equal(pickLang({ deu: ['Hallo'], eng: ['Hello'] }), 'Hello');
  assert.equal(pickLang({ deu: ['Hallo'] }), 'Hallo');
  assert.equal(pickLang('plain'), 'plain');
  assert.equal(pickLang(null), null);
  assert.equal(pickLang({}), null);
});

test('drops malformed notices, flags schema change', () => {
  assert.equal(noticeToRecord({}), null);
  assert.throws(() => parseSearchResponse({ bad: true }), (e) => e.failureClass === 'schema_change');
});

test('buildQuery composes expert query and validates input', () => {
  const q = buildQuery({ cpvCodes: ['45000000'], countries: ['DEU'], text: 'bridge', publishedAfter: '2026-09-01' });
  assert.equal(
    q,
    '(classification-cpv IN (45000000)) AND (buyer-country IN (DEU)) AND (FT ~ ("bridge")) AND (publication-date > 20260901)',
  );
  assert.throws(() => buildQuery({}));
});
