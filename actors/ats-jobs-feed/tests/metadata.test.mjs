import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { OUTPUT_FIELDS } from '../src/core/feed.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));

test('actor.json: Store limits, categories, pricing mention', () => {
  assert.ok(actor.title.length <= 60, `title ${actor.title.length} chars`);
  assert.ok(actor.description.length <= 220, `description ${actor.description.length} chars`);
  assert.match(actor.description, /\$5 per 1,000 jobs/);
  // Category names already used elsewhere in this repo (valid Apify Store categories).
  const known = new Set();
  for (const dir of readdirSync(new URL('../../', import.meta.url))) {
    try { for (const c of JSON.parse(readFileSync(new URL(`../../${dir}/.actor/actor.json`, import.meta.url), 'utf8')).categories || []) known.add(c); } catch { /* not an actor */ }
  }
  assert.deepEqual(actor.categories, ['JOBS', 'LEAD_GENERATION']);
  for (const c of actor.categories) assert.ok(known.has(c), `category ${c}`);
});

test('dataset schema declares exactly the fields the Actor outputs', () => {
  assert.deepEqual(Object.keys(actor.storages.dataset.fields.properties), OUTPUT_FIELDS);
  for (const f of actor.storages.dataset.views.jobs.transformation.fields) assert.ok(OUTPUT_FIELDS.includes(f), f);
});

test('output schema has no resourceType; Dockerfile uses apify/actor-node:22', () => {
  const out = read('.actor/output_schema.json');
  assert.ok(!out.includes('resourceType'));
  assert.match(read('.actor/Dockerfile'), /^FROM apify\/actor-node:22$/m);
});

test('src/lib is the synced shared copy (never edited here)', () => {
  for (const f of ['http.js', 'incremental.js', 'records.js', 'run_summary.js']) {
    assert.equal(read(`src/lib/${f}`), readFileSync(new URL(`../../company-jobs-scraper/src/lib/${f}`, import.meta.url), 'utf8'), f);
  }
});

test('every Actor that reads the jobs index refuses to run below 2 GB (2,000+ job requests are OOM-killed at 1 GB)', () => {
  const root = new URL('../../', import.meta.url);
  // company-jobs-scraper carries the core for its live mode only (careers pages -> boards); it never reads the index.
  const LIVE_ONLY = ['company-jobs-scraper'];
  // Index readers that stream instead of ranking (no top-K candidate heap, no live descriptions), with their
  // measured peak RSS on the full published index (build 2026-11-02, 890k records):
  //  - jobs-bulk-feed: whole index, 859,594 jobs pushed in 1,000-row batches + sinceLastRun state = 350 MB;
  //  - expired-jobs-checker: 100k job_ids (all 79 shards) = 384 MB.
  // 1 GB keeps ~2.5x margin. Re-measure before raising their input limits or when the index doubles.
  const STREAMING = { 'jobs-bulk-feed': 1024, 'expired-jobs-checker': 1024 };
  const readers = readdirSync(root).filter((d) => {
    try { return !LIVE_ONLY.includes(d) && readdirSync(new URL(`${d}/src/core/`, root)).includes('feed.js'); } catch { return false; }
  });
  assert.ok(readers.length >= 10, `found ${readers.length} index readers`);
  for (const d of readers) {
    const a = JSON.parse(readFileSync(new URL(`${d}/.actor/actor.json`, root), 'utf8'));
    assert.ok((a.minMemoryMbytes ?? 0) >= (STREAMING[d] ?? 2048), `${d}: minMemoryMbytes ${a.minMemoryMbytes}`);
  }
});
