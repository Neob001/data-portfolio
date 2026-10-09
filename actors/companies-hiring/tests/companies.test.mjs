import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeCompaniesInput, runCompanies, careersSiteDomain, mergeKey, jobKey, clusterBoards, normToken, CrossBoardCounter, OUTPUT_FIELDS, MAX_TITLES } from '../src/companies.js';
import { IndexWriter } from '../src/core/index_writer.js';
import { fetchBoard } from '../src/core/feed.js';
import { fakeNetwork, sink, NOW, buildIndex, assertMatchesSchema, FIXTURE_BOARDS, WORKDAY_BOARD, load } from './helpers.mjs';

const DAY = 86400000;
// Acme (greenhouse:acme): 14 open jobs, 12 in sales, links on its own careers site.
const DEPTS = ['Sales', 'Sales', 'Sales', 'Sales', 'Sales', 'Sales Ops', 'Sales Ops', 'SMB', 'Enterprise', 'Partnerships', 'Channel', 'Field', 'Engineering', 'Engineering'];
const acme = DEPTS.map((dept, i) => {
  const id = 100 + i;
  const title = dept === 'Engineering' ? `Software Engineer ${i}` : `Account Executive ${i}`;
  const url = `https://careers.acme.com/jobs/${id}?gh_jid=${id}`;
  return {
    job_id: `greenhouse:acme:${id}`, title, company_name: 'Acme Inc', company_board: 'acme', ats: 'greenhouse', department: dept,
    team: null, employment_type: null, workplace_type: i % 2 ? 'remote' : 'unknown', locations: [i < 7 ? 'Remote, United States' : 'Berlin, Germany'],
    country_codes: [i < 7 ? 'US' : 'DE'], remote: i % 2 ? true : null, salary_min: null, salary_max: null, salary_currency: null,
    salary_period: null, posted_at: new Date(NOW - (i < 10 ? 2 : 60) * DAY - i * 1000).toISOString(), updated_at: null,
    apply_url: url, job_url: url, description_text: 'Sell our platform.', description_snippet: 'Sell our platform.', duplicate_sources: [],
    source_url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true', fetched_at: new Date(NOW - DAY).toISOString(),
  };
});

async function run(dir, input, { chargeLimit } = {}) {
  const out = sink({ chargeLimit, event: 'company-result' });
  const summary = await runCompanies(normalizeCompaniesInput(input), {
    ...out, indexBaseUrl: pathToFileURL(dir).href, now: () => NOW, hostGaps: {},
  });
  return { summary, rows: out.rows, charges: out.charges };
}

async function withIndex(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'companies-index-'));
  try {
    await buildIndex(dir, { extraJobs: acme });
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('input defaults and validation', () => {
  const i = normalizeCompaniesInput({});
  assert.deepEqual([i.minMatchingJobs, i.sortBy, i.maxResults, i.opts.keywordScope], [1, 'matching_jobs', 100, 'title_and_department']);
  assert.equal(i.opts.includeDescription, false);
  assert.throws(() => normalizeCompaniesInput({ sortBy: 'size' }), /sortBy/);
  assert.throws(() => normalizeCompaniesInput({ minMatchingJobs: 0 }), /minMatchingJobs/);
  assert.throws(() => normalizeCompaniesInput({ remote: 'maybe' }), /remote/);
});

test('careers-site domain: the host job posts link to, never an ATS or third-party host', () => {
  assert.equal(careersSiteDomain('https://careers.datadoghq.com/detail/1/?gh_jid=1'), 'datadoghq.com');
  assert.equal(careersSiteDomain('https://www.samsara.com/company/careers/roles/8?gh_jid=8'), 'samsara.com');
  assert.equal(careersSiteDomain('https://jobs.cm.com/o/x'), 'cm.com');
  assert.equal(careersSiteDomain('https://job-boards.greenhouse.io/gitlab/jobs/1'), null);
  assert.equal(careersSiteDomain('https://jobs.ashbyhq.com/ramp/1'), null);
  assert.equal(careersSiteDomain('https://apply.workable.com/j/ABC'), null);
  assert.equal(careersSiteDomain('https://channable.recruitee.com/o/x'), null);
  assert.equal(careersSiteDomain('https://acme.wd1.myworkdayjobs.com/x'), null);
  assert.equal(careersSiteDomain('https://app.careerpuck.com/job-board/lyft/job/1'), null);
  assert.equal(careersSiteDomain('not a url'), null);
});

test('one row per company: counts, titles, departments, locations, velocity, domain, schema', () => withIndex(async (dir) => {
  const { rows, charges, summary } = await run(dir, { keywords: ['account executive', 'sales'] });
  assert.equal(charges, rows.length);
  assert.equal(summary.charged_events, rows.length);
  for (const r of rows) {
    assertMatchesSchema(r);
    assert.deepEqual(Object.keys(r), OUTPUT_FIELDS);
  }
  const a = rows[0];
  assert.equal(a.company_board, 'acme', 'most matching jobs first');
  assert.equal(a.company_name, 'Acme Inc');
  assert.equal(a.careers_url, 'https://job-boards.greenhouse.io/acme');
  assert.equal(a.source_url, 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true');
  assert.equal(a.careers_site_domain, 'acme.com');
  assert.deepEqual(a.ats_list, ['greenhouse']);
  assert.deepEqual(a.boards, [{ ats: 'greenhouse', token: 'acme', careers_url: 'https://job-boards.greenhouse.io/acme', open_jobs: 14 }]);
  assert.equal(a.open_jobs_total, 14);
  assert.equal(a.matching_jobs, 12, 'the two engineering jobs do not match');
  assert.equal(a.matching_job_titles.length, MAX_TITLES);
  assert.ok(a.matching_job_titles.every((t) => t.startsWith('Account Executive')));
  assert.deepEqual(a.departments_hiring[0], { department: 'Sales', jobs: 5 });
  assert.equal(a.departments_hiring.length, 5);
  assert.deepEqual(a.locations_hiring, [{ location: 'Berlin, Germany', jobs: 5 }, { location: 'Remote, United States', jobs: 7 }].sort((x, y) => y.jobs - x.jobs));
  assert.equal(a.remote_share, 0.5);
  assert.equal(a.jobs_posted_last_30d, 10, 'all recent jobs of the company, matching or not');
  assert.equal(a.hiring_velocity, Math.round((10 / 14) * 100) / 100);
  assert.equal(a.newest_posting_at, acme[0].posted_at);
  assert.equal(a.sample_job_urls.length, 3);
  assert.ok(rows.some((r) => r.company_board === 'ramp' && r.matching_jobs === 1), 'Ramp: department "Sales"');
}));

test('keyword scope: title only vs department; no keywords counts every open job', () => withIndex(async (dir) => {
  const title = await run(dir, { keywords: ['sales'], keywordScope: 'title' });
  assert.ok(!title.rows.some((r) => r.company_board === 'acme'), 'no Acme title contains "sales"');
  const dept = await run(dir, { keywords: ['sales'] });
  assert.equal(dept.rows.find((r) => r.company_board === 'acme').matching_jobs, 7, 'Sales + Sales Ops departments');
  const all = await run(dir, {});
  assert.equal(all.rows.length, 6, 'five fixture boards + Acme');
  for (const r of all.rows) assert.equal(r.matching_jobs, r.open_jobs_total);
}));

test('filters: minMatchingJobs, excludeCompanies, locations, remote, postedWithinDays', () => withIndex(async (dir) => {
  assert.deepEqual((await run(dir, { minMatchingJobs: 3 })).rows.map((r) => r.company_board), ['acme', 'gitlab']);
  assert.ok(!(await run(dir, { excludeCompanies: ['Acme'] })).rows.some((r) => r.company_board === 'acme'));
  const de = await run(dir, { keywords: ['account executive'], locations: ['DE'] });
  assert.equal(de.rows[0].matching_jobs, 5, 'Berlin account executives');
  const remote = await run(dir, { keywords: ['account executive'], remote: 'remote_only' });
  assert.equal(remote.rows[0].remote_share, 1);
  const recent = await run(dir, { keywords: ['account executive'], postedWithinDays: 30 });
  assert.equal(recent.rows[0].matching_jobs, 10);
  assert.equal(recent.rows[0].open_jobs_total, 14, 'open_jobs_total is never narrowed by filters');
}));

test('sortBy hiring_velocity / newest; maxResults and the charge limit', () => withIndex(async (dir) => {
  const vel = await run(dir, { sortBy: 'hiring_velocity' });
  const v = vel.rows.map((r) => r.hiring_velocity);
  assert.deepEqual(v, [...v].sort((x, y) => y - x));
  const newest = await run(dir, { sortBy: 'newest' });
  const n = newest.rows.map((r) => r.newest_posting_at);
  assert.deepEqual(n, [...n].sort().reverse());
  const capped = await run(dir, { maxResults: 2 });
  assert.equal(capped.rows.length, 2);
  assert.equal(capped.summary.stop_reason, 'max_results');
  const limited = await run(dir, {}, { chargeLimit: 1 });
  assert.equal(limited.rows.length, 1);
  assert.equal(limited.summary.stop_reason, 'charge_limit');
  const none = await run(dir, { keywords: ['astronaut'] });
  assert.equal(none.charges, 0);
}));

test('fallback: unreachable index -> live boards are aggregated, run still returns rows', async () => {
  const net = fakeNetwork();
  const out = sink({ event: 'company-result' });
  const summary = await runCompanies(normalizeCompaniesInput({}), {
    ...out, indexBaseUrl: pathToFileURL(join(tmpdir(), 'no-such-index')).href, fallbackBoards: FIXTURE_BOARDS,
    fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW, hostGaps: {},
  });
  assert.equal(summary.used_fallback, true);
  assert.equal(out.rows.length, 5);
  for (const r of out.rows) assertMatchesSchema(r);
  assert.equal(out.rows.find((r) => r.ats === 'lever').company_name, 'Shield AI');
});

// ---- company merge: Acme also has an Ashby board ("ACME, Ltd.") listing 3 of the same openings with
// different location text (same country), plus 2 openings of its own.
function acmeAshby() {
  const pick = [0, 1, 7]; // two US account executives, one Berlin account executive
  const copies = pick.map((i) => ({
    ...acme[i], job_id: `ashby:acmeltd:c${i}`, ats: 'ashby', company_board: 'acmeltd', company_name: 'ACME, Ltd.',
    locations: [acme[i].country_codes[0] === 'US' ? 'United States (Remote)' : 'Berlin'],
    job_url: `https://jobs.ashbyhq.com/acmeltd/c${i}`, apply_url: `https://jobs.ashbyhq.com/acmeltd/c${i}/application`,
    source_url: 'https://api.ashbyhq.com/posting-api/job-board/acmeltd?includeCompensation=true',
  }));
  const own = [0, 1].map((i) => ({
    ...acme[i], job_id: `ashby:acmeltd:o${i}`, ats: 'ashby', company_board: 'acmeltd', company_name: 'ACME, Ltd.',
    title: `Sales Engineer ${i}`, department: 'Sales', locations: ['Paris, France'], country_codes: ['FR'],
    job_url: `https://jobs.ashbyhq.com/acmeltd/o${i}`, apply_url: `https://jobs.ashbyhq.com/acmeltd/o${i}/application`,
    source_url: 'https://api.ashbyhq.com/posting-api/job-board/acmeltd?includeCompensation=true',
  }));
  return [...copies, ...own];
}

async function withMergedIndex(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'companies-merge-'));
  try {
    const builtAt = new Date(NOW - DAY);
    const net = fakeNetwork();
    const writer = await new IndexWriter(dir, { builtAt }).open();
    for (const b of FIXTURE_BOARDS) {
      const r = await fetchBoard(b, { fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => builtAt });
      await writer.addBoard(b, r.company_name, r.jobs);
    }
    await writer.addBoard({ ats: 'greenhouse', token: 'acme' }, 'Acme Inc', acme);
    await writer.addBoard({ ats: 'ashby', token: 'acmeltd' }, 'ACME, Ltd.', acmeAshby());
    const manifest = await writer.finish();
    assert.equal(manifest.boards, 7, 'the index keeps both boards (location text differs, so its own dedupe does not collapse them)');
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('merge key: case, punctuation and legal suffixes are ignored; job key uses country codes', () => {
  for (const n of ['Acme Inc', 'ACME, Ltd.', 'Acme GmbH', 'acme llc', 'Acme S.A.', 'Acme B.V.', 'Acme plc', 'Acme Corp.', 'Acme Co', 'Acme, Inc.', 'ACME LIMITED']) {
    assert.equal(mergeKey(n, 'ashby', 'x'), 'acme', n);
  }
  assert.notEqual(mergeKey('Acme Robotics', 'ashby', 'x'), 'acme', 'a different word is a different company');
  assert.equal(mergeKey('', 'lever', 'Foo'), 'lever:foo', 'no name -> the board itself');
  assert.equal(mergeKey('Inc.', 'ashby', 'bar'), 'ashby:bar', 'a name that is only a legal form -> the board itself');
  assert.equal(mergeKey('J.P. Morgan', 'greenhouse', 'x'), 'jpmorgan');
  assert.equal(mergeKey('Canvas Medical', 'ashby', 'x'), mergeKey('canvasmedical', 'lever', 'y'), 'spacing differences merge');
  assert.equal(jobKey({ title: 'Account Executive', country_codes: ['US'], locations: ['Remote, United States'] }),
    jobKey({ title: 'account executive ', country_codes: ['US'], locations: ['United States (Remote)'] }));
  assert.notEqual(jobKey({ title: 'AE', country_codes: ['US'], locations: [] }), jobKey({ title: 'AE', country_codes: ['DE'], locations: [] }));
});

test('boards of the same company merge into one row; openings listed on both boards count once', () => withMergedIndex(async (dir) => {
  const { rows } = await run(dir, { keywords: ['account executive', 'sales'] });
  for (const r of rows) { assertMatchesSchema(r); assert.deepEqual(Object.keys(r), OUTPUT_FIELDS); }
  const names = rows.map((r) => r.company_name.toLowerCase().replace(/[^a-z]/g, ''));
  assert.equal(new Set(rows.map((r) => mergeKey(r.company_name, r.ats, r.company_board))).size, rows.length, `no company repeats: ${names}`);
  const a = rows.find((r) => r.ats_list.length > 1);
  assert.ok(a, 'the merged Acme row');
  assert.equal(a.company_name, 'Acme Inc', 'name of the primary board');
  assert.equal(a.company_board, 'acme', 'primary board = most matching jobs');
  assert.equal(a.ats, 'greenhouse');
  assert.equal(a.careers_url, 'https://job-boards.greenhouse.io/acme');
  assert.equal(a.source_url, 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true');
  assert.deepEqual(a.ats_list, ['greenhouse', 'ashby']);
  assert.deepEqual(a.boards, [
    { ats: 'greenhouse', token: 'acme', careers_url: 'https://job-boards.greenhouse.io/acme', open_jobs: 14 },
    { ats: 'ashby', token: 'acmeltd', careers_url: 'https://jobs.ashbyhq.com/acmeltd', open_jobs: 5 },
  ]);
  assert.equal(a.open_jobs_total, 16, '14 + 5 - 3 openings on both boards');
  assert.equal(a.matching_jobs, 14, '12 + 5 - 3');
  assert.equal(a.jobs_posted_last_30d, 12, '10 recent + 2 new Ashby-only (the 3 copies are already counted)');
  assert.equal(a.hiring_velocity, Math.round((12 / 16) * 100) / 100);
  assert.equal(a.remote_share, 0.5, '7 remote of 14: recomputed on the merged, de-duplicated set');
  assert.equal(a.careers_site_domain, 'acme.com');
  assert.ok(a.matching_job_titles.includes('Sales Engineer 0'), 'Ashby-only titles are included');
}));

test('merged rows are deterministic and honour excludeCompanies and minMatchingJobs', () => withMergedIndex(async (dir) => {
  const r1 = await run(dir, { keywords: ['account executive', 'sales'] });
  const r2 = await run(dir, { keywords: ['account executive', 'sales'] });
  assert.deepEqual(r1.rows, r2.rows);
  const ex = await run(dir, { keywords: ['sales'], excludeCompanies: ['Acme'] });
  assert.ok(!ex.rows.some((r) => /acme/i.test(r.company_name)), 'both boards excluded');
  const min = await run(dir, { minMatchingJobs: 15 });
  assert.deepEqual(min.rows.map((r) => r.company_board), ['acme'], '16 merged open jobs pass, no single board has 15');
}));

test('merge rule: identical normalized tokens, or proven shared openings; a shared name alone never merges', () => {
  assert.equal(normToken('Lago-1'), 'lago');
  assert.equal(normToken('canvas-medical'), 'canvasmedical');
  assert.equal(normToken('2020'), '2020', 'an all-digit token is kept');
  const keys = (...k) => new Set(k);
  const n = (boards) => new Set(clusterBoards(boards)).size;
  // Wayve: same token on Greenhouse and Ashby.
  assert.equal(n([{ token: 'wayve', keys: keys('a|GB'), jobs: 198 }, { token: 'wayve', keys: keys('b|US'), jobs: 185 }]), 1);
  // Lago: "lago-1" vs "lago".
  assert.equal(n([{ token: 'lago-1', keys: keys('x|ES'), jobs: 392 }, { token: 'lago', keys: keys('y|US'), jobs: 1 }]), 1);
  // Zip (procurement) vs Zip Co (payments): same display name, different tokens, no shared openings.
  assert.equal(n([{ token: 'zip', keys: keys('ae|US', 'se|US', 'pm|US'), jobs: 40 }, { token: 'zipcolimited', keys: keys('ae|AU', 'dev|AU'), jobs: 30 }]), 2);
  assert.equal(n([{ token: 'parallellearning', keys: keys('slp|US'), jobs: 19 }, { token: 'beparallel', keys: keys('eng|FR'), jobs: 11 }]), 2);
  assert.equal(n([{ token: 'axon', keys: keys('a|US', 'b|US', 'c|US'), jobs: 509 }, { token: 'axonag', keys: keys('d|CH'), jobs: 8 }]), 2);
  // ...unless they genuinely share openings: 3 shared keys, or 30% of the smaller board.
  assert.equal(n([{ token: 'zip', keys: keys('a|US', 'b|US', 'c|US', 'd|US'), jobs: 400 }, { token: 'zipcolimited', keys: keys('a|US', 'b|US', 'c|US'), jobs: 300 }]), 1);
  assert.equal(n([{ token: 'acme', keys: keys('a|US', 'b|US', 'c|US', 'd|US'), jobs: 40 }, { token: 'acmeltd', keys: keys('a|US', 'b|US', 'z|DE'), jobs: 5 }]), 1, '2 shared of 5 = 40%');
  assert.equal(n([{ token: 'acme', keys: keys('a|US', 'b|US'), jobs: 40 }, { token: 'acmeltd', keys: keys('a|US', 'x|DE', 'y|DE', 'z|DE'), jobs: 10 }]), 2, '1 of 10 = 10%');
  // Three boards: identical tokens chain.
  assert.equal(n([{ token: 'Anagram', keys: keys(), jobs: 5 }, { token: 'anagram', keys: keys(), jobs: 2 }, { token: 'anagramsecurity', keys: keys(), jobs: 1 }]), 2);
});

async function withBoards(boards, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'companies-rule-'));
  try {
    const writer = await new IndexWriter(dir, { builtAt: new Date(NOW - DAY) }).open();
    for (const { board, name, jobs } of boards) await writer.addBoard(board, name, jobs);
    await writer.finish();
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const jobOn = (ats, token, name, i, title, cc, loc) => ({
  ...acme[0], job_id: `${ats}:${token}:${i}`, ats, company_board: token, company_name: name, title, country_codes: [cc],
  locations: [loc], job_url: `https://example.org/${ats}/${token}/${i}`, apply_url: `https://example.org/${ats}/${token}/${i}`,
});

test('index run: Zip and Zip Co stay two rows; Wayve on Greenhouse + Ashby is one row', () => withBoards([
  { board: { ats: 'ashby', token: 'zip' }, name: 'Zip', jobs: [0, 1, 2].map((i) => jobOn('ashby', 'zip', 'Zip', i, `Account Executive ${i}`, 'US', 'San Francisco, CA')) },
  { board: { ats: 'greenhouse', token: 'zipcolimited' }, name: 'Zip', jobs: [0, 1].map((i) => jobOn('greenhouse', 'zipcolimited', 'Zip', i, `Account Executive ${i}`, 'AU', 'Sydney')) },
  { board: { ats: 'greenhouse', token: 'wayve' }, name: 'Wayve', jobs: [0, 1, 2].map((i) => jobOn('greenhouse', 'wayve', 'Wayve', i, `Account Executive ${i}`, 'GB', 'London')) },
  { board: { ats: 'ashby', token: 'wayve' }, name: 'Wayve', jobs: [0, 1, 3].map((i) => jobOn('ashby', 'wayve', 'Wayve', i, `Account Executive ${i}`, 'GB', 'London, United Kingdom')) },
], async (dir) => {
  const { rows, summary } = await run(dir, { keywords: ['account executive'] });
  for (const r of rows) assertMatchesSchema(r);
  const zips = rows.filter((r) => r.company_name === 'Zip');
  assert.equal(zips.length, 2, 'two different companies named Zip');
  assert.deepEqual(zips.map((r) => r.boards.length), [1, 1]);
  assert.deepEqual(zips.map((r) => r.open_jobs_total).sort(), [2, 3]);
  const wayve = rows.filter((r) => r.company_name === 'Wayve');
  assert.equal(wayve.length, 1);
  assert.deepEqual(wayve[0].ats_list.sort(), ['ashby', 'greenhouse']);
  assert.equal(wayve[0].open_jobs_total, 4, '3 + 3 listings, 2 of them on both boards');
  assert.equal(wayve[0].matching_jobs, 4);
  assert.equal(wayve[0].jobs_posted_last_30d, 4);
  assert.equal(summary.multi_board_companies, 1);
}));

test('cross-board counter: copies on another board count once, repeats within one board stay distinct', () => {
  const c = new CrossBoardCounter();
  assert.equal(c.add('ae|US', 'greenhouse:a'), true);
  assert.equal(c.add('ae|US', 'greenhouse:a'), true, 'second AE in the US on the same board (another city) is another job');
  assert.equal(c.add('ae|US', 'ashby:a'), false, 'copy on the other board');
  assert.equal(c.add('ae|US', 'ashby:a'), false);
  assert.equal(c.add('ae|US', 'ashby:a'), true, 'a third copy on the Ashby board exceeds the Greenhouse count');
  assert.equal(c.size, 3);
});

test('EU Lever board + same-name Ashby board: one row, one entry per board, EU careers URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'companies-eu-'));
  try {
    const builtAt = new Date(NOW - DAY);
    const lever = load('lever_postings.json');
    const euUrl = 'https://api.eu.lever.co/v0/postings/shieldai?mode=json';
    const net = fakeNetwork({ [euUrl]: () => lever });
    const writer = await new IndexWriter(dir, { builtAt }).open();
    const eu = { ats: 'lever', token: 'shieldai', region: 'eu' };
    const r = await fetchBoard(eu, { fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => builtAt });
    await writer.addBoard(eu, 'Shield AI', r.jobs);
    const ashbyJobs = r.jobs.map((j, i) => ({ ...j, job_id: `ashby:shield-ai:${i}`, ats: 'ashby', company_board: 'shield-ai', locations: [`Somewhere ${i}`], job_url: `https://jobs.ashbyhq.com/shield-ai/${i}`, apply_url: `https://jobs.ashbyhq.com/shield-ai/${i}/application` }));
    await writer.addBoard({ ats: 'ashby', token: 'shield-ai' }, 'Shield AI, Inc.', ashbyJobs);
    await writer.finish();
    const { rows } = await run(dir, {});
    assert.equal(rows.length, 1);
    const [row] = rows;
    assertMatchesSchema(row);
    assert.deepEqual(row.boards.map((b) => `${b.ats}:${b.token}`).sort(), ['ashby:shield-ai', 'lever:shieldai']);
    assert.ok(row.boards.some((b) => b.careers_url === 'https://jobs.eu.lever.co/shieldai'), JSON.stringify(row.boards));
    assert.equal(row.open_jobs_total, 2, 'the Ashby copies (same title + country) are the same two openings');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('Workday: a Workday site in the live fallback becomes a schema-valid company row with its career-site URL', async () => {
  const net = fakeNetwork();
  const out = sink({ event: 'company-result' });
  const summary = await runCompanies(normalizeCompaniesInput({}), {
    ...out, indexBaseUrl: pathToFileURL(join(tmpdir(), 'no-such-index')).href, fallbackBoards: [WORKDAY_BOARD],
    fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW, hostGaps: {},
  });
  assert.equal(summary.used_fallback, true);
  assert.equal(out.rows.length, 1);
  const row = out.rows[0];
  assertMatchesSchema(row);
  assert.equal(row.ats, 'workday');
  assert.equal(row.company_name, 'Workday');
  assert.equal(row.careers_url, 'https://workday.wd5.myworkdayjobs.com/Workday');
});
