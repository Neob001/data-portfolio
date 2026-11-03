import test from 'node:test';
import assert from 'node:assert/strict';
import { readIndexFile } from '../src/core/feed.js';
import { seniorityFor } from '../src/core/enrich.js';
import { normalizeBulkInput, runBulk, bulkFilterIdentity, OUTPUT_FIELDS, MAX_RESULTS_DEFAULT } from '../src/bulk.js';
import { loadSeen, dayOf } from '../src/seen.js';
import { SAMPLE, NOW, BUILT_AT, buildSampleIndex, makeJob, sink, memoryStore } from './helpers.mjs';

const UNIQUE = new Set(SAMPLE.records.map((r) => r.job_id)).size;
const today = dayOf(BUILT_AT.getTime());

async function run(dir, input, { out = sink(), seen = null, batchSize = 7, deadline, readFile } = {}) {
  const summary = await runBulk(normalizeBulkInput(input), {
    indexBaseUrl: dir, now: () => NOW, batchSize, seen, deadline, room: out.room, deliver: out.deliver,
    ...(readFile ? { readIndexFile: readFile } : {}),
  });
  return { summary, rows: out.rows, batches: out.batches };
}

/** One scheduled run with sinceLastRun: load the state, run, save it (what main.js does). */
async function incremental(dir, store, input, opts = {}) {
  const o = normalizeBulkInput(input);
  const state = await loadSeen(store, bulkFilterIdentity(o));
  const r = await run(dir, input, { ...opts, seen: state.seen });
  await state.save({ complete: r.summary.complete, today, indexBuiltAt: r.summary.index_built_at });
  return r;
}

test('input: defaults, validation, sinceLastRun on by default', () => {
  const o = normalizeBulkInput({});
  assert.deepEqual(o, { ats: [], countries: [], remote: 'any', seniority: [], postedWithinDays: null, sinceLastRun: true, maxResults: MAX_RESULTS_DEFAULT, fields: null });
  assert.equal(MAX_RESULTS_DEFAULT, 100000);
  assert.deepEqual(normalizeBulkInput({ countries: ['us', 'uk'], ats: ['Workday'] }).countries, ['US', 'GB']);
  assert.throws(() => normalizeBulkInput({ ats: ['smartrecruiters'] }), /Unknown ATS/);
  assert.throws(() => normalizeBulkInput({ countries: ['Germany'] }), /ISO 3166/);
  assert.throws(() => normalizeBulkInput({ seniority: ['ninja'] }), /Unknown seniority/);
  assert.throws(() => normalizeBulkInput({ maxResults: 2000001 }), /1 to 2000000/);
  assert.throws(() => normalizeBulkInput({ fields: ['title', 'salary'] }), /Unknown output field "salary"/);
  assert.equal(normalizeBulkInput({ sinceLastRun: false }).sinceLastRun, false);
});

test('whole index: every job once, schema-valid rows, no descriptions, seniority from the title, batches', async () => {
  const { dir, manifest } = await buildSampleIndex();
  const { summary, rows, batches } = await run(dir, { sinceLastRun: false });
  assert.equal(rows.length, UNIQUE);
  assert.equal(new Set(rows.map((r) => r.job_id)).size, rows.length);
  assert.equal(summary.charged_events, rows.length, 'one job-result per delivered row');
  assert.equal(summary.stop_reason, 'exhausted');
  assert.equal(summary.complete, true);
  assert.equal(summary.shards_read, manifest.shards.length);
  assert.ok(batches.every((n) => n <= 7) && batches.length === Math.ceil(UNIQUE / 7), `batches ${batches}`);
  for (const r of rows) {
    assert.deepEqual(Object.keys(r), OUTPUT_FIELDS);
    assert.equal(r.description_text, null);
    assert.equal(r.description_status, 'not_requested');
    assert.equal(r.match_score, null);
    assert.equal(r.visa_sponsorship, null);
    const rec = SAMPLE.records.find((x) => x.job_id === r.job_id);
    assert.equal(r.seniority, seniorityFor(rec.title, rec.seniority_hint ?? null));
    assert.match(r.source_url, /^https:\/\//);
    assert.match(r.fetched_at, /^2026-11-02T/);
  }
  assert.ok(rows.some((r) => r.seniority === 'senior'), 'title levels derived');
  // Newest band first: the first row is no older than any later row's band allows.
  assert.ok(rows[0].posted_at >= rows[rows.length - 1].posted_at);
});

test('filters: ats, countries, remote, seniority, postedWithinDays (each row satisfies them)', async () => {
  const { dir } = await buildSampleIndex();
  const cases = [
    [{ ats: ['workday', 'lever'] }, (r) => ['workday', 'lever'].includes(r.ats)],
    [{ countries: ['US'] }, (r) => r.country_codes.includes('US')],
    [{ remote: 'remote_only' }, (r) => r.workplace_type === 'remote' || r.remote === true],
    [{ remote: 'onsite_only' }, (r) => !(r.workplace_type === 'remote' || r.remote === true)],
    [{ seniority: ['senior', 'lead'] }, (r) => ['senior', 'lead'].includes(r.seniority)],
    [{ postedWithinDays: 2 }, (r) => r.posted_at && NOW - Date.parse(r.posted_at) <= 2 * 86400000],
  ];
  for (const [input, ok] of cases) {
    const { rows } = await run(dir, { ...input, sinceLastRun: false });
    assert.ok(rows.length > 0, `${JSON.stringify(input)} matches some sample jobs`);
    assert.ok(rows.length < UNIQUE, `${JSON.stringify(input)} filters something out`);
    for (const r of rows) assert.ok(ok(r), `${JSON.stringify(input)}: ${r.job_id}`);
  }
});

test('fields: rows keep only the selected fields, in schema order', async () => {
  const { dir } = await buildSampleIndex();
  const out = sink({ partial: true });
  const { rows } = await run(dir, { sinceLastRun: false, fields: ['job_url', 'title', 'job_id', 'posted_at'] }, { out });
  assert.equal(rows.length, UNIQUE);
  for (const r of rows) assert.deepEqual(Object.keys(r), ['job_id', 'title', 'posted_at', 'job_url']);
});

test('sinceLastRun: truncated runs continue where they stopped, then 0 new jobs; state survives a reload', async () => {
  const { dir } = await buildSampleIndex();
  const store = memoryStore();
  const seenIds = new Set();
  let runs = 0;
  for (;;) {
    runs += 1;
    const { rows, summary } = await incremental(dir, store, { maxResults: 20 });
    for (const r of rows) {
      assert.ok(!seenIds.has(r.job_id), `${r.job_id} delivered twice`);
      seenIds.add(r.job_id);
    }
    if (summary.stop_reason === 'exhausted') break;
    assert.equal(summary.stop_reason, 'max_results');
    assert.equal(rows.length, 20);
  }
  assert.equal(runs, Math.ceil(UNIQUE / 20));
  assert.equal(seenIds.size, UNIQUE);
  const again = await incremental(dir, store, { maxResults: 20 });
  assert.equal(again.rows.length, 0, 'second pass after a complete run delivers nothing');
  assert.equal(again.summary.skipped_seen, UNIQUE);
  // Another filter set is another feed.
  const other = await incremental(dir, store, { ats: ['greenhouse'] });
  assert.ok(other.rows.length > 0 && other.rows.every((r) => r.ats === 'greenhouse'));
  // State is chunked binary + a meta record in the named store.
  const metaKey = [...store.m.keys()].find((k) => !/-g\d+-\d+$/.test(k) && store.m.get(k).format === 1);
  assert.ok(metaKey.startsWith('CURSOR-'));
});

test('sinceLastRun: a job that joins the index with an OLD posting date is still delivered (no date watermark)', async () => {
  const board = { ats: 'greenhouse', token: 'latecomer' };
  const store = memoryStore();
  const first = await buildSampleIndex();
  await incremental(first.dir, store, {});
  const old = makeJob(board, 1, { posted_at: '2026-06-01T00:00:00.000Z' });
  const second = await buildSampleIndex({ extraBoards: [{ board, name: 'Latecomer', jobs: [old] }] });
  const { rows } = await incremental(second.dir, store, {});
  assert.deepEqual(rows.map((r) => r.job_id), [old.job_id]);
});

test('a job_id the index holds twice is delivered and charged once', async () => {
  const board = { ats: 'workable', token: 'twice' };
  const a = makeJob(board, 1, { id: 'ABC123', locations: ['Porto'] });
  const b = { ...a, locations: ['Lisbon'], country_codes: ['PT'] }; // same job_id, different dedupe key
  const { dir } = await buildSampleIndex({ records: [], extraBoards: [{ board, name: 'Twice', jobs: [a, b] }] });
  const { rows, summary } = await run(dir, { sinceLastRun: false });
  assert.equal(rows.length, 1);
  assert.equal(summary.repeated_in_index, 1);
});

test('charge limit: stops at the user\'s max charge, never pushes an unpaid row', async () => {
  const { dir } = await buildSampleIndex();
  for (const limit of [1, 7, 10, 20]) {
    const out = sink({ chargeLimit: limit });
    const { rows, summary } = await run(dir, { sinceLastRun: false }, { out });
    assert.equal(rows.length, limit, `limit ${limit}`);
    assert.equal(summary.charged_events, limit);
    assert.equal(summary.stop_reason, 'charge_limit');
    assert.equal(summary.complete, false);
  }
  // The platform's eventChargeLimitReached flag stops the run too.
  const out = sink({ limitFlagAt: 14 });
  const { rows, summary } = await run(dir, { sinceLastRun: false }, { out });
  assert.equal(rows.length, 14);
  assert.equal(summary.stop_reason, 'charge_limit');
});

test('charge limit with sinceLastRun: the next run continues with the undelivered jobs', async () => {
  const { dir } = await buildSampleIndex();
  const store = memoryStore();
  const a = await incremental(dir, store, {}, { out: sink({ chargeLimit: 25 }) });
  assert.equal(a.rows.length, 25);
  const b = await incremental(dir, store, {});
  assert.equal(b.rows.length, UNIQUE - 25);
  assert.equal(new Set([...a.rows, ...b.rows].map((r) => r.job_id)).size, UNIQUE);
});

test('run deadline: no batch is started without enough time left; the run ends cleanly', async () => {
  const { dir } = await buildSampleIndex();
  let calls = 0;
  const deadline = { hasTimeFor: () => { calls += 1; return calls <= 2; }, timeLeftMs: () => 0 };
  const { rows, summary } = await run(dir, { sinceLastRun: false }, { deadline });
  assert.equal(rows.length, 14, 'two batches of 7');
  assert.equal(summary.stop_reason, 'deadline');
});

test('a shard that fails to download is skipped (run incomplete); all failing is an error', async () => {
  const { dir, manifest } = await buildSampleIndex();
  const bad = manifest.shards[0].file;
  const readFile = (base, rel, o) => (rel === bad ? Promise.reject(new Error('HTTP 502')) : readIndexFile(base, rel, o));
  const { rows, summary } = await run(dir, { sinceLastRun: false }, { readFile });
  assert.equal(summary.shards_failed, 1);
  assert.equal(summary.complete, false);
  assert.equal(rows.length, UNIQUE - manifest.shards[0].jobs);
  const allBad = (base, rel, o) => (rel.includes('shard') ? Promise.reject(new Error('HTTP 502')) : readIndexFile(base, rel, o));
  await assert.rejects(run(dir, { sinceLastRun: false }, { readFile: allBad }), /all \d+ index shards failed/);
});
