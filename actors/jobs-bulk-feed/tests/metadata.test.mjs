import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { OUTPUT_FIELDS, normalizeBulkInput, EVENT } from '../src/bulk.js';
import { ATS_LIST } from '../src/core/transform.js';
import { SENIORITY_LEVELS } from '../src/core/enrich.js';

const SLUG = 'jobs-bulk-feed';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));
const schema = JSON.parse(read('INPUT_SCHEMA.json'));
const repo = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('actor.json: Store limits, categories, memory from the measured peak', () => {
  assert.equal(actor.name, SLUG);
  assert.ok(actor.title.length <= 60, `title ${actor.title.length} chars`);
  assert.ok(actor.description.length <= 220, `description ${actor.description.length} chars`);
  assert.deepEqual(actor.categories, ['JOBS', 'LEAD_GENERATION']);
  // Full index (859,594 jobs) measured at 350 MB peak RSS: 1 GB minimum (see ats-jobs-feed metadata test).
  assert.equal(actor.minMemoryMbytes, 1024);
});

test('dataset schema: the same fields (and types/enums) as ats-jobs-feed; nullable enums list null', () => {
  const props = actor.storages.dataset.fields.properties;
  assert.deepEqual(Object.keys(props), OUTPUT_FIELDS);
  const feed = JSON.parse(readFileSync(new URL('../../ats-jobs-feed/.actor/actor.json', import.meta.url), 'utf8')).storages.dataset.fields.properties;
  for (const f of OUTPUT_FIELDS) {
    assert.deepEqual(props[f].type, feed[f].type, f);
    assert.deepEqual(props[f].enum, feed[f].enum, f);
  }
  for (const [k, p] of Object.entries(props)) if (p.enum && [].concat(p.type).includes('null')) assert.ok(p.enum.includes(null), k);
  for (const f of actor.storages.dataset.views.jobs.transformation.fields) assert.ok(OUTPUT_FIELDS.includes(f), f);
});

test('output schema has no resourceType; Dockerfile uses apify/actor-node:22', () => {
  assert.ok(!read('.actor/output_schema.json').includes('resourceType'));
  assert.match(read('.actor/Dockerfile'), /^FROM apify\/actor-node:22$/m);
});

test('src/lib is the synced shared copy; src/core is the synced ats-jobs-feed core (scripts/sync_jobs_core.py)', () => {
  for (const f of ['deadline.js', 'http.js', 'incremental.js', 'records.js', 'run_summary.js']) {
    assert.equal(read(`src/lib/${f}`), repo(`shared/js/${f}`), f);
  }
  const src = new URL('../../ats-jobs-feed/src/core/', import.meta.url);
  const files = readdirSync(src).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(readdirSync(new URL('../src/core/', import.meta.url)).filter((f) => f.endsWith('.js')).sort(), files);
  for (const f of files) assert.equal(read(`src/core/${f}`), readFileSync(new URL(f, src), 'utf8'), `core/${f} drifted: run python3 scripts/sync_jobs_core.py`);
  assert.match(repo('scripts/sync_jobs_core.py'), new RegExp(`"${SLUG}"`));
});

test('input schema: prefill, defaults and enums match the code', () => {
  const p = schema.properties;
  const prefill = Object.fromEntries(Object.entries(p).filter(([, v]) => 'prefill' in v).map(([k, v]) => [k, v.prefill]));
  assert.deepEqual(prefill, { postedWithinDays: 3, maxResults: 100 });
  const o = normalizeBulkInput(prefill);
  assert.deepEqual([o.postedWithinDays, o.maxResults, o.sinceLastRun], [3, 100, true]);
  assert.equal(p.maxResults.default, 100000);
  assert.equal(p.maxResults.maximum, 2000000);
  assert.equal(p.sinceLastRun.default, true);
  assert.deepEqual(p.ats.items.enum, ATS_LIST);
  assert.deepEqual(p.seniority.items.enum, SENIORITY_LEVELS);
  assert.deepEqual(p.fields.items.enum, OUTPUT_FIELDS);
  assert.deepEqual(p.remote.enum, ['any', 'remote_only', 'onsite_only']);
});

test('README: family structure, pricing left as an owner TODO, suite section before FAQ', () => {
  const md = read('README.md');
  for (const h of ['## Quick start', '## What you get', '## Use cases', '## Input', '## Output fields', '## Pricing', '## factpipe Jobs & Hiring Data', '## FAQ']) assert.ok(md.includes(h), h);
  assert.ok(md.indexOf('## factpipe Jobs & Hiring Data') < md.indexOf('## FAQ'));
  assert.match(md, /TODO\(owner\): Pricing — \$X per 1,000 jobs/);
  assert.equal((md.match(/\$X/g) || []).length, 1, 'the placeholder price appears only on the TODO line');
  assert.ok(!/\$\d/.test(md), 'no concrete price before the owner sets it');
  for (const s of ['ats-jobs-feed', 'remote-jobs-feed', 'ats-jobs-scraper', 'companies-hiring', 'greenhouse-jobs-api', 'lever-jobs-api', 'ashby-jobs-api', 'workday-jobs-api', 'company-jobs-scraper', 'expired-jobs-checker']) {
    assert.ok(md.includes(`https://apify.com/factpipe/${s}`), s);
  }
  assert.match(md, new RegExp(`apify\\.com/factpipe/${SLUG}\\)[^\\n]*\\(this Actor\\)`));
  assert.match(md, /How is this different from the Jobs Feed API \(ats-jobs-feed\)\?/);
  assert.match(md, /10:00 UTC/);
});

test('registry: staging entry, PPE event without a price yet', () => {
  const reg = JSON.parse(repo('registry.json')).actors[SLUG];
  assert.ok(reg, 'registry.json entry');
  assert.equal(reg.status, 'staging');
  assert.ok(reg.apify_actor_id === null || /^[A-Za-z0-9]{17}$/.test(reg.apify_actor_id), 'no Actor yet, or the private staging Actor');
  assert.match(reg.approval, /publish \+ price pending owner approval/);
  assert.deepEqual(Object.keys(reg.ppe_events), [EVENT]);
  assert.equal(reg.ppe_events[EVENT].proposed_price_usd, null);
  assert.ok(reg.pricing_rationale.length > 40);
  assert.ok(reg.listing.title.length <= 60 && reg.listing.description.length <= 220);
  assert.equal(reg.listing.title, actor.title);
});
