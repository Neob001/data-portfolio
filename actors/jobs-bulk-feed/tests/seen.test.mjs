import test from 'node:test';
import assert from 'node:assert/strict';
import { idHash, dayOf, SeenSet, loadSeen, GRACE_DAYS } from '../src/seen.js';
import { memoryStore } from './helpers.mjs';

test('idHash: deterministic 52-bit integers, distinct for near-identical ids', () => {
  const a = idHash('greenhouse:gitlab:8178133002');
  assert.equal(a, idHash('greenhouse:gitlab:8178133002'));
  assert.ok(Number.isSafeInteger(a) && a >= 0 && a < 2 ** 52);
  const many = new Set(Array.from({ length: 50000 }, (_, i) => idHash(`workable:acme:${i}`)));
  assert.equal(many.size, 50000);
});

test('SeenSet: lookup, add, and pruning only after a complete run (grace period)', () => {
  const ids = [11, 5, 3, 99].map((n) => idHash(`x:${n}`));
  let s = new SeenSet().next({ complete: true, today: 100 });
  assert.equal(s.size, 0);
  for (const h of ids) s.add(h);
  s = s.next({ complete: true, today: 100 });
  assert.equal(s.size, 4);
  for (const h of ids) assert.ok(s.seen(h));
  assert.ok(!s.seen(idHash('x:12345')));

  // Day 100 + GRACE_DAYS + 1: only ids[0] still matched -> a COMPLETE run drops the others.
  const later = 100 + GRACE_DAYS + 1;
  const fresh = SeenSet.fromChunks(s.toChunks());
  fresh.seen(ids[0]);
  assert.equal(fresh.next({ complete: false, today: later }).size, 4, 'a truncated run never prunes');
  const pruned = fresh.next({ complete: true, today: later });
  assert.equal(pruned.size, 1);
  assert.ok(pruned.seen(ids[0]));
  // Within the grace period absent ids are kept.
  const kept = SeenSet.fromChunks(s.toChunks()).next({ complete: true, today: 100 + GRACE_DAYS });
  assert.equal(kept.size, 4);
});

test('SeenSet: chunked binary round trip (several chunks), corrupt data rejected', () => {
  const s = new SeenSet();
  for (let i = 0; i < 1000; i += 1) s.add(idHash(`job:${i}`));
  const n = s.next({ complete: true, today: dayOf(Date.parse('2026-11-02T11:00:00Z')) });
  const chunks = n.toChunks(300);
  assert.equal(chunks.length, 4);
  const back = SeenSet.fromChunks(chunks);
  assert.deepEqual([...back.hashes], [...n.hashes]);
  assert.deepEqual([...back.days], [...n.days]);
  assert.equal(new SeenSet().toChunks().length, 1, 'an empty set is one empty chunk');
  const shuffled = Buffer.concat([chunks[1], chunks[0]]);
  assert.throws(() => SeenSet.fromChunks([shuffled]), /corrupt|not sorted/);
});

test('loadSeen/save: generations switch atomically; old chunks removed; a missing chunk is an error', async () => {
  const store = memoryStore();
  const filters = { feed: 'bulk', ats: ['lever'] };
  const a = await loadSeen(store, filters);
  assert.equal(a.seen.size, 0);
  a.seen.add(idHash('lever:acme:1'));
  await a.save({ complete: true, today: 20000 });
  const b = await loadSeen(store, filters);
  assert.equal(b.seen.size, 1);
  assert.equal(b.meta.gen, 1);
  b.seen.add(idHash('lever:acme:2'));
  await b.save({ complete: false, today: 20001 });
  const keys = [...store.m.keys()];
  assert.ok(keys.some((k) => k.endsWith('-g2-0')) && !keys.some((k) => k.endsWith('-g1-0')), keys.join(','));
  const c = await loadSeen(store, filters);
  assert.equal(c.seen.size, 2);
  store.m.delete(keys.find((k) => k.endsWith('-g2-0')));
  await assert.rejects(loadSeen(store, filters), /incomplete/);
});
