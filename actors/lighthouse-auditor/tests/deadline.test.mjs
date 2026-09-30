import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeadline, deadlineFromEnv } from '../src/lib/deadline.js';

test('deadline: parses ISO and epoch env values, absent means no limit', () => {
  assert.equal(deadlineFromEnv({ ACTOR_TIMEOUT_AT: '2026-09-30T10:00:00.000Z' }), Date.parse('2026-09-30T10:00:00.000Z'));
  assert.equal(deadlineFromEnv({ APIFY_TIMEOUT_AT: '1790000000000' }), 1790000000000);
  assert.equal(deadlineFromEnv({}), null);
  assert.equal(createDeadline({ deadlineMs: null }).hasTimeFor(1e12), true);
});

test('deadline: stops starting new items when the next one would not finish in time', () => {
  let now = 0;
  const d = createDeadline({ deadlineMs: 100000, now: () => now });
  assert.equal(d.hasTimeFor(60000), true);
  now = 50000;
  assert.equal(d.hasTimeFor(60000), false);
  assert.equal(d.stoppedEarly, true);
});
