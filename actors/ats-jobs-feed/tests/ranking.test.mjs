import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFeed } from '../src/core/feed.js';
import { normalizeInput } from '../src/core/filters.js';
import { compileRanker, rankCmp, TopK } from '../src/core/rank.js';
import { createTracker } from '../src/lib/incremental.js';
import { fakeNetwork, sink, NOW, buildIndex } from './helpers.mjs';

const RAMP_SECURITY = 'ashby:ramp:34413f8d-26bf-4bbc-8ade-eb309a0e2245';

async function search(dir, input, { tracker, topK } = {}) {
  const out = sink();
  const net = fakeNetwork();
  const read = [];
  const summary = await runFeed(normalizeInput(input), {
    ...out, indexBaseUrl: pathToFileURL(dir).href, tracker, topK, now: () => NOW, hostGaps: {}, fetchJson: net.fetchJson,
  });
  return { summary, rows: out.rows, charges: out.charges, calls: net.calls, read };
}

const job = (o) => ({ job_id: 'x:y:1', title: '', department: null, team: null, kw: '', posted_at: '2026-09-01T00:00:00Z', ...o });

test('ranker tiers: all keywords in title >> some in title > department/team > description only', () => {
  const rank = compileRanker(['security', 'engineer'], 'any', 'title_and_description');
  const all = rank(job({ title: 'Security Engineer' }));
  const some = rank(job({ title: 'Platform Engineer', kw: 'security cloud' }));
  const someOnly = rank(job({ title: 'Platform Engineer' }));
  const dept = rank(job({ title: 'Analyst', department: 'Security Engineering' }));
  const desc = rank(job({ title: 'Analyst', kw: 'security teams' }));
  assert.deepEqual(all, { score: 100, matched_in: 'title' });
  assert.deepEqual(some, { score: 70, matched_in: 'title' }, 'one in title, one in the description');
  assert.deepEqual(someOnly, { score: 65, matched_in: 'title' });
  assert.deepEqual(dept, { score: 50, matched_in: 'department' });
  assert.deepEqual(desc, { score: 25, matched_in: 'description' });
  assert.ok(all.score > some.score && some.score > someOnly.score && someOnly.score > dept.score && dept.score > desc.score);
  assert.equal(rank(job({ title: 'Chef', kw: 'kitchen' })), null, 'no keyword anywhere -> filtered out');
});

test('ranker: keywordMatch all, scopes, plurals and no-keyword pass-through', () => {
  const allRank = compileRanker(['python', 'django'], 'all');
  assert.equal(allRank(job({ title: 'Python Developer' })), null);
  assert.deepEqual(allRank(job({ title: 'Python Developer', kw: 'django rest' })), { score: 70, matched_in: 'title' });
  const titleOnly = compileRanker(['sales'], 'any', 'title');
  assert.equal(titleOnly(job({ title: 'Account Executive', department: 'Sales' })), null);
  const titleDept = compileRanker(['sales'], 'any', 'title_and_department');
  assert.deepEqual(titleDept(job({ title: 'Account Executive', department: 'Sales' })), { score: 50, matched_in: 'department' });
  assert.equal(titleDept(job({ title: 'Engineer', kw: 'sales' })), null, 'description is out of scope');
  assert.deepEqual(compileRanker(['designer'])(job({ title: 'Analyst', team: 'Designers' })), { score: 50, matched_in: 'department' });
  assert.deepEqual(compileRanker([])(job({ title: 'x' })), { score: null, matched_in: null });
});

test('rank order: score, then newest posted_at, then job_id; TopK keeps exactly the best k', () => {
  const items = [
    { job_id: 'a', match_score: 30, posted_at: '2026-09-20' },
    { job_id: 'b', match_score: 100, posted_at: '2025-01-01' },
    { job_id: 'c', match_score: 100, posted_at: '2026-01-01' },
    { job_id: 'd', match_score: 65, posted_at: '2026-09-24' },
    { job_id: 'e', match_score: 100, posted_at: '2026-01-01' },
  ];
  assert.deepEqual([...items].sort(rankCmp).map((x) => x.job_id), ['c', 'e', 'b', 'd', 'a']);
  const top = new TopK(3);
  for (const x of items) top.push(x);
  assert.deepEqual(top.sorted().map((x) => x.job_id), ['c', 'e', 'b']);
  assert.equal(top.dropped, 2);
});

test('search mode ranks by relevance across all shards: an old title match beats newer description matches', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobs-rank-'));
  try {
    await buildIndex(dir);
    const r = await search(dir, { keywords: ['security', 'engineer'], includeDescription: false, maxResults: 100 });
    assert.ok(r.rows.length >= 4);
    assert.equal(r.rows[0].job_id, RAMP_SECURITY, 'both words in the title, although it is among the oldest postings');
    assert.equal(r.rows[0].match_score, 100);
    assert.equal(r.rows[0].matched_in, 'title');
    for (let i = 1; i < r.rows.length; i += 1) {
      const [a, b] = [r.rows[i - 1], r.rows[i]];
      assert.ok(a.match_score > b.match_score || (a.match_score === b.match_score && a.posted_at >= b.posted_at), `${a.job_id} before ${b.job_id}`);
    }
    const tiers = r.rows.map((x) => ['title', 'department', 'description'].indexOf(x.matched_in));
    assert.deepEqual(tiers, [...tiers].sort((x, y) => x - y), 'title matches first, then department, then description');
    assert.equal(r.summary.ranking, 'relevance');
    assert.equal(r.summary.shards_read, r.summary.shards_total, 'ranking reads every needed shard');

    // A tiny K forces several passes; the delivered order must be identical.
    const paged = await search(dir, { keywords: ['security', 'engineer'], includeDescription: false, maxResults: 100 }, { topK: 2 });
    assert.deepEqual(paged.rows.map((x) => x.job_id), r.rows.map((x) => x.job_id));
    assert.ok(paged.summary.ranking_passes > 1);

    const capped = await search(dir, { keywords: ['security', 'engineer'], includeDescription: false, maxResults: 2 });
    assert.deepEqual(capped.rows.map((x) => x.job_id), r.rows.slice(0, 2).map((x) => x.job_id));
    assert.equal(capped.charges, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ranked runs fetch live descriptions only for the delivered jobs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobs-rank-'));
  try {
    await buildIndex(dir);
    const r = await search(dir, { keywords: ['security', 'engineer'], maxResults: 1 });
    assert.deepEqual(r.rows.map((x) => x.job_id), [RAMP_SECURITY]);
    assert.equal(r.rows[0].description_status, 'included');
    assert.deepEqual(r.calls, ['https://api.ashbyhq.com/posting-api/job-board/ramp?includeCompensation=true']);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('without keywords: newest first, match_score and matched_in are null', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobs-rank-'));
  try {
    await buildIndex(dir);
    const r = await search(dir, { includeDescription: false, maxResults: 100 });
    const posted = r.rows.map((x) => x.posted_at);
    assert.deepEqual(posted, [...posted].sort().reverse());
    assert.ok(r.rows.every((x) => x.match_score === null && x.matched_in === null));
    assert.equal(r.summary.ranking, 'newest');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('sinceLastRun dedupe applies before ranking: a second ranked run delivers and charges nothing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jobs-rank-'));
  try {
    await buildIndex(dir);
    let cursor = null;
    const pass = async () => {
      const tracker = createTracker(cursor);
      const r = await search(dir, { keywords: ['engineer'], sinceLastRun: true, includeDescription: false, maxResults: 3 }, { tracker });
      const next = tracker.next({ truncated: r.summary.stop_reason !== 'exhausted', runSince: tracker.since });
      if (next) cursor = next;
      return r;
    };
    const seen = [];
    for (let i = 0; i < 4; i += 1) seen.push(...(await pass()).rows.map((x) => x.job_id));
    assert.equal(new Set(seen).size, seen.length, 'never a repeat');
    const all = await search(dir, { keywords: ['engineer'], includeDescription: false, maxResults: 100 });
    assert.deepEqual(new Set(seen), new Set(all.rows.map((x) => x.job_id)), 'truncated ranked runs eventually deliver everything');
    const again = await pass();
    assert.equal(again.charges, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('live mode ranks too', async () => {
  const net = fakeNetwork();
  const out = sink();
  await runFeed(normalizeInput({ companyUrls: ['ashby:ramp', 'greenhouse:gitlab'], keywords: ['security', 'engineer'], includeDescription: false }), {
    ...out, fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW, hostGaps: {},
  });
  assert.equal(out.rows[0].job_id, RAMP_SECURITY);
  assert.ok(out.rows.every((x, i) => i === 0 || out.rows[i - 1].match_score >= x.match_score));
});
