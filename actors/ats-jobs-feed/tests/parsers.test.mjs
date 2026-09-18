import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBoard, parseBoardRef, apiUrlFor, boardKey, employmentType, salaryPeriod, isoDateTime, dedupeJobs } from '../src/transform.js';
import { toOutput } from '../src/feed.js';
import { load, FIXTURES, assertMatchesSchema } from './helpers.mjs';

const parse = (ats) => parseBoard({ ats, token: FIXTURES[ats].token }, load(FIXTURES[ats].file));
const stamp = (j) => ({ ...j, source_url: 'https://example.com/api', fetched_at: '2026-09-19T00:00:00.000Z' });

test('greenhouse: escaped HTML content, departments, remote inferred from location text', () => {
  const { company_name, jobs } = parse('greenhouse');
  assert.equal(company_name, 'GitLab');
  assert.equal(jobs.length, 3);
  const j = jobs[0];
  assert.equal(j.job_id, 'greenhouse:gitlab:8556658002');
  assert.equal(j.title, 'AI Engineer');
  assert.equal(j.department, 'Enterprise Applications');
  assert.deepEqual(j.locations, ['Remote, Bangalore']);
  assert.deepEqual(j.country_codes, ['IN']);
  assert.equal(j.workplace_type, 'remote');
  assert.equal(j.remote, true);
  assert.equal(j.posted_at, '2026-05-22T13:16:29.000Z');
  assert.equal(j.salary_min, null, 'greenhouse list API exposes no pay: never guessed');
  assert.ok(!/[<>]|&lt;/.test(j.description_text), 'HTML fully stripped');
  const onsite = jobs[2];
  assert.equal(onsite.workplace_type, 'unknown', 'no remote wording -> unknown, not a guessed on-site');
  assert.equal(onsite.remote, null);
});

test('lever: categories, workplaceType, salaryRange, country, lists folded into description', () => {
  const { jobs } = parse('lever');
  assert.equal(jobs.length, 2);
  const [paid, unpaid] = jobs;
  assert.equal(paid.company_board, 'shieldai');
  assert.equal(paid.workplace_type, 'onsite');
  assert.equal(paid.remote, false);
  assert.deepEqual([paid.salary_min, paid.salary_max, paid.salary_currency, paid.salary_period], [100000, 160000, 'USD', 'year']);
  assert.equal(paid.employment_type, 'full_time');
  assert.deepEqual(paid.country_codes, ['US']);
  assert.match(paid.apply_url, /\/apply$/);
  assert.equal(unpaid.salary_min, null);
  assert.equal(unpaid.salary_period, null);
});

test('ashby: compensation summary, secondary locations, isRemote, unlisted jobs dropped', () => {
  const { jobs } = parse('ashby');
  assert.equal(jobs.length, 2);
  const j = jobs[0];
  assert.equal(j.title, 'Security Engineer, Cloud', 'title trimmed');
  assert.deepEqual([j.salary_min, j.salary_max, j.salary_currency, j.salary_period], [211400, 290600, 'USD', 'year']);
  assert.ok(j.locations.length >= 3);
  assert.ok(j.country_codes.includes('US') && j.country_codes.includes('CA'));
  assert.equal(j.workplace_type, 'hybrid');
  assert.equal(j.employment_type, 'full_time');
  const raw = load(FIXTURES.ashby.file);
  raw.jobs[0].isListed = false;
  assert.equal(parseBoard({ ats: 'ashby', token: 'ramp' }, raw).jobs.length, 1);
});

test('workable: account name, shortcode ids, countryCode hints, telecommuting', () => {
  const { company_name, jobs } = parse('workable');
  assert.equal(company_name, 'Blueground');
  assert.equal(jobs.length, 2);
  assert.equal(jobs[0].job_id, 'workable:blueground:186545F8C1');
  assert.deepEqual(jobs[0].country_codes, ['GR']);
  assert.equal(jobs[0].remote, false);
  assert.equal(jobs[0].posted_at, '2026-02-12T00:00:00.000Z');
  const raw = load(FIXTURES.workable.file);
  raw.jobs[0].telecommuting = true;
  const r = parseBoard({ ats: 'workable', token: 'blueground' }, raw).jobs[0];
  assert.equal(r.workplace_type, 'remote');
  assert.equal(r.remote, true);
});

test('recruitee: salary strings, hybrid flag, UTC timestamps, mailbox never output', () => {
  const { company_name, jobs } = parse('recruitee');
  assert.equal(company_name, 'Channable');
  const j = jobs[0];
  assert.deepEqual([j.salary_min, j.salary_max, j.salary_currency, j.salary_period], [4012.5, 5250, 'EUR', 'month']);
  assert.equal(j.workplace_type, 'hybrid');
  assert.equal(j.posted_at, '2026-09-18T13:27:28.000Z');
  assert.deepEqual(j.country_codes, ['NL']);
  assert.ok(!JSON.stringify(jobs).includes('recruitee.com'), 'job mailbox address is not part of any record');
});

test('every parsed fixture row matches the declared dataset schema', () => {
  for (const ats of Object.keys(FIXTURES)) {
    for (const j of parse(ats).jobs) {
      assertMatchesSchema(toOutput(stamp(j), true));
      assertMatchesSchema(toOutput(stamp(j), false));
      assert.ok(j.description_snippet.length <= 300);
    }
  }
});

test('schema changes raise typed errors; a malformed job is dropped, not fatal', () => {
  for (const ats of Object.keys(FIXTURES)) {
    assert.throws(() => parseBoard({ ats, token: 'x' }, { unexpected: true, jobs: 'nope', offers: 3 }), (e) => e.failureClass === 'schema_change');
  }
  const raw = load(FIXTURES.greenhouse.file);
  raw.jobs.push({}, { id: 1, title: 'No URL' }, null);
  assert.equal(parseBoard({ ats: 'greenhouse', token: 'gitlab' }, raw).jobs.length, 3);
});

test('board references: URLs of every ATS and explicit ats:token strings', () => {
  const cases = {
    'https://boards.greenhouse.io/GitLab': { ats: 'greenhouse', token: 'gitlab' },
    'https://job-boards.greenhouse.io/gitlab/jobs/8556658002': { ats: 'greenhouse', token: 'gitlab' },
    'https://boards.greenhouse.io/embed/job_board?for=acme&b=x': { ats: 'greenhouse', token: 'acme' },
    'https://jobs.lever.co/shieldai/41468aca': { ats: 'lever', token: 'shieldai' },
    'jobs.eu.lever.co/acme': { ats: 'lever', token: 'acme', region: 'eu' },
    'https://jobs.ashbyhq.com/Ramp/34413f8d': { ats: 'ashby', token: 'Ramp' },
    'https://apply.workable.com/blueground/j/186545F8C1/': { ats: 'workable', token: 'blueground' },
    'https://channable.recruitee.com/o/some-job': { ats: 'recruitee', token: 'channable' },
    'greenhouse:gitlab': { ats: 'greenhouse', token: 'gitlab' },
    'lever:eu:acme': { ats: 'lever', token: 'acme', region: 'eu' },
  };
  for (const [ref, want] of Object.entries(cases)) assert.deepEqual(parseBoardRef(ref), want, ref);
  for (const bad of ['https://example.com/careers', 'https://www.recruitee.com/', 'https://apply.workable.com/j/ABC', '', 'smartrecruiters:visa']) {
    assert.equal(parseBoardRef(bad), null, bad);
  }
  assert.equal(boardKey({ ats: 'lever', token: 'Acme', region: 'eu' }), 'lever:eu:acme');
});

test('official API endpoints per ATS', () => {
  assert.equal(apiUrlFor({ ats: 'greenhouse', token: 'x' }), 'https://boards-api.greenhouse.io/v1/boards/x/jobs?content=true');
  assert.equal(apiUrlFor({ ats: 'lever', token: 'x' }), 'https://api.lever.co/v0/postings/x?mode=json');
  assert.equal(apiUrlFor({ ats: 'lever', token: 'x', region: 'eu' }), 'https://api.eu.lever.co/v0/postings/x?mode=json');
  assert.equal(apiUrlFor({ ats: 'ashby', token: 'x' }), 'https://api.ashbyhq.com/posting-api/job-board/x?includeCompensation=true');
  assert.equal(apiUrlFor({ ats: 'workable', token: 'x' }), 'https://apply.workable.com/api/v1/widget/accounts/x?details=true');
  assert.equal(apiUrlFor({ ats: 'recruitee', token: 'x' }), 'https://x.recruitee.com/api/offers/');
});

test('field normalizers', () => {
  assert.equal(employmentType('Full-time'), 'full_time');
  assert.equal(employmentType('fulltime_fixed_term'), 'full_time');
  assert.equal(employmentType('parttime_permanent'), 'part_time');
  assert.equal(employmentType('Intern'), 'internship');
  assert.equal(employmentType('Freelance'), 'contract');
  assert.equal(employmentType('Temporary'), 'temporary');
  assert.equal(employmentType('International EOR'), 'other');
  assert.equal(employmentType(null), null);
  assert.equal(salaryPeriod('per-year-salary'), 'year');
  assert.equal(salaryPeriod('1 HOUR'), 'hour');
  assert.equal(salaryPeriod('NONE'), null);
  assert.equal(isoDateTime('2026-09-15 08:11:57 UTC'), '2026-09-15T08:11:57.000Z');
  assert.equal(isoDateTime(1782214185805), '2026-06-23T11:29:45.805Z');
  assert.equal(isoDateTime('garbage'), null);
});

test('dedupe: same company + title + location across ATS keeps the richer copy and lists the others', () => {
  const gh = parse('greenhouse').jobs[0];
  const twin = { ...gh, job_id: 'lever:gitlab:abc', ats: 'lever', company_name: 'GitLab Inc.', salary_min: 1, salary_max: 2, salary_currency: 'USD', salary_period: 'year' };
  const other = parse('greenhouse').jobs[1];
  const out = dedupeJobs([gh, twin, other]);
  assert.equal(out.length, 2);
  const kept = out.find((j) => j.title === gh.title);
  assert.equal(kept.job_id, 'lever:gitlab:abc', 'record with salary wins');
  assert.deepEqual(kept.duplicate_sources, ['greenhouse:gitlab:8556658002']);
  assert.deepEqual(out.find((j) => j.title === other.title).duplicate_sources, []);
  const moved = { ...gh, job_id: 'ashby:gitlab:1', locations: ['Remote, Berlin'] };
  assert.equal(dedupeJobs([gh, moved]).length, 2, 'different location is a different opening');
});
