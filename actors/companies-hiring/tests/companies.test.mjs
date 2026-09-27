import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeCompaniesInput, runCompanies, employerDomain, OUTPUT_FIELDS, MAX_TITLES } from '../src/companies.js';
import { fakeNetwork, sink, NOW, buildIndex, assertMatchesSchema, FIXTURE_BOARDS } from './helpers.mjs';

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

test('website domain: only the employer\'s own host, never an ATS or third-party host', () => {
  assert.equal(employerDomain('https://careers.datadoghq.com/detail/1/?gh_jid=1'), 'datadoghq.com');
  assert.equal(employerDomain('https://www.samsara.com/company/careers/roles/8?gh_jid=8'), 'samsara.com');
  assert.equal(employerDomain('https://jobs.cm.com/o/x'), 'cm.com');
  assert.equal(employerDomain('https://job-boards.greenhouse.io/gitlab/jobs/1'), null);
  assert.equal(employerDomain('https://jobs.ashbyhq.com/ramp/1'), null);
  assert.equal(employerDomain('https://apply.workable.com/j/ABC'), null);
  assert.equal(employerDomain('https://channable.recruitee.com/o/x'), null);
  assert.equal(employerDomain('https://acme.wd1.myworkdayjobs.com/x'), null);
  assert.equal(employerDomain('https://app.careerpuck.com/job-board/lyft/job/1'), null);
  assert.equal(employerDomain('not a url'), null);
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
  assert.equal(a.website_domain, 'acme.com');
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
