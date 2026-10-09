import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFeed } from '../src/core/feed.js';
import { compileFilter } from '../src/core/filters.js';
import { regionTerms, toFeedOptions, regionForOffset, DEFAULT_POSTED_WITHIN_DAYS } from '../src/remote.js';
import { fakeNetwork, sink, NOW, buildIndex, assertMatchesSchema } from './helpers.mjs';

// Two extra remote postings on a fixture board: one open worldwide, one EU-only.
const extra = (id, title, locations, country_codes = []) => ({
  job_id: `greenhouse:acme:${id}`, title, company_name: 'Acme', company_board: 'acme', ats: 'greenhouse', department: 'Engineering',
  team: null, employment_type: null, workplace_type: 'remote', locations, country_codes, remote: true, salary_min: null,
  salary_max: null, salary_currency: null, salary_period: null, posted_at: new Date(NOW - 2 * 86400000).toISOString(), updated_at: null,
  apply_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`, job_url: `https://job-boards.greenhouse.io/acme/jobs/${id}`,
  description_text: 'Build developer tooling.', description_snippet: 'Build developer tooling.', duplicate_sources: [],
  source_url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true', fetched_at: new Date(NOW).toISOString(),
});
const EXTRA = [
  extra(1, 'Backend Developer', ['Remote - Anywhere']),
  extra(2, 'Frontend Developer', ['Remote (EU)']),
  extra(3, 'Platform Developer', ['Rio de Janeiro, Brazil'], ['BR']),
];

async function search(dir, input) {
  const out = sink();
  const net = fakeNetwork();
  const summary = await runFeed(toFeedOptions(input), {
    ...out, indexBaseUrl: pathToFileURL(dir).href, now: () => NOW, hostGaps: {}, fetchJson: net.fetchJson,
  });
  return { summary, rows: out.rows, charges: out.charges };
}

test('input mapping: always remote_only, postedWithinDays defaults to 7, regions become codes + words', () => {
  const o = toFeedOptions({ remote: 'onsite_only' });
  assert.equal(o.remote, 'remote_only', 'remote cannot be overridden');
  assert.equal(o.postedWithinDays, DEFAULT_POSTED_WITHIN_DAYS);
  assert.equal(toFeedOptions({ postedWithinDays: 30 }).postedWithinDays, 30);
  const eu = toFeedOptions({ timezonesOrRegions: ['Europe'], locations: ['Berlin'] });
  assert.ok(eu.countryCodes.includes('DE') && eu.countryCodes.includes('GB'));
  assert.ok(eu.locations.includes('Berlin') && eu.locations.includes('europe') && eu.locations.includes('anywhere'));
  assert.ok(!eu.locations.includes('DE'), 'codes never go to the text matcher');
  assert.throws(() => toFeedOptions({ maxResults: 0 }), /maxResults/);
});

test('region / time-zone resolution', () => {
  const r = (v) => regionTerms([v]).resolved[0][1];
  assert.equal(r('Worldwide/Anywhere'), 'worldwide');
  assert.equal(r('US'), 'us');
  assert.equal(r('EMEA'), 'emea');
  assert.equal(r('Europe'), 'europe');
  assert.equal(r('APAC'), 'apac');
  assert.equal(r('EST'), 'north_america');
  assert.equal(r('CET'), 'europe');
  assert.equal(r('UTC-5'), 'americas');
  assert.equal(r('GMT+1'), 'emea');
  assert.equal(r('UTC+05:30'), 'asia');
  assert.equal(r('IST'), 'IN');
  assert.equal(r('Germany'), 'DE');
  assert.equal(r('PT'), 'PT', 'PT is Portugal, not Pacific Time');
  assert.equal(r('Remote (Benelux)'), 'text');
  assert.equal(regionForOffset(9), 'apac');
  const ww = regionTerms(['Worldwide']);
  assert.deepEqual(ww.codes, []);
  assert.deepEqual(ww.words.sort(), ['anywhere', 'global', 'world wide', 'worldwide']);
});

test('region filter on fixture jobs: US, Europe, Worldwide', () => {
  const jobs = EXTRA.map((j) => ({ ...j }));
  const gitlabUS = { ...extra(9, 'AI Transformation Owner', ['Remote, United States'], ['US']) };
  const all = [...jobs, gitlabUS];
  const pick = (regions) => all.filter((j) => compileFilter(toFeedOptions({ timezonesOrRegions: regions, postedWithinDays: 30 }))(j, NOW)).map((j) => j.title).sort();
  assert.deepEqual(pick(['Worldwide']), ['Backend Developer']);
  assert.deepEqual(pick(['Europe']), ['Backend Developer', 'Frontend Developer']);
  assert.deepEqual(pick(['US']), ['AI Transformation Owner', 'Backend Developer']);
  assert.deepEqual(pick(['LATAM']), ['Backend Developer', 'Platform Developer']);
  assert.deepEqual(pick([]), ['AI Transformation Owner', 'Backend Developer', 'Frontend Developer', 'Platform Developer']);
  assert.ok(!pick(['Europe']).includes('Platform Developer'), '"Rio de Janeiro" does not match the Germany code DE as text');
});

test('search over a local index: remote jobs only, ranked, schema-valid, one job-result charge per row', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'remote-index-'));
  try {
    await buildIndex(dir, { extraJobs: EXTRA });
    const all = await search(dir, { postedWithinDays: 3650, includeDescription: false, maxResults: 100 });
    assert.ok(all.rows.length >= 5);
    assert.ok(all.rows.every((r) => r.workplace_type === 'remote' || r.remote === true));
    assert.equal(all.charges, all.rows.length);
    for (const r of all.rows) assertMatchesSchema(r);

    const dev = await search(dir, { keywords: ['developer'], timezonesOrRegions: ['Europe'], includeDescription: false });
    assert.deepEqual(new Set(dev.rows.map((r) => r.title)), new Set(['Backend Developer', 'Frontend Developer']));
    assert.ok(dev.rows.every((r) => r.matched_in === 'title' && r.match_score === 100));

    const recent = await search(dir, { includeDescription: false });
    assert.ok(recent.rows.every((r) => NOW - Date.parse(r.posted_at) <= 7 * 86400000), 'default: last 7 days');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Workday: remote jobs of a live Workday site come through the remote filter and fit the dataset schema', async () => {
  const out = sink();
  const net = fakeNetwork();
  const summary = await runFeed(toFeedOptions({ companyUrls: ['workday:workday.wd5/Workday'], postedWithinDays: 60 }), {
    ...out, now: () => NOW, hostGaps: {}, fetchJson: net.fetchJson, fetchText: net.fetchText, robotsCache: new Map(),
  });
  assert.equal(summary.mode, 'live');
  assert.ok(out.rows.length >= 2, `${out.rows.length} rows`);
  assert.ok(out.rows.every((r) => r.ats === 'workday' && (r.remote === true || r.workplace_type === 'remote')));
  for (const r of out.rows) assertMatchesSchema(r);
});
