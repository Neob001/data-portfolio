import test from 'node:test';
import assert from 'node:assert/strict';
import { createTracker, cursorKeyFor, storeNameFor } from '../src/lib/incremental.js';

test('first run: nothing is a duplicate, cursor records newest date and its ids', () => {
  const t = createTracker(null);
  assert.equal(t.since, null);
  assert.equal(t.isDuplicate('2026-09-14', 'a'), false);
  t.observe('2026-09-13', 'x');
  t.observe('2026-09-14', 'a');
  t.observe('2026-09-14', 'b');
  assert.deepEqual(t.next(), { last_date: '2026-09-14', ids_on_last_date: ['a', 'b'] });
});

test('second run: same records are duplicates, new same-day and later records are not', () => {
  const t = createTracker({ last_date: '2026-09-14', ids_on_last_date: ['a', 'b'] });
  assert.equal(t.since, '2026-09-14');
  assert.equal(t.isDuplicate('2026-09-13', 'x'), true);
  assert.equal(t.isDuplicate('2026-09-14', 'a'), true);
  assert.equal(t.isDuplicate('2026-09-14', 'c'), false);
  assert.equal(t.isDuplicate('2026-09-15', 'a'), false);
  t.observe('2026-09-14', 'c');
  assert.deepEqual(t.next(), { last_date: '2026-09-14', ids_on_last_date: ['a', 'b', 'c'] });
});

test('no new records keeps the old cursor (next() is null)', () => {
  const t = createTracker({ last_date: '2026-09-14', ids_on_last_date: ['a'] });
  assert.equal(t.next(), null);
});

test('store names and cursor keys are valid and stable', () => {
  assert.equal(storeNameFor('sam-gov-contracts'), 'factpipe-sam-gov-contracts-state');
  assert.ok(storeNameFor('x'.repeat(100)).length <= 63);
  const k1 = cursorKeyFor({ naics: ['5415'], kw: ['cloud & AI'] });
  assert.match(k1, /^[a-zA-Z0-9!\-_.'()]{1,256}$/);
  assert.equal(k1, cursorKeyFor({ naics: ['5415'], kw: ['cloud & AI'] }));
  assert.notEqual(k1, cursorKeyFor({ naics: ['5416'], kw: ['cloud & AI'] }));
});
