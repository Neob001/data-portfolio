import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { runFeed, fetchBoard, streamShardLines, FALLBACK_BOARDS, INDEX_BASE_URL, companyNameFromTitle } from '../src/feed.js';
import { normalizeInput } from '../src/filters.js';
import { parseBoardRef } from '../src/transform.js';
import { IndexWriter, SHARD_MAX_GZ } from '../src/index_writer.js';
import { selectShards, AGE_BANDS } from '../src/index_format.js';
import { createTracker } from '../src/lib/incremental.js';
import { fakeNetwork, sink, FIXTURE_BOARDS, NOW, assertMatchesSchema } from './helpers.mjs';

const TOTAL_FIXTURE_JOBS = 11;

async function live(input, { chargeLimit, extra, tracker } = {}) {
  const net = fakeNetwork(extra);
  const out = sink({ chargeLimit });
  const opts = normalizeInput({ companyUrls: FIXTURE_BOARDS.map((b) => `${b.ats}:${b.token}`), ...input });
  const summary = await runFeed(opts, { ...out, fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW, tracker });
  return { summary, rows: out.rows, charges: out.charges, calls: net.calls };
}

/** Build a real index (same writer the builder uses) from the fixture boards into a temp dir. */
async function buildIndex(dir, { extraJobs = [], builtAt = new Date(NOW - 86400000) } = {}) {
  const net = fakeNetwork();
  const writer = await new IndexWriter(dir, { builtAt }).open();
  for (const b of FIXTURE_BOARDS) {
    const r = await fetchBoard(b, { fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => builtAt });
    await writer.addBoard(b, r.company_name, r.jobs);
  }
  if (extraJobs.length) await writer.addBoard({ ats: extraJobs[0].ats, token: extraJobs[0].company_board }, extraJobs[0].company_name, extraJobs);
  return writer.finish();
}

async function search(dir, input, { tracker, chargeLimit, spy } = {}) {
  const out = sink({ chargeLimit });
  const read = [];
  const summary = await runFeed(normalizeInput(input), {
    ...out,
    indexBaseUrl: pathToFileURL(dir).href,
    tracker,
    now: () => NOW,
    streamShardLines: (base, rel) => { read.push(rel); return (spy || streamShardLines)(base, rel); },
    fetchJson: async () => { throw new Error('search mode must not call ATS APIs'); },
  });
  return { summary, rows: out.rows, charges: out.charges, read };
}

test('live mode: all fixture boards, schema-valid rows, one charge per row, newest first', async () => {
  const { summary, rows, charges } = await live({});
  assert.equal(rows.length, TOTAL_FIXTURE_JOBS);
  assert.equal(charges, rows.length, 'exactly one job-result charge per delivered row');
  assert.equal(summary.charged_events, rows.length);
  assert.equal(summary.boards_ok, 5);
  const posted = rows.map((r) => r.posted_at);
  assert.deepEqual(posted, [...posted].sort().reverse());
  const lever = rows.find((r) => r.ats === 'lever');
  assert.equal(lever.company_name, 'Shield AI', 'Lever company name from the hosted board title');
  assert.equal(rows.find((r) => r.ats === 'ashby').company_name, 'Ramp');
  assert.equal(lever.source_url, 'https://api.lever.co/v0/postings/shieldai?mode=json');
  assert.equal(lever.fetched_at, new Date(NOW).toISOString());
  assert.equal(new Set(rows.map((r) => r.job_id)).size, rows.length);
});

test('live mode: a failing board is reported and skipped; the rest still deliver', async () => {
  const net = fakeNetwork();
  const out = sink();
  const summary = await runFeed(normalizeInput({ companyUrls: ['greenhouse:gitlab', 'https://jobs.lever.co/doesnotexist'] }), {
    ...out, fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW,
  });
  assert.equal(out.rows.length, 3);
  assert.equal(summary.boards_failed, 1);
  assert.deepEqual(summary.failed_boards, [{ board: 'lever:doesnotexist', status: 404, failure_class: 'http_error' }]);
});

test('charge decisions: maxResults, charge limit, no charge without rows, description toggle', async () => {
  const capped = await live({ maxResults: 4 });
  assert.equal(capped.rows.length, 4);
  assert.equal(capped.charges, 4);
  assert.equal(capped.summary.stop_reason, 'max_results');

  const limited = await live({}, { chargeLimit: 3 });
  assert.equal(limited.rows.length, 3, 'stops right after eventChargeLimitReached');
  assert.equal(limited.charges, 3);
  assert.equal(limited.summary.stop_reason, 'charge_limit');

  const none = await live({ keywords: ['astronaut underwater basket weaving'] });
  assert.equal(none.rows.length, 0);
  assert.equal(none.charges, 0, 'nothing matched -> nothing charged (no start fee)');
  assert.equal(none.summary.stop_reason, 'exhausted');

  const lean = await live({ includeDescription: false });
  assert.ok(lean.rows.every((r) => r.description_text === null && r.description_snippet));
});

test('live mode dedupes the same opening listed on two ATS boards', async () => {
  const gh = JSON.parse(await readFile(new URL('../golden/greenhouse_jobs.json', import.meta.url), 'utf8'));
  const copy = structuredClone(gh);
  copy.jobs = copy.jobs.slice(0, 1).map((j) => ({ ...j, id: 999, absolute_url: 'https://job-boards.greenhouse.io/gitlab2/jobs/999' }));
  const net = fakeNetwork({ 'https://boards-api.greenhouse.io/v1/boards/gitlab2/jobs?content=true': () => copy });
  const { rows, pushData, charge } = sink();
  await runFeed(normalizeInput({ companyUrls: ['greenhouse:gitlab', 'greenhouse:gitlab2'] }), { pushData, charge, fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW });
  assert.equal(rows.length, 3);
  const kept = rows.find((r) => r.title === 'AI Engineer');
  assert.equal(kept.duplicate_sources.length, 1);
});

test('index builder: sharded gzip index with manifest, directory and cross-ATS dedupe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobs-index-'));
  try {
    const twin = { ...(await live({ companyUrls: ['greenhouse:gitlab'] })).rows[0] };
    const dup = { ...twin, job_id: 'ashby:gitlab:dup-1', ats: 'ashby', company_board: 'gitlab', description_text: null, description_snippet: null };
    const manifest = await buildIndex(dir, { extraJobs: [dup] });
    assert.equal(manifest.format, 1);
    assert.equal(manifest.jobs_before_dedupe, TOTAL_FIXTURE_JOBS + 1);
    assert.equal(manifest.jobs, TOTAL_FIXTURE_JOBS, 'duplicate collapsed');
    assert.equal(manifest.boards, 5, 'the dup-only board kept no jobs, so it is not in the directory');
    assert.deepEqual(Object.keys(manifest.ats_counts).sort(), ['ashby', 'greenhouse', 'lever', 'recruitee', 'workable']);
    for (const s of manifest.shards) {
      assert.ok(s.bytes <= SHARD_MAX_GZ);
      assert.ok(s.band >= 0 && s.band < AGE_BANDS.length);
      const lines = gunzipSync(await readFile(join(dir, s.file))).toString('utf8').trim().split('\n').map((l) => JSON.parse(l));
      assert.equal(lines.length, s.jobs);
      assert.ok(lines.every((j) => j.ats === s.ats));
      const p = lines.map((j) => j.posted_at || '');
      assert.deepEqual(p, [...p].sort().reverse(), 'newest first inside a shard');
    }
    const directory = JSON.parse(gunzipSync(await readFile(join(dir, 'directory.json.gz'))).toString('utf8'));
    assert.deepEqual(directory.find((d) => d[0] === 'lever').slice(0, 4), ['lever', 'shieldai', 'Shield AI', 2]);
    const all = await search(dir, {});
    const kept = all.rows.find((r) => r.job_id === twin.job_id);
    assert.deepEqual(kept.duplicate_sources, ['ashby:gitlab:dup-1']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('search mode over a local index: same rows as live, shard pruning by ats / date / company', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobs-index-'));
  try {
    const manifest = await buildIndex(dir);
    const all = await search(dir, { maxResults: 1000 });
    assert.equal(all.rows.length, TOTAL_FIXTURE_JOBS);
    assert.equal(all.charges, TOTAL_FIXTURE_JOBS);
    assert.equal(all.summary.index_built_at, manifest.built_at);
    const liveRows = (await live({ maxResults: 1000 })).rows;
    assert.deepEqual(all.rows.map((r) => r.job_id).sort(), liveRows.map((r) => r.job_id).sort());
    for (const r of all.rows) assertMatchesSchema(r);

    const onlyLever = await search(dir, { ats: ['lever'] });
    assert.ok(onlyLever.rows.every((r) => r.ats === 'lever') && onlyLever.rows.length === 2);
    assert.ok(onlyLever.read.every((f) => f.includes('/lever-')), `read only lever shards: ${onlyLever.read}`);

    const recent = await search(dir, { postedWithinDays: 3 });
    assert.deepEqual(recent.rows.map((r) => r.job_id), ['recruitee:channable:2751915']);
    assert.ok(recent.read.length < manifest.shards.length, 'older date bands skipped without download');

    const company = await search(dir, { companies: ['Blueground'] });
    assert.equal(company.rows.length, 2);
    assert.ok(company.read.every((f) => f.includes('/workable-')));

    const unknown = await search(dir, { companies: ['Not Indexed Co'] });
    assert.equal(unknown.rows.length, 0);
    assert.equal(unknown.read.length, 0);

    const first = await search(dir, { maxResults: 2 });
    assert.equal(first.rows.length, 2);
    assert.equal(first.summary.stop_reason, 'max_results');
    assert.equal(first.rows[0].job_id, 'recruitee:channable:2751915', 'newest band is streamed first');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('selectShards orders newest band first and prunes by ats and cutoff', () => {
  const manifest = { shards: [
    { ats: 'lever', band: 3, part: 0, posted_to: '2026-09-10' },
    { ats: 'greenhouse', band: 0, part: 0, posted_to: '2026-09-21' },
    { ats: 'greenhouse', band: 8, part: 0, posted_to: '2025-09-18' },
    { ats: 'ashby', band: 0, part: 1, posted_to: '2026-09-21' },
    { ats: 'ashby', band: 0, part: 0, posted_to: '2026-09-21' },
  ] };
  assert.deepEqual(selectShards(manifest, { ats: [] }), [4, 3, 1, 0, 2]);
  assert.deepEqual(selectShards(manifest, { ats: ['greenhouse'] }), [1, 2]);
  assert.deepEqual(selectShards(manifest, { ats: [], postedWithinDays: 7 }, { now: NOW }), [4, 3, 1]);
  assert.deepEqual(selectShards(manifest, { ats: [] }, { since: '2026-09-01' }), [4, 3, 1, 0]);
});

test('incremental (sinceLastRun): second pass returns 0 rows and charges 0; a new job is picked up', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobs-index-'));
  try {
    await buildIndex(dir);
    let cursor = null; // what loadTracker would persist in the named key-value store
    const pass = async (input = {}) => {
      const tracker = createTracker(cursor);
      const r = await search(dir, { sinceLastRun: true, maxResults: 1000, ...input }, { tracker });
      const next = tracker.next({ truncated: r.summary.stop_reason !== 'exhausted', runSince: tracker.since });
      if (next) cursor = next;
      return r;
    };
    const p1 = await pass();
    assert.equal(p1.rows.length, TOTAL_FIXTURE_JOBS);
    assert.equal(p1.charges, TOTAL_FIXTURE_JOBS);
    const p2 = await pass();
    assert.equal(p2.rows.length, 0);
    assert.equal(p2.charges, 0);
    assert.ok(p2.summary.skipped_seen > 0 || p2.read.length === 0);

    // A new posting appears in tomorrow's index.
    const fresh = { ...p1.rows[0], job_id: 'greenhouse:gitlab:1234', title: 'Brand New Role', posted_at: new Date(NOW - 3600000).toISOString(), job_url: 'https://job-boards.greenhouse.io/gitlab/jobs/1234', apply_url: 'https://job-boards.greenhouse.io/gitlab/jobs/1234' };
    await buildIndex(dir, { extraJobs: [fresh] });
    const p3 = await pass();
    assert.deepEqual(p3.rows.map((r) => r.job_id), ['greenhouse:gitlab:1234']);
    assert.equal(p3.charges, 1);
    const p4 = await pass();
    assert.equal(p4.charges, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('incremental with a truncated first run delivers the remainder next time, never a repeat', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobs-index-'));
  try {
    await buildIndex(dir);
    let cursor = null;
    const seen = [];
    for (let i = 0; i < 4; i += 1) {
      const tracker = createTracker(cursor);
      const r = await search(dir, { sinceLastRun: true, maxResults: 5 }, { tracker });
      const next = tracker.next({ truncated: r.summary.stop_reason !== 'exhausted', runSince: tracker.since });
      if (next) cursor = next;
      seen.push(...r.rows.map((x) => x.job_id));
    }
    assert.equal(seen.length, TOTAL_FIXTURE_JOBS);
    assert.equal(new Set(seen).size, TOTAL_FIXTURE_JOBS);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fallback: unreachable index -> live fetch of built-in boards, run still returns rows', async () => {
  const net = fakeNetwork();
  const out = sink();
  const summary = await runFeed(normalizeInput({ keywords: ['engineer'], maxResults: 20 }), {
    ...out,
    indexBaseUrl: pathToFileURL(join(tmpdir(), 'definitely-missing-index')).href,
    fallbackBoards: FIXTURE_BOARDS,
    fetchJson: net.fetchJson,
    fetchText: net.fetchText,
    now: () => NOW,
    log: () => {},
  });
  assert.equal(summary.used_fallback, true);
  assert.equal(summary.mode, 'fallback_live');
  assert.ok(out.rows.length >= 1);
  assert.equal(out.charges, out.rows.length);

  // A corrupt manifest is treated the same way.
  const bad = await runFeed(normalizeInput({ maxResults: 1 }), {
    ...sink(), indexBaseUrl: 'https://index.invalid', readIndexFile: async () => Buffer.from('{"format":99}'),
    fallbackBoards: FIXTURE_BOARDS, fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW,
  });
  assert.equal(bad.used_fallback, true);
  assert.equal(bad.rows, 1);
});

test('built-in fallback boards and index URL are well-formed', () => {
  assert.ok(FALLBACK_BOARDS.length >= 8 && FALLBACK_BOARDS.length <= 12);
  for (const b of FALLBACK_BOARDS) assert.deepEqual(parseBoardRef(`${b.ats}:${b.token}`), b);
  assert.equal(new Set(FALLBACK_BOARDS.map((b) => b.ats)).size >= 3, true);
  assert.match(INDEX_BASE_URL, /^https:\/\//);
});

test('company name from hosted board titles', () => {
  assert.equal(companyNameFromTitle('lever', '<title>Shield AI</title>'), 'Shield AI');
  assert.equal(companyNameFromTitle('ashby', '<title>Ramp Jobs</title>'), 'Ramp');
  assert.equal(companyNameFromTitle('ashby', '<title>Jobs</title>'), null);
  assert.equal(companyNameFromTitle('lever', ''), null);
});
