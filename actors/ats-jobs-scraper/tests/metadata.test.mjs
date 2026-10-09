import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { OUTPUT_FIELDS } from '../src/core/feed.js';
import { toScraperOptions } from '../src/scraper.js';

const SLUG = 'ats-jobs-scraper';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));
const schema = JSON.parse(read('INPUT_SCHEMA.json'));

test('actor.json: Store limits, categories, pricing mention', () => {
  assert.equal(actor.name, SLUG);
  assert.ok(actor.title.length <= 60, `title ${actor.title.length} chars`);
  assert.ok(actor.description.length <= 220, `description ${actor.description.length} chars`);
  assert.match(actor.description, /\$3 per 1,000 jobs/);
  assert.deepEqual(actor.categories, ['JOBS', 'LEAD_GENERATION']);
});

test('dataset schema declares exactly the fields the Actor outputs', () => {
  assert.deepEqual(Object.keys(actor.storages.dataset.fields.properties), OUTPUT_FIELDS);
  for (const f of actor.storages.dataset.views.jobs.transformation.fields) assert.ok(OUTPUT_FIELDS.includes(f), f);
});

test('output schema has no resourceType; Dockerfile uses apify/actor-node:22', () => {
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

test('input schema: ats first, prefill and defaults are accepted', () => {
  assert.equal(Object.keys(schema.properties)[0], 'ats');
  assert.deepEqual(schema.properties.ats.items.enum, ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'workday']);
  const prefill = Object.fromEntries(Object.entries(schema.properties).filter(([, p]) => 'prefill' in p).map(([k, p]) => [k, p.prefill]));
  assert.deepEqual(prefill, { ats: ['greenhouse'], keywords: ['product'], maxResults: 20, maxPerCompany: 3 });
  const o = toScraperOptions(prefill);
  assert.deepEqual([o.mode, o.ats, o.keywords, o.maxResults], ['search', ['greenhouse'], ['product'], 20]);
  assert.deepEqual(toScraperOptions({}).ats, [], 'default: all five ATSs');
});

test('README targets ATS-name searches', () => {
  const md = read('README.md');
  for (const k of ['Greenhouse jobs scraper', 'Lever jobs API', 'Ashby job board API', 'Workable jobs', 'Recruitee jobs']) assert.ok(md.includes(k), k);
});

test('README: quick start with the prefilled run cost, suite section before FAQ, sources', () => {
  const md = read('README.md');
  assert.match(md, /## Quick start[\s\S]*\$0\.06/);
  const suite = md.indexOf('## factpipe Jobs & Hiring Data');
  assert.ok(suite > 0 && suite < md.indexOf('## FAQ'));
  for (const s of ['ats-jobs-feed', 'remote-jobs-feed', 'ats-jobs-scraper', 'companies-hiring']) assert.ok(md.includes(`https://apify.com/factpipe/${s}`), s);
  assert.match(md, new RegExp(`apify\\.com/factpipe/${SLUG}\\)[^\\n]*\\(this Actor\\)`));
  for (const s of ['Greenhouse', 'Lever', 'Ashby', 'Workable', 'Recruitee']) assert.ok(md.includes(s), s);
});
