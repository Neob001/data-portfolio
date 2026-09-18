import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeInput, compileFilter, filterIdentity, companyMatches } from '../src/filters.js';
import { parseBoard } from '../src/transform.js';
import { load, FIXTURES, NOW } from './helpers.mjs';

const ALL = Object.entries(FIXTURES).flatMap(([ats, { token, file }]) => parseBoard({ ats, token }, load(file)).jobs
  .map((j) => (ats === 'lever' ? { ...j, company_name: 'Shield AI' } : j)));
const run = (input) => ALL.filter((j) => compileFilter(normalizeInput(input))(j, NOW)).map((j) => j.job_id);

test('input defaults, mode selection and validation', () => {
  const o = normalizeInput({});
  assert.equal(o.mode, 'search');
  assert.equal(o.maxResults, 100);
  assert.equal(o.includeDescription, true);
  assert.equal(o.remote, 'any');
  assert.equal(o.sinceLastRun, false);
  const live = normalizeInput({ companyUrls: ['https://boards.greenhouse.io/gitlab', 'greenhouse:GitLab', 'https://example.com'] });
  assert.equal(live.mode, 'live');
  assert.deepEqual(live.boards, [{ ats: 'greenhouse', token: 'gitlab' }], 'deduped board refs');
  assert.deepEqual(live.badRefs, ['https://example.com']);
  assert.throws(() => normalizeInput({ remote: 'sometimes' }), /remote/);
  assert.throws(() => normalizeInput({ ats: ['smartrecruiters'] }), /Unknown ATS/);
  assert.throws(() => normalizeInput({ employmentTypes: ['gig'] }), /employment type/);
  assert.throws(() => normalizeInput({ maxResults: 0 }), /maxResults/);
  assert.throws(() => normalizeInput({ postedWithinDays: -1 }), /postedWithinDays/);
  assert.deepEqual(normalizeInput({ employmentTypes: ['Full-time'] }).employmentTypes, ['full_time']);
});

test('no filters -> everything', () => {
  assert.equal(run({}).length, ALL.length);
});

test('keywords any/all over title + description; excludeKeywords on title', () => {
  assert.ok(run({ keywords: ['security engineer'] }).includes('greenhouse:gitlab:8556658002'), 'description scope: every word present (AI Engineer mentions security)');
  const anyHits = run({ keywords: ['engineer', 'maintenance'] });
  assert.ok(anyHits.includes('workable:blueground:6C6B4B42F5'));
  assert.ok(anyHits.includes('greenhouse:gitlab:8556658002'));
  const both = run({ keywords: ['engineer', 'cloud'], keywordMatch: 'all' });
  assert.ok(both.includes('ashby:ramp:34413f8d-26bf-4bbc-8ade-eb309a0e2245'));
  assert.ok(both.length < run({ keywords: ['engineer'] }).length, 'all is stricter than any');
  assert.deepEqual(run({ keywords: ['security engineer'], keywordScope: 'title' }), ['ashby:ramp:34413f8d-26bf-4bbc-8ade-eb309a0e2245']);
  assert.ok(run({ keywords: ['engineer'], keywordScope: 'title' }).every((id) => !id.startsWith('recruitee:')), 'title scope ignores descriptions');
  assert.throws(() => normalizeInput({ keywordScope: 'body' }), /keywordScope/);
  const excl = run({ keywords: ['engineer'], excludeKeywords: ['AI'] });
  assert.ok(!excl.includes('greenhouse:gitlab:8556658002'));
});

test('locations: substring on location text or ISO country code', () => {
  assert.deepEqual(run({ locations: ['Utrecht'] }).sort(), ['recruitee:channable:2751915', 'recruitee:channable:396939']);
  assert.deepEqual(run({ locations: ['GR'] }), ['workable:blueground:186545F8C1']);
  assert.ok(run({ locations: ['IN'] }).includes('lever:shieldai:1d881215-38a7-4fdd-ab54-9e392c53dc0b'));
  assert.deepEqual(run({ locations: ['Atlantis'] }), []);
  assert.ok(run({ locations: ['uk'] }).every((id) => id), 'UK alias accepted');
});

test('remote any / remote_only / onsite_only', () => {
  const remote = run({ remote: 'remote_only' });
  assert.ok(remote.includes('greenhouse:gitlab:8556658002'));
  assert.ok(remote.includes('ashby:ramp:d84bbf19-572a-499c-9c87-0c154ce85caf'));
  assert.ok(!remote.includes('lever:shieldai:41468aca-c1c2-4a7b-aec8-f499e64b6d1e'));
  const onsite = run({ remote: 'onsite_only' });
  assert.ok(onsite.includes('lever:shieldai:41468aca-c1c2-4a7b-aec8-f499e64b6d1e'));
  assert.ok(!onsite.includes('greenhouse:gitlab:8556658002'));
  assert.equal(remote.length + onsite.length, ALL.length);
});

test('companies by name, token or ats:token; ats; departments; employment types', () => {
  assert.equal(run({ companies: ['Shield AI'] }).length, 2);
  assert.equal(run({ companies: ['shieldai'] }).length, 2);
  assert.equal(run({ companies: ['GitLab Inc.'] }).length, 3);
  assert.equal(run({ companies: ['lever:shieldai'] }).length, 2);
  assert.equal(run({ companies: ['greenhouse:shieldai'] }).length, 0);
  assert.ok(companyMatches('Blueground', { ats: 'workable', company_board: 'blueground', company_name: 'Blueground' }));
  assert.ok(!companyMatches('Blue', { ats: 'workable', company_board: 'blueground', company_name: 'Blueground' }), 'no partial-word matches');
  assert.deepEqual(new Set(run({ ats: ['workable', 'recruitee'] }).map((id) => id.split(':')[0])), new Set(['workable', 'recruitee']));
  assert.deepEqual(run({ departments: ['security'] }), []);
  assert.equal(run({ departments: ['engineering'] }).length >= 2, true);
  assert.deepEqual(run({ employmentTypes: ['other'] }), ['lever:shieldai:1d881215-38a7-4fdd-ab54-9e392c53dc0b'], '"International Office Entity" is not an internship');
  assert.deepEqual(run({ employmentTypes: ['internship'] }), []);
  assert.ok(run({ employmentTypes: ['full_time'] }).every((id) => !id.startsWith('greenhouse:')), 'greenhouse has no employment type');
});

test('postedWithinDays uses posted_at against the run clock', () => {
  assert.deepEqual(run({ postedWithinDays: 3 }), ['recruitee:channable:2751915']);
  assert.ok(run({ postedWithinDays: 60 }).length > 1);
});

test('filter identity (incremental cursor key) is order/case insensitive and excludes output-only options', () => {
  const a = filterIdentity(normalizeInput({ keywords: ['B', 'a'], maxResults: 5, includeDescription: false }));
  const b = filterIdentity(normalizeInput({ keywords: ['a', 'b'], maxResults: 500 }));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, filterIdentity(normalizeInput({ keywords: ['a'] })));
});

test('prefilled input schema values are accepted by normalizeInput', () => {
  const schema = JSON.parse(readFileSync(new URL('../INPUT_SCHEMA.json', import.meta.url), 'utf8'));
  const prefill = Object.fromEntries(Object.entries(schema.properties).filter(([, p]) => 'prefill' in p).map(([k, p]) => [k, p.prefill]));
  const o = normalizeInput(prefill);
  assert.equal(o.mode, 'search');
  assert.deepEqual([o.keywords, o.remote, o.postedWithinDays, o.maxResults], [['engineer'], 'remote_only', 7, 20]);
});
