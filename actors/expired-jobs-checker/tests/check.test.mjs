import test from 'node:test';
import assert from 'node:assert/strict';
import { streamShardLines } from '../src/core/feed.js';
import {
  normalizeCheckInput, runCheck, parseJobId, parseItem, urlKey, OUTPUT_FIELDS, BUILD_CAPS, MAX_INPUTS,
} from '../src/check.js';
import { SAMPLE, NOW, buildSampleIndex, makeJob, sink } from './helpers.mjs';

const rec = (ats, i = 0) => SAMPLE.records.filter((r) => r.ats === ats)[i];
const boardOf = (id) => id.slice(0, id.lastIndexOf(':'));

async function check(dir, input, { out = sink(), deadline, spy, batchSize } = {}) {
  const read = [];
  const summary = await runCheck(normalizeCheckInput(input), {
    indexBaseUrl: dir, now: () => NOW, room: out.room, deliver: out.deliver, deadline, batchSize,
    streamShardLines: (base, rel, o) => { read.push(rel); return (spy || streamShardLines)(base, rel, o); },
  });
  return { summary, rows: out.rows, charges: out.charges, read };
}

// Index for most tests: the real sample + a Workday site at the build cap, one just below it, and two boards
// listing the same opening (one copy is collapsed into the other's duplicate_sources).
const CAPPED = { ats: 'workday', token: 'bigco.wd5/External' };
const UNDER = { ats: 'workday', token: 'midco.wd1/Careers' };
const DUP_A = { ats: 'greenhouse', token: 'dupa' };
const DUP_B = { ats: 'greenhouse', token: 'dupb' };
const same = { title: 'Same Opening', company_name: 'Dup Co', locations: ['Berlin'] };
let shared;
async function index() {
  shared ||= buildSampleIndex({
    extraBoards: [
      { board: CAPPED, name: 'BigCo', jobs: Array.from({ length: BUILD_CAPS.workday }, (_, i) => makeJob(CAPPED, i, { id: `R${1000 + i}` })) },
      { board: UNDER, name: 'MidCo', jobs: Array.from({ length: BUILD_CAPS.workday - 1 }, (_, i) => makeJob(UNDER, i, { id: `R${1000 + i}` })) },
      { board: DUP_A, name: 'Dup Co', jobs: [makeJob(DUP_A, 1, { id: '111', ...same })] },
      { board: DUP_B, name: 'Dup Co', jobs: [makeJob(DUP_B, 1, { id: '222', ...same })] },
    ],
  });
  return shared;
}

test('input: job ids and URLs, exact duplicates collapsed, order kept, limits', () => {
  const n = normalizeCheckInput({ jobIds: ['a:b:c', ' greenhouse:x:1 ', 'greenhouse:x:1'], jobUrls: 'https://x.test/1\nhttps://x.test/2' });
  assert.deepEqual(n.items.map((i) => [i.kind, i.input]), [['job_id', 'a:b:c'], ['job_id', 'greenhouse:x:1'], ['url', 'https://x.test/1'], ['url', 'https://x.test/2']]);
  assert.equal(n.duplicates, 1);
  assert.throws(() => normalizeCheckInput({}), /at least one job/);
  assert.equal(MAX_INPUTS, 200000);
  assert.throws(() => normalizeCheckInput({ jobIds: Array.from({ length: MAX_INPUTS + 1 }, (_, i) => `greenhouse:x:${i}`) }), /At most/);
});

test('job_id parsing: platform, lowercase board token, posting id kept as is', () => {
  assert.deepEqual(parseJobId('Greenhouse:GitLab:8396674002'), { ats: 'greenhouse', token: 'gitlab', jobId: 'greenhouse:gitlab:8396674002' });
  assert.deepEqual(parseJobId('workday:redhat.wd5/jobs:R-043519'), { ats: 'workday', token: 'redhat.wd5/jobs', jobId: 'workday:redhat.wd5/jobs:R-043519' });
  assert.equal(parseJobId('lever:eu:acme:5168e8fd').jobId, 'lever:acme:5168e8fd');
  for (const bad of ['', 'gitlab:123', 'smartrecruiters:acme:1', 'greenhouse::1', 'greenhouse:gitlab:']) assert.equal(parseJobId(bad), null, bad);
});

test('job URLs of real sample records: posting id -> job_id where the URL names the board, else matched by URL', () => {
  let byId = 0;
  for (const r of SAMPLE.records) {
    const p = parseItem({ kind: 'url', input: r.job_url });
    assert.equal(p.urlKey, urlKey(r.job_url));
    if (r.ats === 'recruitee') { assert.equal(p.jobId, null, r.job_url); assert.ok(p.jobShaped, r.job_url); continue; }
    // Company careers pages (embedded Greenhouse), apply.workable.com/j/<code>, Teamtailor custom domains and group
    // sites: the URL does not name the indexed board, so the job is found by URL (see the end-to-end test below).
    if (p.jobId !== r.job_id) { assert.ok(!p.boardKey || p.boardKey !== boardOf(r.job_id), r.job_url); continue; }
    byId += 1;
  }
  assert.ok(byId >= 30, `${byId} sample URLs resolve to their job_id directly`);
  assert.equal(urlKey('https://acme.wd5.myworkdayjobs.com/en-US/External/job/Berlin/Eng_R1/'), urlKey('https://acme.wd5.myworkdayjobs.com/External/job/Berlin/Eng_R1'));
  assert.equal(urlKey('https://www.acme.com/careers?gh_jid=42&utm_source=x'), 'acme.com/careers?gh_jid=42');
  assert.equal(parseItem({ kind: 'url', input: 'https://jobs.lever.co/acme' }).jobShaped, false, 'a board URL is not a job');
});

test('open / closed / unknown classification, one row per input in input order, schema-valid', async () => {
  const { dir, manifest } = await index();
  const gh = rec('greenhouse');
  const lv = rec('lever', 1);
  const wd = rec('workday');
  const rc = rec('recruitee');
  const jobIds = [
    gh.job_id, // open
    `workday:${boardOf(wd.job_id).slice('workday:'.length).toUpperCase()}:${wd.job_id.slice(wd.job_id.lastIndexOf(':') + 1)}`, // open: the board token is case-insensitive
    `${boardOf(gh.job_id)}:999999999999`, // closed: board indexed, job gone
    `workday:${UNDER.token.toLowerCase()}:R999999`, // closed: board just under the build cap
    `workday:${CAPPED.token.toLowerCase()}:R999999`, // unknown: board at the build cap
    'greenhouse:no-such-board:1', // unknown: board not in the index
    'greenhouse:dupb:222', // open: collapsed duplicate of dupa
    'hello world', // unknown: not a job id
  ];
  const jobUrls = [lv.job_url, rc.job_url, `${rc.job_url}-gone`, 'https://jobs.lever.co/acme', 'https://unknown.example/jobs/1'];
  const { rows, summary, charges } = await check(dir, { jobIds, jobUrls });
  assert.deepEqual(rows.map((r) => r.input), [...jobIds, ...jobUrls]);
  const st = rows.map((r) => `${r.status}/${r.status_reason}`);
  assert.deepEqual(st, [
    'open/in_index',
    'open/in_index',
    'closed/not_in_index',
    'closed/not_in_index',
    'unknown/board_partially_indexed',
    'unknown/board_not_in_index',
    'open/duplicate_in_index',
    'unknown/unrecognized_input',
    'open/in_index',
    'open/in_index',
    'closed/not_in_index',
    'unknown/unrecognized_input',
    'unknown/unrecognized_input',
  ]);
  for (const r of rows) assert.deepEqual(Object.keys(r), OUTPUT_FIELDS);
  const open = rows[0];
  assert.equal(open.job_id, gh.job_id);
  assert.equal(open.title, gh.title);
  assert.equal(open.company_name, gh.company_name);
  assert.equal(open.last_seen_index_built_at, manifest.built_at);
  assert.match(open.source_url, /^https:\/\/boards-api\.greenhouse\.io\//);
  assert.equal(open.fetched_at, SAMPLE.boards[`greenhouse:${gh.company_board}`].f);
  const closed = rows[2];
  assert.equal(closed.title, null);
  assert.equal(closed.last_seen_index_built_at, null);
  assert.equal(closed.company_name, gh.company_name);
  assert.match(closed.source_url, /^https:\/\/boards-api\.greenhouse\.io\/v1\/boards\//);
  const dup = rows[6];
  assert.equal(dup.job_id, 'greenhouse:dupb:222', 'the checked id is reported, the listing is the kept copy');
  assert.match(dup.job_url, /dupa/);
  const unknown = rows[5];
  assert.match(unknown.source_url, /manifest\.json$/);
  assert.equal(unknown.fetched_at, manifest.built_at);
  assert.equal(rows[8].job_id, lv.job_id, 'job URL -> its job_id');
  assert.equal(rows[9].job_id, rc.job_id, 'Recruitee URL -> job_id from the matched record');
  // Charges: one per open/closed row; unknown rows are free.
  assert.equal(charges, rows.filter((r) => r.status !== 'unknown').length);
  assert.equal(summary.charged_events, charges);
  assert.deepEqual([summary.open + summary.closed + summary.unknown, summary.rows], [rows.length, rows.length]);
});

test('reads only the shards it needs: one open job -> only its board\'s shards, no second pass', async () => {
  const { dir, manifest } = await index();
  const gh = rec('greenhouse');
  const { read, summary } = await check(dir, { jobIds: [gh.job_id] });
  assert.equal(summary.shards_read_pass2, 0);
  const files = manifest.shards.map((s) => s.file);
  assert.ok(read.length >= 1 && read.length < files.length, `${read.length} of ${files.length}`);
  for (const f of read) assert.equal(manifest.shards.find((s) => s.file === f).ats, 'greenhouse');
});

test('second pass only for undecided inputs, and only shards of their platform', async () => {
  const { dir, manifest } = await index();
  const lv = rec('lever');
  const { read, summary, rows } = await check(dir, { jobIds: [`${boardOf(lv.job_id)}:00000000-0000-0000-0000-000000000000`] });
  assert.equal(rows[0].status, 'closed');
  for (const f of read) assert.equal(manifest.shards.find((s) => s.file === f).ats, 'lever');
  assert.equal(new Set(read).size, manifest.shards.filter((s) => s.ats === 'lever').length, 'every Lever shard (duplicates may sit anywhere)');
});

test('company careers-page URL of an embedded board is found by URL (all shards scanned for an unknown host)', async () => {
  const { dir } = await index();
  const embedded = SAMPLE.records.find((r) => r.ats === 'greenhouse' && !/greenhouse\.io/.test(r.job_url));
  assert.ok(embedded, 'the sample has an embedded Greenhouse board (careers.airbnb.com)');
  const { rows } = await check(dir, { jobUrls: [embedded.job_url] });
  assert.equal(rows[0].status, 'open');
  assert.equal(rows[0].job_id, embedded.job_id);
});

test('charge limit: stops when the next charged row would exceed it; unknown rows before the cut are free', async () => {
  const { dir } = await index();
  const ids = SAMPLE.records.slice(0, 6).map((r) => r.job_id);
  const input = { jobIds: [ids[0], 'junk 1', ids[1], ids[2], 'junk 2', ids[3], ids[4], ids[5]] };
  const out = sink({ chargeLimit: 3 });
  const { rows, summary, charges } = await check(dir, input, { out, batchSize: 3 });
  assert.equal(charges, 3);
  assert.deepEqual(rows.map((r) => r.input), input.jobIds.slice(0, 5).filter((x, i) => i < 4 || x.startsWith('junk')));
  assert.equal(summary.stop_reason, 'charge_limit');
});

test('run deadline before the second pass: undecided inputs are unknown/not_checked (free), decided ones stay', async () => {
  const { dir } = await index();
  const gh = rec('greenhouse');
  // Time for delivery batches (30 s reserve) but not for a second index pass (90 s).
  const deadline = { hasTimeFor: (ms) => ms < 60000, timeLeftMs: () => 60000 };
  const { rows, summary } = await check(dir, { jobIds: [gh.job_id, `${boardOf(gh.job_id)}:1`], jobUrls: ['https://unknown.example/jobs/1'] }, { deadline });
  assert.equal(summary.shards_read_pass2, 0);
  assert.deepEqual(rows.map((r) => `${r.status}/${r.status_reason}`), ['open/in_index', 'unknown/not_checked', 'unknown/unrecognized_input']);
});

test('every real sample job URL is found open (posting id, URL match, Teamtailor custom domains and group sites)', async () => {
  const { dir } = await index();
  const { rows } = await check(dir, { jobUrls: SAMPLE.records.map((r) => r.job_url) });
  const notOpen = rows.filter((r) => r.status !== 'open').map((r) => r.input);
  assert.deepEqual(notOpen, []);
});

test('an unreadable shard makes only its platform\'s missing jobs unknown/not_checked; other platforms still close', async () => {
  const { dir, manifest } = await index();
  const gh = rec('greenhouse');
  const lv = rec('lever');
  const bad = new Set(manifest.shards.filter((s) => s.ats === 'greenhouse').map((s) => s.file).slice(0, 1));
  async function* failing(base, rel, o) {
    if (bad.has(rel)) throw Object.assign(new Error('HTTP 502'), { failureClass: 'site_down' });
    yield* streamShardLines(base, rel, o);
  }
  const { rows, summary } = await check(dir, { jobIds: [`${boardOf(gh.job_id)}:1`, `${boardOf(lv.job_id)}:1`] }, { spy: failing });
  assert.ok(summary.shards_failed >= 1);
  assert.deepEqual(rows.map((r) => `${r.status}/${r.status_reason}`), ['unknown/not_checked', 'closed/not_in_index']);
});
