import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectAtsBoards, apiUrlFor, parseJobs } from '../src/transform.js';

const load = (f) => readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8');

test('detects ATS boards in careers page HTML and direct URLs', () => {
  const boards = detectAtsBoards(load('careers_page.html'));
  assert.deepEqual(boards, [{ ats: 'greenhouse', board: 'exampleco' }, { ats: 'lever', board: 'otherco' }]);
  assert.deepEqual(detectAtsBoards('https://jobs.ashbyhq.com/ramp'), [{ ats: 'ashby', board: 'ramp' }]);
  assert.deepEqual(detectAtsBoards('https://example.com/nothing'), []);
});

test('api urls per ats', () => {
  assert.equal(apiUrlFor({ ats: 'greenhouse', board: 'x' }), 'https://boards-api.greenhouse.io/v1/boards/x/jobs');
  assert.equal(apiUrlFor({ ats: 'lever', board: 'x' }), 'https://api.lever.co/v0/postings/x?mode=json');
  assert.equal(apiUrlFor({ ats: 'ashby', board: 'x' }), 'https://api.ashbyhq.com/posting-api/job-board/x');
});

test('normalizes greenhouse jobs from golden fixture', () => {
  const jobs = parseJobs('greenhouse', 'gitlab', JSON.parse(load('greenhouse_jobs.json')));
  assert.equal(jobs.length, 3);
  const j = jobs[0];
  assert.equal(j.ats, 'greenhouse');
  assert.ok(j.title && j.job_url.startsWith('https://'));
  assert.ok(j.job_id.length > 0);
});

test('normalizes lever postings from golden fixture', () => {
  const jobs = parseJobs('lever', 'spotify', JSON.parse(load('lever_postings.json')));
  assert.equal(jobs.length, 2);
  assert.ok(jobs[0].title);
  assert.ok(jobs[0].location !== undefined);
  assert.match(jobs[0].job_url, /^https:\/\//);
});

test('normalizes ashby jobs from golden fixture', () => {
  const jobs = parseJobs('ashby', 'ramp', JSON.parse(load('ashby_jobs.json')));
  assert.equal(jobs.length, 2);
  assert.ok(jobs[0].title);
  assert.equal(typeof jobs[0].remote, 'boolean');
});

test('schema changes raise typed errors; malformed jobs dropped', () => {
  assert.throws(() => parseJobs('greenhouse', 'x', { nope: 1 }), (e) => e.failureClass === 'schema_change');
  assert.throws(() => parseJobs('lever', 'x', { ok: false }), (e) => e.failureClass === 'schema_change');
  const jobs = parseJobs('greenhouse', 'x', { jobs: [{}, JSON.parse(load('greenhouse_jobs.json')).jobs[0]] });
  assert.equal(jobs.length, 1);
});
