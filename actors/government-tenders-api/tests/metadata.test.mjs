import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OUTPUT_FIELDS, normalizeInput } from '../src/tenders.js';

const SLUG = 'government-tenders-api';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));
const schema = JSON.parse(read('INPUT_SCHEMA.json'));
const output = JSON.parse(read('.actor/output_schema.json'));
const md = read('README.md');

test('actor.json: Store limits, categories, price in the description', () => {
  assert.equal(actor.name, SLUG);
  assert.ok(actor.title.length <= 60, `title ${actor.title.length} chars`);
  assert.ok(actor.description.length <= 300, `description ${actor.description.length} chars`);
  assert.match(actor.description, /\$3\.50 per 1,000 notices/);
  assert.deepEqual(actor.categories, ['LEAD_GENERATION', 'BUSINESS']);
});

test('dataset schema: exactly the output fields, each with a description; view columns exist', () => {
  const props = actor.storages.dataset.fields.properties;
  assert.deepEqual(Object.keys(props), OUTPUT_FIELDS);
  for (const [k, p] of Object.entries(props)) assert.ok(p.description && p.description.length > 15, `${k} needs a description`);
  for (const f of actor.storages.dataset.views.notices.transformation.fields) assert.ok(OUTPUT_FIELDS.includes(f), f);
  for (const f of ['cpv_codes', 'naics_codes', 'unspsc_codes', 'supplier_names']) assert.deepEqual(props[f].items, { type: 'string' });
});

test('output schema: results, all fields, run summary; no resourceType; Dockerfile node 22', () => {
  assert.ok(output.properties.allFieldsDatasetUrl.template.includes('clean=true'));
  assert.ok(output.properties.resultsDatasetUrl.template.includes('view=notices'));
  for (const p of Object.values(output.properties)) assert.ok(p.description);
  assert.ok(!read('.actor/output_schema.json').includes('resourceType'));
  assert.match(read('.actor/Dockerfile'), /^FROM apify\/actor-node:22$/m);
});

test('src/lib is the synced shared copy', () => {
  for (const f of ['http.js', 'incremental.js', 'records.js', 'run_summary.js', 'deadline.js']) {
    assert.equal(read(`src/lib/${f}`), readFileSync(new URL(`../../../shared/js/${f}`, import.meta.url), 'utf8'), f);
  }
});

test('input schema: every property described; prefill run is valid', () => {
  for (const [k, p] of Object.entries(schema.properties)) assert.ok(p.description, k);
  const prefill = Object.fromEntries(Object.entries(schema.properties).filter(([, p]) => 'prefill' in p).map(([k, p]) => [k, p.prefill]));
  assert.deepEqual(prefill, { keywords: ['software'], openOnly: true, maxResults: 20 });
  const o = normalizeInput(prefill);
  assert.equal(o.sortBy, 'relevance');
  assert.equal(schema.properties.maxResults.default, 100);
});

test('README: quick start cost, real JSON sample with all fields, pricing, MCP section, coverage, FAQ', () => {
  assert.match(md, /## Quick start[\s\S]*\$0\.07/);
  const sample = JSON.parse(/```json\n([\s\S]*?)\n```/.exec(md)[1]);
  assert.deepEqual(Object.keys(sample), OUTPUT_FIELDS);
  assert.match(md, /`notice-result` \| \*\*\$3\.50 per 1,000\*\*/);
  const mcp = md.indexOf('## Use with AI agents (MCP)');
  assert.ok(mcp > 0 && mcp < md.indexOf('## FAQ'));
  assert.ok(md.includes(`https://mcp.apify.com?tools=factpipe/${SLUG}`));
  for (const s of ['TED', 'SAM.gov', 'Find a Tender', 'Contracts Finder', 'Open Contracting', 'CC BY', 'OGL', 'CC0']) assert.ok(md.includes(s), s);
  assert.ok(!/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}\b/.test(md), 'no e-mail addresses in the README');
});
