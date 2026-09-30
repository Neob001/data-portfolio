import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { OUTPUT_FIELDS, ERROR_CODES, EVENT_NAME } from '../src/transform.js';
import { loadEngine } from '../src/detect.js';
import { createDeadline } from '../src/lib/deadline.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));
const input = JSON.parse(read('INPUT_SCHEMA.json'));

test('actor.json: Store limits, categories, pricing mention', () => {
  assert.ok(actor.title.length <= 60, `title ${actor.title.length} chars`);
  assert.ok(actor.description.length <= 220, `description ${actor.description.length} chars`);
  assert.match(actor.description, /\$5 per 1,000 domains/);
  const known = new Set();
  for (const dir of readdirSync(new URL('../../', import.meta.url))) {
    if (dir === 'tech-stack-detector') continue;
    try { for (const c of JSON.parse(readFileSync(new URL(`../../${dir}/.actor/actor.json`, import.meta.url), 'utf8')).categories || []) known.add(c); } catch { /* not an actor */ }
  }
  assert.deepEqual(actor.categories, ['LEAD_GENERATION', 'DEVELOPER_TOOLS']);
  for (const c of actor.categories) assert.ok(known.has(c), `category ${c}`);
});

test('dataset schema declares exactly the fields the Actor outputs; error enum includes null', () => {
  const props = actor.storages.dataset.fields.properties;
  assert.deepEqual(Object.keys(props), OUTPUT_FIELDS);
  assert.deepEqual(props.error.enum, [null, ...ERROR_CODES]);
  const view = actor.storages.dataset.views.technologies.transformation.fields;
  for (const f of view) assert.ok(OUTPUT_FIELDS.includes(f), f);
  for (const f of ['domain', 'cms', 'ecommerce_platform', 'analytics', 'cdn', 'technology_count']) assert.ok(view.includes(f), f);
});

test('output schema has no resourceType and points at the view; Dockerfile uses apify/actor-node:22', () => {
  const out = read('.actor/output_schema.json');
  assert.ok(!out.includes('resourceType'));
  assert.match(out, /view=technologies/);
  assert.match(read('.actor/Dockerfile'), /^FROM apify\/actor-node:22$/m);
});

test('INPUT_SCHEMA: prefill, defaults, category enum matches the fingerprint categories', () => {
  assert.deepEqual(input.properties.urls.prefill, ['https://www.shopify.com', 'https://github.com', 'https://www.nytimes.com']);
  assert.deepEqual(input.required, ['urls']);
  assert.equal(input.properties.includeDns.default, true);
  assert.equal(input.properties.maxConcurrency.default, 10);
  const cats = [...loadEngine().categories.values()].map((c) => c.name).sort((a, b) => a.localeCompare(b));
  assert.deepEqual(input.properties.categoriesFilter.items.enum, cats);
});

test('src/lib is the synced shared copy (never edited here)', () => {
  for (const f of ['deadline.js', 'http.js', 'incremental.js', 'records.js', 'run_summary.js']) {
    assert.equal(read(`src/lib/${f}`), readFileSync(new URL(`../../dns-records-lookup/src/lib/${f}`, import.meta.url), 'utf8'), f);
  }
});

test('main.js: PPE event name, charge-limit handling and deadline guard are wired', () => {
  const main = read('src/main.js');
  assert.equal(EVENT_NAME, 'domain-analyzed');
  assert.match(main, /Actor\.charge\(\{ eventName: EVENT_NAME \}\)/);
  assert.match(main, /eventChargeLimitReached/);
  assert.match(main, /deadline\.hasTimeFor\(ITEM_BUDGET_MS\)/);
  assert.match(main, /writeRunSummary/);
});

test('deadline guard: stops starting new URLs when ~45 s remain', () => {
  let now = 0;
  const d = createDeadline({ deadlineMs: 100000, now: () => now });
  assert.equal(d.hasTimeFor(45000), true);
  now = 60000;
  assert.equal(d.hasTimeFor(45000), false);
  assert.equal(d.stoppedEarly, true);
});

test('README: required sections, prefilled run cost, toolkit links, license attribution', () => {
  const md = read('README.md');
  for (const h of ['## Quick start', '## Pricing', '## Input', '## Coverage', '## Fingerprint license', '## factpipe Website Audit Toolkit', '## FAQ']) assert.ok(md.includes(h), h);
  assert.ok(md.indexOf('## factpipe Website Audit Toolkit') < md.indexOf('## FAQ'));
  assert.match(md, /\$0\.015/);
  for (const slug of ['lighthouse-auditor', 'dns-records-lookup', 'email-security-checker', 'website-screenshot', 'broken-link-checker', 'companies-hiring']) {
    assert.ok(md.includes(`https://apify.com/factpipe/${slug}`), slug);
  }
  assert.match(md, /\(this Actor\)/);
  assert.match(md, /Is this Wappalyzer\?/);
  assert.match(md, /MIT/);
});
