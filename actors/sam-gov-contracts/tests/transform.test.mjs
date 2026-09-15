import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCsvParser, headerIndex, rowToRecord, buildMatcher } from '../src/transform.js';

const raw = readFileSync(fileURLToPath(new URL('../golden/opportunities_head.csv', import.meta.url)), 'utf8');

function parseAll(text, chunkSize) {
  const rows = [];
  const p = createCsvParser((r) => { rows.push(r); return true; });
  for (let i = 0; i < text.length; i += chunkSize) p.feed(text.slice(i, i + chunkSize));
  p.end();
  return rows;
}

test('streaming parser is chunk-size independent on the real SAM.gov extract', () => {
  const whole = parseAll(raw, raw.length);
  for (const size of [1, 7, 64, 4096]) assert.deepEqual(parseAll(raw, size), whole);
  assert.equal(whole.length, 26);
  assert.equal(whole[0][0], 'NoticeId');
  assert.ok(whole.every((r) => r.length === whole[0].length));
});

test('quotes, commas, doubled quotes and embedded CRLF', () => {
  const rows = parseAll('a,b,c\r\n"x, y","he said ""hi""","line1\r\nline2"\r\n1,,3', 3);
  assert.deepEqual(rows, [['a', 'b', 'c'], ['x, y', 'he said "hi"', 'line1\r\nline2'], ['1', '', '3']]);
});

test('onRow returning false stops parsing early', () => {
  let n = 0;
  const p = createCsvParser(() => { n += 1; return n < 2; });
  assert.equal(p.feed('a\nb\nc\nd\n'), false);
  assert.equal(n, 2);
});

test('real rows map to flat records without personal contact data', () => {
  const [header, ...body] = parseAll(raw, raw.length);
  const idx = headerIndex(header);
  const rec = rowToRecord(body[0], idx);
  assert.equal(rec.notice_id, 'ee4ba39118fd479386e4528ab4b948ef');
  assert.equal(rec.department, 'DEPT OF DEFENSE');
  assert.equal(rec.posted_date, '2026-09-14');
  assert.equal(rec.place_of_performance_country, 'DEU');
  assert.equal(rec.active, true);
  const keys = Object.keys(rec).join(' ');
  assert.ok(!/contact|email|phone|fax|fullname/i.test(keys), `personal fields leaked: ${keys}`);
  assert.ok(!JSON.stringify(rec).includes('@deca.mil'));
});

test('dates are descending in the extract (early-stop assumption)', () => {
  const [header, ...body] = parseAll(raw, raw.length);
  const idx = headerIndex(header);
  const dates = body.map((r) => r[idx.PostedDate]);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test('matcher: AND across filters, OR within, NAICS prefix', () => {
  const rec = { title: 'Cloud Software Licenses', description: 'Renewal', naics_code: '541519', set_aside_code: 'SBA',
    notice_type: 'Solicitation', department: 'DEPT OF DEFENSE', sub_tier: 'DISA', office: 'X', place_of_performance_state: 'VA' };
  assert.equal(buildMatcher({ keywords: ['software', 'nope'] })(rec), true);
  assert.equal(buildMatcher({ naicsCodes: ['5415'] })(rec), true);
  assert.equal(buildMatcher({ naicsCodes: ['3361'] })(rec), false);
  assert.equal(buildMatcher({ keywords: ['software'], states: ['TX'] })(rec), false);
  assert.equal(buildMatcher({ agencies: ['defense'], setAsideCodes: ['sba'], noticeTypes: ['solicitation'] })(rec), true);
  assert.equal(buildMatcher({})(rec), true);
});

test('schema change and malformed rows', () => {
  assert.throws(() => headerIndex(['Foo', 'Bar']), (e) => e.failureClass === 'schema_change');
  const idx = headerIndex(['NoticeId', 'Title', 'PostedDate', 'Type', 'NaicsCode', 'Link']);
  assert.equal(rowToRecord(['', 't', '2026-01-01', 'x', '', ''], idx), null);
});
