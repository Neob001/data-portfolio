import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { OUTPUT_FIELDS } from '../src/feed.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));

test('actor.json: Store limits, categories, pricing mention', () => {
  assert.ok(actor.title.length <= 60, `title ${actor.title.length} chars`);
  assert.ok(actor.description.length <= 220, `description ${actor.description.length} chars`);
  assert.match(actor.description, /\$3 per 1,000 jobs/);
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
