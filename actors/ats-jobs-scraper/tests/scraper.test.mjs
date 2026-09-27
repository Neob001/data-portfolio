import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFeed } from '../src/core/feed.js';
import { toScraperOptions } from '../src/scraper.js';
import { fakeNetwork, sink, NOW, buildIndex, assertMatchesSchema, FIXTURE_BOARDS } from './helpers.mjs';

async function run(input, { dir } = {}) {
  const out = sink();
  const net = fakeNetwork();
  const read = [];
  const { streamShardLines } = await import('../src/core/feed.js');
  const summary = await runFeed(toScraperOptions(input), {
    ...out, indexBaseUrl: dir ? pathToFileURL(dir).href : undefined, now: () => NOW, hostGaps: {},
    fetchJson: net.fetchJson, fetchText: net.fetchText,
    streamShardLines: (base, rel) => { read.push(rel); return streamShardLines(base, rel); },
  });
  return { summary, rows: out.rows, charges: out.charges, calls: net.calls, read };
}

test('ats selection: only the chosen platforms, other ATS shards never downloaded', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ats-index-'));
  try {
    await buildIndex(dir);
    const gl = await run({ ats: ['greenhouse', 'lever'], includeDescription: false }, { dir });
    assert.deepEqual(new Set(gl.rows.map((r) => r.ats)), new Set(['greenhouse', 'lever']));
    assert.equal(gl.rows.length, 5);
    assert.ok(gl.read.every((f) => /\/(greenhouse|lever)-/.test(f)), gl.read.join(','));
    for (const r of gl.rows) assertMatchesSchema(r);
    assert.equal(gl.charges, gl.rows.length);

    const all = await run({ includeDescription: false }, { dir });
    assert.equal(new Set(all.rows.map((r) => r.ats)).size, 5, 'empty ats = all five');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('companies + keywords: ranked, company-restricted', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ats-index-'));
  try {
    await buildIndex(dir);
    const r = await run({ ats: ['greenhouse', 'ashby'], companies: ['GitLab', 'ramp'], keywords: ['engineer'], includeDescription: false }, { dir });
    assert.ok(r.rows.length >= 3);
    assert.ok(r.rows.every((x) => ['gitlab', 'ramp'].includes(x.company_board)));
    assert.ok(r.rows.every((x, i) => i === 0 || r.rows[i - 1].match_score >= x.match_score));
    assert.equal(r.rows[0].matched_in, 'title');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('live mode: board URLs and ats:token strings are fetched even when the ats selection excludes them', async () => {
  const r = await run({ ats: ['greenhouse'], companyUrls: ['https://jobs.lever.co/shieldai', 'ashby:ramp'], includeDescription: false });
  assert.equal(r.summary.mode, 'live');
  assert.deepEqual(new Set(r.rows.map((x) => x.ats)), new Set(['lever', 'ashby']));
  for (const x of r.rows) assertMatchesSchema(x);
  const allBoards = await run({ companyUrls: FIXTURE_BOARDS.map((b) => `${b.ats}:${b.token}`), includeDescription: false });
  assert.equal(allBoards.rows.length, 11);
});
