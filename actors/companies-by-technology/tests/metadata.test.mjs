import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TECH_OUTPUT_FIELDS, normalizeTechInput } from '../src/core/technographics.js';

const SLUG = 'companies-by-technology';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));
const schema = JSON.parse(read('INPUT_SCHEMA.json'));
const registry = JSON.parse(readFileSync(new URL('../../../registry.json', import.meta.url), 'utf8'));

test('actor.json: Store limits, categories, pricing mention', () => {
  assert.equal(actor.name, SLUG);
  assert.ok(actor.title.length <= 60, `title ${actor.title.length} chars`);
  assert.ok(actor.description.length <= 220, `description ${actor.description.length} chars`);
  assert.match(actor.description, /\$15 per 1,000 companies/);
  assert.deepEqual(actor.categories, ['LEAD_GENERATION', 'JOBS']);
  assert.ok(actor.minMemoryMbytes >= 2048);
});

test('dataset schema declares exactly the output fields, each with a description', () => {
  const props = actor.storages.dataset.fields.properties;
  assert.deepEqual(Object.keys(props), TECH_OUTPUT_FIELDS);
  for (const [k, p] of Object.entries(props)) assert.ok(p.description && p.description.length > 15, `${k} needs a description`);
  for (const f of actor.storages.dataset.views.companies.transformation.fields) assert.ok(TECH_OUTPUT_FIELDS.includes(f), f);
});

test('output schema: results, all fields, run summary; no resourceType; Dockerfile uses apify/actor-node:22', () => {
  const out = JSON.parse(read('.actor/output_schema.json'));
  assert.deepEqual(Object.keys(out.properties), ['resultsDatasetUrl', 'allFieldsDatasetUrl', 'runSummary']);
  for (const p of Object.values(out.properties)) assert.ok(p.description);
  assert.ok(!read('.actor/output_schema.json').includes('resourceType'));
  assert.match(read('.actor/Dockerfile'), /^FROM apify\/actor-node:22$/m);
});

test('src/lib is the synced shared copy; src/core is the synced ats-jobs-feed core (scripts/sync_jobs_core.py)', () => {
  for (const f of ['http.js', 'incremental.js', 'records.js', 'run_summary.js']) {
    assert.equal(read(`src/lib/${f}`), readFileSync(new URL(`../../company-jobs-scraper/src/lib/${f}`, import.meta.url), 'utf8'), f);
  }
  const src = new URL('../../ats-jobs-feed/src/core/', import.meta.url);
  const files = readdirSync(src).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(readdirSync(new URL('../src/core/', import.meta.url)).filter((f) => f.endsWith('.js')).sort(), files);
  for (const f of files) assert.equal(read(`src/core/${f}`), readFileSync(new URL(f, src), 'utf8'), `core/${f} drifted: run python3 scripts/sync_jobs_core.py`);
});

test('input schema: every property described, prefill and defaults accepted', () => {
  for (const [k, p] of Object.entries(schema.properties)) assert.ok(p.description?.length > 20, `${k} needs a description`);
  const prefill = Object.fromEntries(Object.entries(schema.properties).filter(([, p]) => 'prefill' in p).map(([k, p]) => [k, p.prefill]));
  assert.deepEqual(prefill, { technologies: ['Snowflake'], minJobsMentioning: 2, maxResults: 20 });
  const i = normalizeTechInput(prefill);
  assert.deepEqual([i.technologies.map((t) => t.slug), i.minJobsMentioning, i.maxResults, i.match], [['snowflake'], 2, 20, 'any']);
  assert.equal(schema.properties.maxResults.default, 100);
  assert.deepEqual(schema.properties.match.enum, ['any', 'all']);
});

test('README: quick start with the prefilled run cost, JSON sample, pricing, FAQ, AI agents section, no PII', () => {
  const md = read('README.md');
  assert.match(md, /## Quick start[\s\S]*\$0\.30/);
  assert.match(md, /```json[\s\S]*"technologies_matched"/);
  assert.match(md, /## Pricing[\s\S]*\$15\.00 per 1,000/);
  assert.match(md, /## Use with AI agents \(MCP\)[\s\S]*mcp\.apify\.com\?tools=factpipe\/companies-by-technology/);
  assert.ok(md.indexOf('## Use with AI agents (MCP)') < md.indexOf('## FAQ'));
  assert.match(md, /no person data|No recruiter/i);
  for (const s of ['ats-jobs-feed', 'companies-hiring']) assert.ok(md.includes(`https://apify.com/factpipe/${s}`), s);
});

test('registry: entry with the approved company-result price and tiers; an Apify id once staged', () => {
  const e = registry.actors[SLUG];
  assert.ok(e, 'registry entry');
  assert.ok(['draft', 'staging', 'live'].includes(e.status), e.status);
  if (e.status === 'draft') assert.equal(e.apify_actor_id, null);
  else assert.match(e.apify_actor_id, /^[A-Za-z0-9]{17}$/);
  assert.deepEqual(e.ppe_events['company-result'].store_discount_tiers_usd, { FREE: 0.015, BRONZE: 0.0135, SILVER: 0.012, GOLD: 0.0105 });
  assert.equal(e.listing.title, actor.title);
  assert.equal(e.listing.description, actor.description);
  assert.ok(e.listing.seoTitle.length <= 60 && e.listing.seoDescription.length <= 160);
});
