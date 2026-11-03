import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { OUTPUT_FIELDS, STATUSES, STATUS_REASONS, EVENT, BUILD_CAPS, normalizeCheckInput, parseItem } from '../src/check.js';
import { ATS_LIST } from '../src/core/transform.js';

const SLUG = 'expired-jobs-checker';
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));
const schema = JSON.parse(read('INPUT_SCHEMA.json'));
const repo = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

test('actor.json: Store limits, categories, memory from the measured peak', () => {
  assert.equal(actor.name, SLUG);
  assert.ok(actor.title.length <= 60, `title ${actor.title.length} chars`);
  assert.ok(actor.description.length <= 220, `description ${actor.description.length} chars`);
  assert.deepEqual(actor.categories, ['JOBS', 'LEAD_GENERATION']);
  // 100k job_ids over all 79 shards measured at 384 MB peak RSS: 1 GB minimum (see ats-jobs-feed metadata test).
  assert.equal(actor.minMemoryMbytes, 1024);
});

test('dataset schema declares exactly the output fields; enums match the code and list null when nullable', () => {
  const props = actor.storages.dataset.fields.properties;
  assert.deepEqual(Object.keys(props), OUTPUT_FIELDS);
  assert.deepEqual(props.status.enum, STATUSES);
  assert.deepEqual(props.status_reason.enum, STATUS_REASONS);
  assert.deepEqual(props.ats.enum, [...ATS_LIST, null]);
  for (const [k, p] of Object.entries(props)) if (p.enum && [].concat(p.type).includes('null')) assert.ok(p.enum.includes(null), k);
  for (const f of actor.storages.dataset.views.checks.transformation.fields) assert.ok(OUTPUT_FIELDS.includes(f), f);
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

test('build caps match the nightly workflow (a changed cap would turn "unknown" into a wrong "closed")', () => {
  const wf = repo('.github/workflows/jobs-index.yml');
  assert.equal(Number(wf.match(/--workday-max-jobs (\d+)/)[1]), BUILD_CAPS.workday);
  assert.equal(Number(wf.match(/--teamtailor-max-jobs (\d+)/)[1]), BUILD_CAPS.teamtailor);
});

test('input schema: prefill is recognised (5 job ids, 2 job URLs)', () => {
  const p = schema.properties;
  const n = normalizeCheckInput({ jobIds: p.jobIds.prefill, jobUrls: p.jobUrls.prefill });
  assert.equal(n.items.length, 7);
  for (const it of n.items) assert.ok(parseItem(it).jobShaped, it.input);
  assert.deepEqual(Object.keys(p).sort(), ['jobIds', 'jobUrls']);
});

test('README: family structure, pricing left as an owner TODO, suite section before FAQ', () => {
  const md = read('README.md');
  for (const h of ['## Quick start', '## What you get', '## Use cases', '## Input', '## Output fields', '## Pricing', '## factpipe Jobs & Hiring Data', '## FAQ']) assert.ok(md.includes(h), h);
  assert.ok(md.indexOf('## factpipe Jobs & Hiring Data') < md.indexOf('## FAQ'));
  assert.match(md, /TODO\(owner\): Pricing — \$X per 1,000 jobs checked/);
  assert.ok(!/\$\d/.test(md), 'no concrete price before the owner sets it');
  for (const s of ['ats-jobs-feed', 'remote-jobs-feed', 'ats-jobs-scraper', 'companies-hiring', 'greenhouse-jobs-api', 'lever-jobs-api', 'ashby-jobs-api', 'workday-jobs-api', 'company-jobs-scraper', 'jobs-bulk-feed']) {
    assert.ok(md.includes(`https://apify.com/factpipe/${s}`), s);
  }
  assert.match(md, new RegExp(`apify\\.com/factpipe/${SLUG}\\)[^\\n]*\\(this Actor\\)`));
  assert.match(md, /How is this different from the Jobs Feed API \(ats-jobs-feed\)\?/);
  assert.match(md, /10:00 UTC/);
  for (const s of STATUS_REASONS) assert.ok(md.includes(s), `README explains ${s}`);
});

test('registry: staging entry, PPE event without a price yet', () => {
  const reg = JSON.parse(repo('registry.json')).actors[SLUG];
  assert.ok(reg, 'registry.json entry');
  assert.equal(reg.status, 'staging');
  assert.ok(reg.apify_actor_id === null || /^[A-Za-z0-9]{17}$/.test(reg.apify_actor_id), 'no Actor yet, or the private staging Actor');
  assert.match(reg.approval, /publish \+ price pending owner approval/);
  assert.ok(EVENT in reg.ppe_events);
  for (const e of Object.values(reg.ppe_events)) assert.equal(e.proposed_price_usd, null);
  assert.ok(reg.pricing_rationale.length > 40);
  assert.equal(reg.listing.title, actor.title);
});
