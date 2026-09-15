import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, cursorKeyFor, storeNameFor } from '../src/lib/incremental.js';

// Simulates a source that returns records in arbitrary (non-date) order.
function runOnce(cursor, records, maxResults, runSince) {
  const t = createTracker(cursor);
  const delivered = [];
  for (const r of records) {
    if (delivered.length >= maxResults) break;
    if (t.isDuplicate(r.date, r.id)) continue;
    t.observe(r.date, r.id);
    delivered.push(r.id);
  }
  const truncated = delivered.length >= maxResults;
  const next = t.next({ truncated, runSince: t.since ?? runSince }) ?? cursor;
  return { delivered, next, since: t.since };
}

const unsorted = [
  { id: 'a', date: '2026-09-14' }, { id: 'b', date: '2026-09-02' }, { id: 'c', date: '2026-09-10' },
  { id: 'd', date: '2026-09-14' }, { id: 'e', date: '2026-09-05' }, { id: 'f', date: '2026-09-12' },
];

test('complete run then rerun: zero duplicates', () => {
  const r1 = runOnce(null, unsorted, 100, '2026-09-01');
  assert.deepEqual(r1.delivered, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(r1.next, { complete: true, last_date: '2026-09-14', ids: ['a', 'd'] });
  const r2 = runOnce(r1.next, unsorted.filter((x) => x.date >= r1.next.last_date), 100);
  assert.deepEqual(r2.delivered, []);
});

test('truncated run on unsorted source: next runs finish the window without duplicates or gaps', () => {
  const r1 = runOnce(null, unsorted, 2, '2026-09-01');
  assert.deepEqual(r1.delivered, ['a', 'b']);
  assert.equal(r1.next.complete, false);
  assert.equal(r1.next.since, '2026-09-01');
  const r2 = runOnce(r1.next, unsorted, 2);
  assert.equal(r2.since, '2026-09-01', 'truncated cursor must not advance the query window');
  assert.deepEqual(r2.delivered, ['c', 'd']);
  const r3 = runOnce(r2.next, unsorted, 100);
  assert.deepEqual(r3.delivered, ['e', 'f']);
  assert.equal(r3.next.complete, true);
  assert.equal(r3.next.last_date, '2026-09-14');
  const all = [...r1.delivered, ...r2.delivered, ...r3.delivered].sort();
  assert.deepEqual(all, ['a', 'b', 'c', 'd', 'e', 'f']);
  const r4 = runOnce(r3.next, unsorted.filter((x) => x.date >= '2026-09-14'), 100);
  assert.deepEqual(r4.delivered, []);
});

test('new records published later on the boundary date are delivered once', () => {
  const r1 = runOnce(null, unsorted, 100, '2026-09-01');
  const later = [...unsorted, { id: 'g', date: '2026-09-14' }, { id: 'h', date: '2026-09-15' }];
  const r2 = runOnce(r1.next, later.filter((x) => x.date >= r1.next.last_date), 100);
  assert.deepEqual(r2.delivered, ['g', 'h']);
  const r3 = runOnce(r2.next, later.filter((x) => x.date >= r2.next.last_date), 100);
  assert.deepEqual(r3.delivered, []);
});

test('duplicate ids inside one response are delivered once', () => {
  const r = runOnce(null, [{ id: 'x', date: '2026-09-01' }, { id: 'x', date: '2026-09-01' }], 100, null);
  assert.deepEqual(r.delivered, ['x']);
});

test('store names and cursor keys are valid and stable', () => {
  assert.equal(storeNameFor('sam-gov-contracts'), 'factpipe-sam-gov-contracts-state');
  assert.ok(storeNameFor('x'.repeat(100)).length <= 63);
  const k1 = cursorKeyFor({ naics: ['5415'], kw: ['cloud & AI'] });
  assert.match(k1, /^[a-zA-Z0-9!\-_.'()]{1,256}$/);
  assert.equal(k1, cursorKeyFor({ naics: ['5415'], kw: ['cloud & AI'] }));
  assert.notEqual(k1, cursorKeyFor({ naics: ['5416'], kw: ['cloud & AI'] }));
});
