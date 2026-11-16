// End to end on golden boards: the nightly IndexWriter (option tech) writes companies_tech.json.gz, the Actor core
// reads it and returns one row per company. Plus input validation, filters, charging and the frozen asset format.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { load, buildGoldenIndex, run, BUILT_AT } from './helpers.mjs';
import {
  normalizeTechInput, techRows, hasTechEvent, TECH_OUTPUT_FIELDS, TECH_ASSET, TECH_EVENT,
} from '../src/core/technographics.js';
import { TECH_ASSET_FILE } from '../src/core/index_writer.js';
import { missingEventMessage } from '../src/core/technographics.js';

const golden = await buildGoldenIndex();
const asset = JSON.parse(gunzipSync(readFileSync(join(golden.dir, golden.manifest.companies_tech))).toString('utf8'));
const slugsOf = (j) => j[0].split('.').map((i) => asset.technologies[Number(i)][0]);
const boardOf = (ats, token) => asset.boards.find((b) => b.a === ats && b.t === token);

test('build: manifest points at the asset; per-ATS coverage and timing are reported', () => {
  assert.equal(TECH_ASSET, TECH_ASSET_FILE);
  assert.equal(golden.manifest.companies_tech, TECH_ASSET);
  const s = golden.manifest.companies_tech_stats;
  assert.deepEqual(s.by_ats.workday, { jobs: 3, with_text: 0, with_tech: 2 });
  assert.deepEqual(s.by_ats.greenhouse, { jobs: 4, with_text: 4, with_tech: 3 });
  assert.equal(s.boards, 4);
  assert.ok(Number.isFinite(s.extract_ms) && s.bytes > 0);
  assert.equal(asset.format, 1);
  assert.equal(asset.built_at, BUILT_AT.toISOString());
});

test('build: precision on the golden boards (negatives in the same posts stay out)', () => {
  const gh = boardOf('greenhouse', 'acmeanalytics');
  assert.equal(gh.o, 4);
  assert.equal(gh.x, 4);
  assert.equal(gh.j.length, 3); // the office-manager post ("throughout the workday", "ASAP") names nothing
  assert.deepEqual(slugsOf(gh.j[0]).sort(), ['airflow', 'aws', 'dbt', 'python', 'snowflake', 'sql']); // not Jenkins (a recruiter's name)
  assert.deepEqual(slugsOf(gh.j[1]).sort(), ['dbt', 'looker', 'snowflake']); // not Excel ("excel at")
  assert.deepEqual(slugsOf(gh.j[2]).sort(), ['gong', 'outreach', 'salesforce', 'zoominfo']); // not Go ("Ready to go?"), not React
  // The ashby copy of "Senior Data Engineer" (same company, title, location) is removed by the index dedupe.
  const ab = boardOf('ashby', 'acmeanalytics');
  assert.equal(ab.o, 1);
  assert.deepEqual(slugsOf(ab.j[0]).sort(), ['aws', 'go', 'kubernetes', 'python', 'rust', 'terraform']);
  // Workday: titles only.
  const wd = boardOf('workday', 'globex.wd5/Globex_Careers');
  assert.equal(wd.x, 0);
  assert.deepEqual(wd.j.map(slugsOf), [['salesforce'], ['sap']]);
  // A vendor's own board: Snowflake's jobs naming Snowflake do not make Snowflake a Snowflake customer.
  assert.deepEqual(slugsOf(boardOf('lever', 'snowflake').j[0]).sort(), ['java', 'kubernetes', 'scala']);
});

test('Snowflake + dbt: one row per company, boards merged, golden row', async () => {
  const { rows, charges, summary } = await run(golden.dir, { technologies: ['Snowflake', 'dbt'] });
  assert.deepEqual(rows, load('expected_snowflake_dbt.json'));
  assert.deepEqual(charges, [TECH_EVENT]);
  assert.equal(summary.rows, 1);
  assert.equal(summary.stop_reason, 'exhausted');
  for (const r of rows) assert.deepEqual(Object.keys(r), TECH_OUTPUT_FIELDS);
});

test('Workday titles count; companies sorted by jobs mentioning', async () => {
  const { rows } = await run(golden.dir, { technologies: ['Salesforce', 'SAP'] });
  assert.deepEqual(rows.map((r) => [r.company_name, r.jobs_mentioning_matched, r.technologies_matched.map((t) => t.technology)]), [
    ['Globex Corporation', 2, ['Salesforce', 'SAP']],
    ['Acme Analytics', 1, ['Salesforce']],
  ]);
  assert.equal(rows[0].jobs_with_text, 0);
  assert.equal(rows[0].careers_url, 'https://globex.wd5.myworkdayjobs.com/Globex_Careers');
});

test('match all, minJobsMentioning, countries, locations, departments', async () => {
  const names = async (input) => (await run(golden.dir, input)).rows.map((r) => `${r.company_name}:${r.jobs_mentioning_matched}`);
  assert.deepEqual(await names({ technologies: ['Snowflake', 'Kubernetes'], match: 'all' }), ['Acme Analytics:3']);
  assert.deepEqual(await names({ technologies: ['Snowflake', 'Salesforce'], match: 'all' }), ['Acme Analytics:3']);
  assert.deepEqual(await names({ technologies: ['Snowflake', 'SAP'], match: 'all' }), []);
  assert.deepEqual(await names({ technologies: ['Kubernetes'] }), ['Acme Analytics Inc.:1', 'Snowflake:1']); // name of the board with the matching jobs
  assert.deepEqual(await names({ technologies: ['Snowflake'], minJobsMentioning: 3 }), []);
  assert.deepEqual(await names({ technologies: ['Snowflake'], countries: ['Germany'] }), ['Acme Analytics:1']);
  assert.deepEqual(await names({ technologies: ['Snowflake'], countries: ['FR'] }), []);
  assert.deepEqual(await names({ technologies: ['Salesforce', 'SAP'], countries: ['DE'] }), ['Globex Corporation:1']);
  assert.deepEqual(await names({ technologies: ['Kubernetes'], locations: ['London'] }), ['Acme Analytics Inc.:1']);
  assert.deepEqual(await names({ technologies: ['Snowflake', 'Salesforce'], departments: ['sales'] }), ['Acme Analytics:1']);
  // Filters narrow technologies_matched, never top_technologies (the whole stack).
  const { rows } = await run(golden.dir, { technologies: ['Snowflake'], countries: ['DE'] });
  assert.deepEqual(rows[0].technologies_matched, [{ technology: 'Snowflake', jobs: 1 }]);
  assert.equal(rows[0].top_technologies.find((t) => t.technology === 'Snowflake').jobs, 2);
});

test('companies lookup without technologies lists the whole stack', async () => {
  const { rows } = await run(golden.dir, { companies: ['Globex'] });
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].technologies_matched, [{ technology: 'Salesforce', jobs: 1 }, { technology: 'SAP', jobs: 1 }]);
  assert.equal(rows[0].jobs_mentioning_matched, 2);
  const one = await run(golden.dir, { companies: ['globex.wd5/Globex_Careers'], technologies: ['SAP'] });
  assert.equal(one.rows.length, 1);
});

test('charging: one company-result per row, maxResults and the charge limit stop the run', async () => {
  const capped = await run(golden.dir, { technologies: ['Kubernetes'], maxResults: 1 });
  assert.equal(capped.rows.length, 1);
  assert.equal(capped.summary.stop_reason, 'max_results');
  const limited = await run(golden.dir, { technologies: ['Kubernetes'] }, { limitAfter: 1 });
  assert.equal(limited.rows.length, 1);
  assert.equal(limited.summary.stop_reason, 'charge_limit');
  const none = await run(golden.dir, { technologies: ['COBOL'] });
  assert.deepEqual([none.rows.length, none.charges.length], [0, 0]); // empty runs are never charged
});

test('input: aliases resolve, unknown names explain themselves, bad values fail', () => {
  const i = normalizeTechInput({ technologies: ['k8s', 'Snowflake', 'snowflake', 'golang', 'Frobnicator'] });
  assert.deepEqual(i.technologies.map((t) => t.slug), ['kubernetes', 'snowflake', 'go']);
  assert.deepEqual(i.unknown, ['Frobnicator']);
  assert.throws(() => normalizeTechInput({ technologies: ['Snowflak'] }), /Unknown technology "Snowflak" \(did you mean Snowflake/);
  assert.throws(() => normalizeTechInput({}), /needs at least one technology/);
  assert.throws(() => normalizeTechInput({ technologies: ['dbt'], match: 'some' }), /"match"/);
  assert.throws(() => normalizeTechInput({ technologies: ['dbt'], countries: ['Atlantis'] }), /Unknown country/);
  assert.throws(() => normalizeTechInput({ technologies: ['dbt'], minJobsMentioning: 0 }), /minJobsMentioning/);
  assert.deepEqual(normalizeTechInput({ technologies: ['dbt'], countries: ['uk', 'Germany', 'us'] }).countries, ['GB', 'DE', 'US']);
  assert.equal(normalizeTechInput({ technologies: ['dbt'], technologyMatch: 'all' }).match, 'all'); // Jobs Feed's name for it
});

test('frozen format-1 asset (golden/companies_tech_v1.json) still reads: older builds stay usable', () => {
  const v1 = load('companies_tech_v1.json');
  const { rows, missing } = techRows(v1, normalizeTechInput({ technologies: ['dbt', 'Kubernetes'] }));
  assert.deepEqual(missing, []);
  assert.deepEqual(rows.map((r) => [r.company_name, r.jobs_mentioning_matched, r.open_jobs_total, r.sample_job_urls.length]), [
    ['Initech', 2, 9, 2],
    ['Hooli', 1, 3, 1],
  ]);
  // A technology the dictionary knows but this (older) data does not: reported, not fatal.
  assert.deepEqual(techRows(v1, normalizeTechInput({ technologies: ['dbt', 'Pulumi'] })).missing, ['pulumi']);
});

test('loading fails clearly on an index without technology data', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cbt-old-'));
  const m = JSON.parse(readFileSync(join(golden.dir, 'manifest.json'), 'utf8'));
  delete m.companies_tech;
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(m));
  writeFileSync(join(dir, TECH_ASSET), gzipSync('{}'));
  await assert.rejects(run(dir, { technologies: ['dbt'] }), /no technology data yet/);
});

test('company rows are valid against this Actor\'s dataset schema (types, enums); Jobs Feed gets the fields with its mode (held until company-result exists)', async () => {
  const rows = [
    ...(await run(golden.dir, { technologies: ['Snowflake', 'Salesforce', 'SAP', 'Kubernetes'] })).rows,
    ...(await run(golden.dir, { companies: ['Acme Analytics'] })).rows,
  ];
  assert.ok(rows.length >= 3);
  for (const path of ['../.actor/actor.json']) {
    const fields = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')).storages.dataset.fields.properties;
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        const spec = fields[key];
        assert.ok(spec, `${path}: ${key} not declared`);
        const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
        const types = [].concat(spec.type);
        assert.ok(types.includes(actual) || (actual === 'integer' && types.includes('number')), `${path}: ${key} is ${actual}`);
        if (spec.enum) assert.ok(spec.enum.includes(value), `${path}: ${key}=${value}`);
      }
    }
  }
});

test('Jobs Feed guard: only runs when the pricing has the company-result event', () => {
  assert.equal(hasTechEvent(null), false);
  assert.equal(hasTechEvent({ 'job-result': { eventPriceUsd: 0.005 } }), false);
  assert.equal(hasTechEvent({ 'job-result': {}, 'company-result': { eventPriceUsd: 0.015 } }), true);
  assert.match(missingEventMessage(), /nothing was run or charged/);
  assert.match(missingEventMessage(), /apify\.com\/factpipe\/companies-by-technology/);
});

test('a technology-detection failure never fails the index build: shards still written, no companies_tech asset', async () => {
  const { mkdtemp, readdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { IndexWriter, TECH_ASSET_FILE } = await import('../src/core/index_writer.js');
  const dir = await mkdtemp(join(tmpdir(), 'cbt-fail-'));
  const w = await new IndexWriter(dir, { builtAt: BUILT_AT, codec: 'gz', tech: true }).open();
  const boards = load('boards.json');
  await w.addBoard(boards[0].board, boards[0].name, boards[0].jobs);
  w.techFailed(new Error('boom'));
  for (const b of boards.slice(1)) await w.addBoard(b.board, b.name, b.jobs);
  const manifest = await w.finish();
  assert.ok(manifest.shards.length > 0);
  assert.equal(manifest.companies_tech, undefined);
  assert.match(manifest.companies_tech_stats.error, /boom/);
  assert.ok(!(await readdir(dir)).includes(TECH_ASSET_FILE));
});
