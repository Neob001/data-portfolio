import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ROW_FIELDS, REASONS } from '../src/transform.js';
import { ATS_LIST } from '../src/core/transform.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));
const schema = JSON.parse(read('INPUT_SCHEMA.json'));
const registry = JSON.parse(readFileSync(new URL('../../../registry.json', import.meta.url), 'utf8')).actors['company-jobs-scraper'];

test('listing copy and price are unchanged by the platform upgrade (a retitle is an owner decision)', () => {
  assert.equal(actor.name, 'company-jobs-scraper');
  assert.equal(actor.title, registry.listing.title);
  assert.equal(actor.description, registry.listing.description);
  assert.deepEqual(actor.categories, registry.listing.categories);
  assert.deepEqual(Object.keys(registry.ppe_events), ['job-result']);
  assert.equal(registry.ppe_events['job-result'].proposed_price_usd, 0.002);
  assert.match(read('src/scrape.js'), /eventName|runFeed/);
});

test('dataset schema declares exactly the fields the Actor outputs; enums list null', () => {
  const props = actor.storages.dataset.fields.properties;
  assert.deepEqual(Object.keys(props), ROW_FIELDS);
  assert.deepEqual(props.reason.enum, [...REASONS, null]);
  assert.deepEqual(props.ats.enum, [...ATS_LIST, null]);
  for (const [k, spec] of Object.entries(props)) {
    if (spec.enum && k !== 'reason') assert.ok(spec.enum.includes(null), `${k} enum lists null (explanatory rows)`);
    if (!['query', 'found', 'fetched_at'].includes(k) && spec.type !== 'array') assert.ok([].concat(spec.type).includes('null'), `${k} nullable`);
  }
  for (const view of Object.values(actor.storages.dataset.views)) {
    for (const f of view.transformation.fields) assert.ok(ROW_FIELDS.includes(f), f);
  }
  // Measured 2026-10-22: 285 MB peak RSS for 6,476 rows with descriptions (5 large boards); no index is read.
  assert.equal(actor.minMemoryMbytes, 512);
});

test('input schema: same field names, prefill succeeds without credentials', () => {
  assert.deepEqual(Object.keys(schema.properties), ['companyUrls', 'maxJobsPerCompany']);
  assert.deepEqual(schema.required, ['companyUrls']);
  assert.equal(schema.properties.maxJobsPerCompany.default, 200);
  assert.ok(schema.properties.companyUrls.prefill.includes('https://boards.greenhouse.io/gitlab'), 'a direct board keeps the prefill non-empty');
  assert.ok(schema.properties.maxJobsPerCompany.prefill <= 25);
});

test('output schema has no resourceType; Dockerfile uses apify/actor-node:22', () => {
  assert.ok(!read('.actor/output_schema.json').includes('resourceType'));
  assert.match(read('.actor/output_schema.json'), /view=jobs/);
  assert.match(read('.actor/Dockerfile'), /^FROM apify\/actor-node:22$/m);
});

test('src/lib is the synced shared copy; src/core is the synced ats-jobs-feed core (scripts/sync_jobs_core.py)', () => {
  for (const f of readdirSync(new URL('../../../shared/js/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    assert.equal(read(`src/lib/${f}`), readFileSync(new URL(`../../../shared/js/${f}`, import.meta.url), 'utf8'), f);
  }
  const src = new URL('../../ats-jobs-feed/src/core/', import.meta.url);
  const files = readdirSync(src).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(readdirSync(new URL('../src/core/', import.meta.url)).filter((f) => f.endsWith('.js')).sort(), files);
  for (const f of files) assert.equal(read(`src/core/${f}`), readFileSync(new URL(f, src), 'utf8'), `core/${f} drifted: run python3 scripts/sync_jobs_core.py`);
});

test('README documents every platform, the detection reasons and the unsupported-page FAQ', () => {
  const md = read('README.md');
  for (const p of ['Greenhouse', 'Lever', 'Ashby', 'Workable', 'Recruitee', 'Workday', 'Personio', 'Teamtailor']) assert.ok(md.includes(p), p);
  for (const r of REASONS) assert.ok(md.includes(`\`${r}\``), r);
  assert.match(md, /careers page is not supported\?/);
  assert.ok(md.startsWith(`# ${actor.title}\n`), 'H1 = listing title');
});
