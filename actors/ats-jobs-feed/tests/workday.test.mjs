// Workday career sites: board refs, list parsing, pagination/caps/deadline, robots.txt, live details,
// index round trip and the "platform not in the index yet" fallback. Fixture: golden/workday_site.json
// (real responses of workday.wd5.myworkdayjobs.com/Workday, trimmed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseBoardRef, parseWorkdayRef, apiUrlFor, boardUrlFor, boardKey, workdayDetailUrl, workdayPostedAt, workdayJobId,
  workdayWorkplace, parseBoard, parseWorkdayDetail, workdayTenantName, atsOfUrl, ATS_LIST,
} from '../src/core/transform.js';
import { fetchBoard, runFeed, toOutput, workdayNameFromPage, workdayRobots, EXTRA_FALLBACK_BOARDS, WORKDAY } from '../src/core/feed.js';
import { normalizeInput, companyMatches } from '../src/core/filters.js';
import { defaultApplyUrl } from '../src/core/index_format.js';
import { IndexWriter } from '../src/core/index_writer.js';
import { robotsVerdict, parseRobots, rulesFor, isAllowed } from '../src/core/robots.js';
import { fetchJson as libFetchJson, retryAfterMs } from '../src/lib/http.js';
import { load, fakeNetwork, sink, NOW, assertMatchesSchema, WORKDAY_FIXTURE, WORKDAY_BOARD, FIXTURE_BOARDS } from './helpers.mjs';

const FX = load(WORKDAY_FIXTURE.file);
const N = FX.jobs.jobPostings.length;
const fresh = () => new Map(); // robots cache per test

test('board refs: career-site, locale, job, API and myworkdaysite URLs -> one site token', () => {
  const nv = { ats: 'workday', token: 'nvidia.wd5/NVIDIAExternalCareerSite' };
  for (const ref of [
    'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite',
    'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite',
    'https://nvidia.wd5.myworkdayjobs.com/en-US/NVIDIAExternalCareerSite/job/US-CA-Santa-Clara/Senior-Engineer_JR2001234?q=1',
    'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/details/Senior-Engineer_JR2001234',
    'nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/',
    'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs',
    'https://NVIDIA.WD5.myworkdayjobs.com/fr-FR/NVIDIAExternalCareerSite',
    'workday:nvidia.wd5/NVIDIAExternalCareerSite',
    'nvidia.wd5/NVIDIAExternalCareerSite',
  ]) assert.deepEqual(parseBoardRef(ref), nv, ref);
  assert.deepEqual(parseBoardRef('https://wd1.myworkdaysite.com/en-US/recruiting/paypal/jobs/job/X_R1'), { ats: 'workday', token: 'paypal.wd1/jobs' });
  assert.deepEqual(parseBoardRef('https://wd1.myworkdaysite.com/recruiting/paypal/jobs'), { ats: 'workday', token: 'paypal.wd1/jobs' });
  for (const bad of ['https://nvidia.wd5.myworkdayjobs.com/', 'https://nvidia.wd5.myworkdayjobs.com/en-US', 'https://acme.wd1.myworkdayjobs.com/robots.txt',
    'https://acme.wd1.myworkdayjobs.com/llms.txt', 'https://www.myworkday.com/acme/d/home.htmld', 'https://wd1.myworkdaysite.com/recruiting/paypal', 'workday:nvidia']) {
    assert.equal(parseBoardRef(bad), null, bad);
  }
  assert.equal(parseWorkdayRef('https://jobs.lever.co/acme'), null);
  // Existing platforms are untouched; a Workday tenant named like another ATS is still Workday.
  assert.deepEqual(parseBoardRef('https://job-boards.greenhouse.io/gitlab'), { ats: 'greenhouse', token: 'gitlab' });
  assert.equal(atsOfUrl('https://greenhousegroup.wd3.myworkdayjobs.com/wday/cxs/greenhousegroup/x/jobs'), 'workday');
  assert.equal(atsOfUrl('https://api.lever.co/v0/postings/x'), 'lever');
  assert.ok(ATS_LIST.includes('workday'));
});

test('URLs: CXS list/detail endpoints, public site, apply link default', () => {
  const b = { ats: 'workday', token: 'nvidia.wd5/NVIDIAExternalCareerSite' };
  assert.equal(apiUrlFor(b), 'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/jobs');
  assert.equal(boardUrlFor(b), 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite');
  assert.equal(boardKey(b), 'workday:nvidia.wd5/nvidiaexternalcareersite');
  assert.equal(workdayDetailUrl(b, 'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/job/UK-Bristol/Engineer_JR1'),
    'https://nvidia.wd5.myworkdayjobs.com/wday/cxs/nvidia/NVIDIAExternalCareerSite/job/UK-Bristol/Engineer_JR1');
  assert.equal(defaultApplyUrl('workday', 'https://x.wd1.myworkdayjobs.com/S/job/A/B_1'), 'https://x.wd1.myworkdayjobs.com/S/job/A/B_1/apply');
  assert.equal(workdayTenantName('capitalone.wd12/Capital_One'), 'Capitalone');
  assert.equal(workdayTenantName('ibm.wd1/External'), 'IBM');
});

test('posted_at: relative "Posted N Days Ago" labels -> UTC dates relative to the fetch time', () => {
  const at = new Date('2026-10-09T03:15:00Z');
  assert.equal(workdayPostedAt('Posted Today', at), '2026-10-09T00:00:00.000Z');
  assert.equal(workdayPostedAt('Posted Yesterday', at), '2026-10-08T00:00:00.000Z');
  assert.equal(workdayPostedAt('Posted 2 Days Ago', at), '2026-10-07T00:00:00.000Z');
  assert.equal(workdayPostedAt('Posted 30+ Days Ago', at), '2026-09-09T00:00:00.000Z', '30+ = at least 30 days ago');
  for (const v of [null, '', 'Posted recently', 'Vor 3 Tagen ausgeschrieben']) assert.equal(workdayPostedAt(v, at), null, v);
});

test('ids and workplace: requisition id from the posting path, remoteType mapping', () => {
  assert.equal(workdayJobId('/job/FRA-Remote/Account-Executive---Lyon_JR-0110680-1'), 'JR-0110680-1');
  assert.equal(workdayJobId('/job/US-CA-Santa-Clara/Senior-Engineer_JR2001234'), 'JR2001234');
  assert.equal(workdayJobId('/job/Orlando/Cast-Member_10157873'), '10157873');
  assert.equal(workdayJobId('/job/Somewhere/No-Requisition-Here'), 'No-Requisition-Here');
  assert.deepEqual(['Remote', 'Fully Remote', 'Remote Home-Based', 'Flex', 'Hybrid', 'Primarily On-Site / Occasionally from Home', 'On-site', 'Onsite Job', 'x', null].map(workdayWorkplace),
    ['remote', 'remote', 'remote', 'hybrid', 'hybrid', 'hybrid', 'onsite', 'onsite', null, null]);
});

test('golden list page -> flat jobs in the shared schema', () => {
  const fetchedAt = new Date('2026-10-09T03:00:00Z');
  const { company_name, jobs } = parseBoard(WORKDAY_BOARD, FX.jobs, { fetchedAt });
  assert.equal(company_name, null, 'the list API has no company name (board name / site page supply it)');
  assert.equal(jobs.length, N);
  const byId = new Map(jobs.map((j) => [j.job_id, j]));
  assert.equal(byId.size, N, 'job ids are unique');
  const lyon = byId.get('workday:workday.wd5/workday:JR-0110680-1');
  assert.ok(lyon, [...byId.keys()].join(' '));
  assert.equal(lyon.title, 'Account Executive Medium Enterprise - Lyon');
  assert.deepEqual(lyon.locations, ['FRA, Remote']);
  assert.equal(lyon.workplace_type, 'remote');
  assert.equal(lyon.remote, true);
  assert.equal(lyon.posted_at, '2026-10-09T00:00:00.000Z');
  assert.equal(lyon.job_url, 'https://workday.wd5.myworkdayjobs.com/Workday/job/FRA-Remote/Account-Executive-Medium-Enterprise---Lyon_JR-0110680-1');
  assert.equal(lyon.apply_url, `${lyon.job_url}/apply`);
  assert.equal(lyon.company_board, 'workday.wd5/Workday');
  assert.equal(lyon.ats, 'workday');
  assert.equal(lyon.description_text, null, 'no description in lists');
  // "N Locations" -> the primary location from the posting path.
  const multi = jobs.find((j) => j.title === 'Senior Revenue Accountant');
  assert.deepEqual(multi.locations, ['USA CA Pleasanton']);
  assert.deepEqual(multi.country_codes, ['US']);
  assert.equal(multi.workplace_type, 'hybrid', 'remoteType Flex');
  const old = jobs.filter((j) => j.posted_at === '2026-09-09T00:00:00.000Z');
  assert.equal(old.length, 2, 'two "Posted 30+ Days Ago" postings');
  for (const j of jobs) {
    for (const k of ['salary_min', 'salary_max', 'salary_currency', 'salary_period', 'department', 'team', 'updated_at']) assert.equal(j[k], null, k);
    assertMatchesSchema(toOutput({ ...j, source_url: apiUrlFor(WORKDAY_BOARD), fetched_at: fetchedAt.toISOString(), match_score: null, matched_in: null }, false));
  }
  // Stable across fetches: same ids from a later fetch.
  const later = parseBoard(WORKDAY_BOARD, FX.jobs, { fetchedAt: new Date('2026-10-12T00:00:00Z') }).jobs.map((j) => j.job_id);
  assert.deepEqual(later, jobs.map((j) => j.job_id));
  assert.throws(() => parseBoard(WORKDAY_BOARD, { errorCode: 'HTTP_400' }), /Unexpected workday response/);
});

test('golden detail -> description (contacts redacted), every location, country codes', () => {
  const [path, detail] = Object.entries(FX.details).find(([, d]) => (d.jobPostingInfo.additionalLocations || []).length > 3);
  const d = parseWorkdayDetail(WORKDAY_BOARD, detail);
  assert.ok(d.description_text.length > 200 && !/<[a-z]/i.test(d.description_text), path);
  assert.ok(d.locations.length >= 5 && d.locations.includes('Ireland, Dublin'));
  assert.ok(['CZ', 'DE', 'IE', 'PL'].every((c) => d.country_codes.includes(c)), d.country_codes.join());
  const withContact = structuredClone(detail);
  withContact.jobPostingInfo.jobDescription += '<p>Questions? Contact our recruiter Jane Doe at jane.doe@workday.com or +1 415 555 0100.</p>';
  const r = parseWorkdayDetail(WORKDAY_BOARD, withContact).description_text;
  assert.ok(!r.includes('jane.doe@') && !r.includes('555 0100') && !r.includes('Jane Doe'), r.slice(-200));
  assert.throws(() => parseWorkdayDetail(WORKDAY_BOARD, { nope: 1 }), /Unexpected workday response/);
});

// Fake CXS site with `total` postings, served 20 per page as Workday does (total only on page 0).
function fakeSite(total, { robots = 'User-agent: *\nAllow: /Big/\nDisallow: /refreshFacet/' } = {}) {
  const board = { ats: 'workday', token: 'big.wd1/Big' };
  const bodies = [];
  const fetchJson = async (url, opts) => {
    assert.equal(url, apiUrlFor(board));
    assert.equal(opts.method, 'POST');
    bodies.push(opts.body);
    const { offset, limit } = opts.body;
    assert.equal(limit, 20, 'Workday rejects limit > 20');
    const n = Math.max(0, Math.min(limit, total - offset));
    return {
      total: offset === 0 ? total : 0,
      jobPostings: Array.from({ length: n }, (_, i) => ({
        title: `Engineer ${offset + i}`, externalPath: `/job/Berlin/Engineer-${offset + i}_R${100000 + offset + i}`, locationsText: 'Berlin, Germany', postedOn: 'Posted 3 Days Ago', bulletFields: [`R${100000 + offset + i}`],
      })),
    };
  };
  const fetchText = async (url) => {
    if (url.endsWith('/robots.txt')) {
      if (robots === null) throw new Error('ECONNRESET');
      if (typeof robots === 'number') throw Object.assign(new Error(`HTTP ${robots}`), { status: robots });
      return robots;
    }
    return '<meta property="og:title" content="Big Co Careers">';
  };
  return { board, fetchJson, fetchText, bodies };
}

test('pagination: pages of 20 until total; per-site cap; budget and run deadline stop paging early', async () => {
  const s = fakeSite(45);
  const r = await fetchBoard(s.board, { fetchJson: s.fetchJson, fetchText: s.fetchText, robotsCache: fresh(), now: () => new Date(NOW) });
  assert.deepEqual(s.bodies.map((b) => b.offset), [0, 20, 40]);
  assert.equal(r.jobs.length, 45);
  assert.equal(r.truncated, false);
  assert.equal(r.company_name, 'Big Co');
  assert.equal(new Set(r.jobs.map((j) => j.job_id)).size, 45);
  assert.equal(r.jobs[0].source_url, 'https://big.wd1.myworkdayjobs.com/wday/cxs/big/Big/jobs');

  const capped = fakeSite(1000);
  const c = await fetchBoard(capped.board, { fetchJson: capped.fetchJson, fetchText: capped.fetchText, robotsCache: fresh(), maxJobs: 50, skipName: true });
  assert.equal(c.jobs.length, 50);
  assert.equal(c.truncated, true);
  assert.equal(capped.bodies.length, 3, 'stops once the cap is reached');

  const slow = fakeSite(1000);
  const b = await fetchBoard(slow.board, { fetchJson: slow.fetchJson, fetchText: slow.fetchText, robotsCache: fresh(), budgetMs: 0, skipName: true });
  assert.deepEqual([b.jobs.length, b.truncated, slow.bodies.length], [20, true, 1], 'budget spent: keeps the first (newest) page');

  const late = fakeSite(1000);
  const deadline = { hasTimeFor: () => false };
  const d = await fetchBoard(late.board, { fetchJson: late.fetchJson, fetchText: late.fetchText, robotsCache: fresh(), deadline, skipName: true });
  assert.deepEqual([d.jobs.length, d.truncated], [20, true]);
  assert.ok(WORKDAY.maxJobsPerBoard >= 1000 && WORKDAY.pageSize === 20);
});

test('robots.txt: a disallowed or unreachable robots.txt means the site is never called', async () => {
  for (const robots of ['User-agent: *\nDisallow: /wday/', 'User-agent: *\nDisallow: /', 'User-agent: factpipe\nDisallow: /Big/', null, 503]) {
    const s = fakeSite(10, { robots });
    await assert.rejects(fetchBoard(s.board, { fetchJson: s.fetchJson, fetchText: s.fetchText, robotsCache: fresh() }),
      (e) => e.failureClass === 'blocked' && e.robots === true, String(robots));
    assert.equal(s.bodies.length, 0, `no jobs call (${robots})`);
  }
  // No robots.txt (4xx) = allowed (RFC 9309); "Allow: /<site>/" + other sites disallowed = allowed.
  for (const robots of [404, FX.robots_txt.replace(/Workday/g, 'Big')]) {
    const s = fakeSite(10, { robots });
    const r = await fetchBoard(s.board, { fetchJson: s.fetchJson, fetchText: s.fetchText, robotsCache: fresh() });
    assert.equal(r.jobs.length, 10, String(robots));
  }
  // The site itself disallowed (as NVIDIA does for its research site), case-insensitively.
  const nv = 'User-agent: *\nAllow: /NVIDIAExternalCareerSite/\nDisallow: /NVIDIAExternalCareerSiteResearch/\nDisallow: /refreshFacet/';
  const paths = (site) => [`/wday/cxs/nvidia/${site}/jobs`, `/wday/cxs/nvidia/${site}/job/`, `/${site}/`];
  assert.equal(robotsVerdict({ status: 200, text: nv }, 'factpipe-jobs-feed', paths('NVIDIAExternalCareerSite')).allowed, true);
  assert.equal(robotsVerdict({ status: 200, text: nv }, 'factpipe-jobs-feed', paths('nvidiaexternalcareersiteresearch')).allowed, false);
  // Longest match wins; ties go to Allow; wildcards and $.
  const rules = rulesFor(parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /*.pdf$\nUser-agent: other\nDisallow: /'), 'factpipe-jobs-feed');
  assert.deepEqual(['/a/x', '/a/b/c', '/x.pdf', '/x.pdf?y', '/z'].map((p) => isAllowed(rules, p)), [false, true, false, true, true]);
  // One robots.txt request per host, cached.
  const cache = fresh();
  let n = 0;
  const ft = async () => { n += 1; return FX.robots_txt; };
  await workdayRobots(WORKDAY_BOARD, { fetchText: ft, cache });
  await workdayRobots({ ats: 'workday', token: 'workday.wd5/Workday_Jobs' }, { fetchText: ft, cache });
  assert.equal(n, 1);
});

test('site page name: og:title "Careers at X" / "X Careers", nothing else', () => {
  assert.equal(workdayNameFromPage(FX.site_page_head), 'Workday');
  assert.equal(workdayNameFromPage('<meta name="title" property="og:title" content="CAREERS AT NVIDIA">'), 'NVIDIA');
  assert.equal(workdayNameFromPage('<meta property="og:title" content="Disney Careers">'), 'Disney');
  for (const html of ['<meta name="title" property="og:title">', '<meta property="og:title" content="Join us">', '<meta property="og:title" content="External Careers">', '']) {
    assert.equal(workdayNameFromPage(html), null, html);
  }
});

async function live(input, { extra, deps = {} } = {}) {
  const net = fakeNetwork(extra);
  const out = sink();
  const summary = await runFeed(normalizeInput(input), {
    ...out, fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW, hostGaps: {}, robotsCache: fresh(), ...deps,
  });
  return { summary, rows: out.rows, charges: out.charges, calls: net.calls };
}

test('live mode: Workday site URL -> rows with live descriptions and full locations, one charge each', async () => {
  const r = await live({ companyUrls: ['https://workday.wd5.myworkdayjobs.com/en-US/Workday'] });
  assert.equal(r.summary.boards_ok, 1);
  assert.equal(r.rows.length, N);
  assert.equal(r.charges, N);
  for (const x of r.rows) assertMatchesSchema(x);
  assert.ok(r.rows.every((x) => x.description_status === 'included' && x.description_text && x.description_snippet), 'every row got its detail');
  assert.equal(r.summary.description_jobs_fetched, N);
  assert.ok(r.rows.every((x) => x.company_name === 'Workday'), 'name from the site page');
  const multi = r.rows.find((x) => x.title.startsWith('Business Development Representative | German'));
  assert.equal(multi.locations[0], 'Ireland, Dublin', 'the detail list replaces the path-derived primary location');
  assert.ok(!multi.locations.includes('Ireland Dublin') && multi.locations.includes('Germany, Munich'), multi.locations.join(' | '));
  assert.ok(multi.country_codes.includes('DE') && multi.country_codes.includes('IE'));
  // Newest first: the "Posted Today" rows lead.
  assert.equal(r.rows[0].posted_at, new Date(Date.UTC(2026, 8, 20)).toISOString());
  // Only the list endpoint, one detail per delivered job, robots.txt and the site page were requested.
  const wd = r.calls.filter((u) => u.includes('myworkdayjobs.com'));
  assert.equal(wd.filter((u) => u.includes('/job/')).length, N);
  assert.equal(wd.filter((u) => u.endsWith('/jobs')).length, 1);
});

test('live mode: no description requested -> no detail calls; maxResults limits detail calls too', async () => {
  const a = await live({ companyUrls: ['workday:workday.wd5/Workday'], includeDescription: false });
  assert.equal(a.rows.length, N);
  assert.ok(a.rows.every((x) => x.description_status === 'not_requested' && x.description_text === null));
  assert.equal(a.calls.filter((u) => u.includes('/job/')).length, 0);
  const b = await live({ companyUrls: ['workday:workday.wd5/Workday'], maxResults: 2 });
  assert.equal(b.rows.length, 2);
  assert.equal(b.calls.filter((u) => u.includes('/job/')).length, 2);
});

test('live mode: a job closed since listed (detail 404) is skipped and not charged; a failed detail is delivered without description', async () => {
  const paths = Object.keys(FX.details);
  const closedUrl = workdayDetailUrl(WORKDAY_BOARD, `${boardUrlFor(WORKDAY_BOARD)}${paths[0]}`);
  const brokenUrl = workdayDetailUrl(WORKDAY_BOARD, `${boardUrlFor(WORKDAY_BOARD)}${paths[1]}`);
  const r = await live({ companyUrls: ['workday:workday.wd5/Workday'] }, {
    extra: {
      [closedUrl]: () => { throw Object.assign(new Error('HTTP 404'), { status: 404, failureClass: 'http_error' }); },
      [brokenUrl]: () => { throw Object.assign(new Error('HTTP 500'), { status: 500, failureClass: 'site_down' }); },
    },
  });
  assert.equal(r.rows.length, N - 1);
  assert.equal(r.charges, N - 1);
  assert.equal(r.summary.skipped_closed, 1);
  assert.equal(r.summary.descriptions_unavailable, 1);
  assert.equal(r.summary.description_jobs_failed, 1);
});

async function buildWithWorkday(dir, builtAt = new Date(NOW - 86400000)) {
  const net = fakeNetwork();
  const writer = await new IndexWriter(dir, { builtAt }).open();
  for (const b of [...FIXTURE_BOARDS, WORKDAY_BOARD]) {
    const r = await fetchBoard(b, { fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => builtAt, robotsCache: fresh() });
    await writer.addBoard(b, r.company_name || 'Workday', r.jobs);
  }
  return writer.finish();
}

test('index: Workday jobs in their own shards; search mode delivers them with live details', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wd-index-'));
  try {
    const manifest = await buildWithWorkday(dir);
    assert.equal(manifest.ats_counts.workday, N);
    assert.ok(manifest.shards.filter((s) => s.ats === 'workday').length >= 1);
    const r = await live({ ats: ['workday'], keywords: ['representative'] }, { deps: { indexBaseUrl: pathToFileURL(dir).href } });
    assert.equal(r.summary.mode, 'search');
    assert.ok(r.rows.length >= 2 && r.rows.every((x) => x.ats === 'workday'));
    for (const x of r.rows) assertMatchesSchema(x);
    assert.ok(r.rows.every((x) => x.description_status === 'included'));
    assert.ok(r.rows.every((x) => x.apply_url === `${x.job_url}/apply` && x.source_url === apiUrlFor(WORKDAY_BOARD)));
    assert.ok(!r.calls.some((u) => u.endsWith('/jobs')), 'search mode reads details only, never the list');
    // Company filter by tenant name or by display name.
    for (const c of ['workday', 'Workday', 'https://workday.wd5.myworkdayjobs.com/Workday']) {
      const f = await live({ companies: [c], includeDescription: false }, { deps: { indexBaseUrl: pathToFileURL(dir).href } });
      assert.equal(f.rows.length, N, c);
    }
    assert.equal(companyMatches('Capital One', { ats: 'workday', company_board: 'capitalone.wd12/Capital_One', company_name: 'Capitalone' }), true);
    assert.equal(companyMatches('Capital One', { ats: 'greenhouse', company_board: 'capitalone', company_name: 'Capitalone' }), false, 'tenant rule is Workday-only');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('fallback: index without Workday shards + ats ["workday"] -> live fetch of built-in Workday sites', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wd-noshard-'));
  try {
    const net = fakeNetwork();
    const writer = await new IndexWriter(dir, { builtAt: new Date(NOW - 86400000) }).open();
    const gh = FIXTURE_BOARDS[0];
    const g = await fetchBoard(gh, { fetchJson: net.fetchJson, fetchText: net.fetchText });
    await writer.addBoard(gh, g.company_name, g.jobs);
    await writer.finish();
    const r = await live({ ats: ['workday'], keywords: ['engineer'], maxResults: 20, maxPerCompany: 3 }, {
      deps: { indexBaseUrl: pathToFileURL(dir).href, fallbackBoards: undefined },
    });
    // The built-in Workday sites are not in the fake network (they fail here), but they are the ones asked for.
    assert.equal(r.summary.used_fallback, true);
    assert.equal(r.summary.boards_requested, EXTRA_FALLBACK_BOARDS.workday.length);
    // With the fixture site as the only Workday fallback the run returns rows:
    const r2 = await live({ ats: ['workday'], maxResults: 20, maxPerCompany: 3 }, {
      deps: { indexBaseUrl: pathToFileURL(dir).href, fallbackBoards: [WORKDAY_BOARD] },
    });
    assert.equal(r2.summary.mode, 'fallback_live');
    assert.equal(r2.rows.length, 3, 'maxPerCompany 3');
    for (const x of r2.rows) assertMatchesSchema(x);
    // A platform the index has is searched normally.
    const r3 = await live({ ats: ['greenhouse'], includeDescription: false }, { deps: { indexBaseUrl: pathToFileURL(dir).href } });
    assert.equal(r3.summary.mode, 'search');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  for (const b of EXTRA_FALLBACK_BOARDS.workday) assert.deepEqual(parseBoardRef(`workday:${b.token}`), b);
});

test('http: Retry-After is honoured; a long one fails fast so callers can stop calling the host', async () => {
  assert.equal(retryAfterMs('120'), 120000);
  assert.equal(retryAfterMs(new Date(Date.now() + 5000).toUTCString()) > 3000, true);
  assert.equal(retryAfterMs('soon'), null);
  let hits = 0;
  const server = createServer((req, res) => {
    hits += 1;
    if (req.url === '/long') { res.writeHead(429, { 'retry-after': '86400' }); res.end(); return; }
    if (hits === 1) { res.writeHead(429, { 'retry-after': '1' }); res.end(); return; }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const t0 = Date.now();
    assert.deepEqual(await libFetchJson(`${base}/short`, { retries: 2, minDelayMs: 10 }), { ok: true });
    assert.ok(Date.now() - t0 >= 900, 'waited for Retry-After: 1');
    hits = 10;
    await assert.rejects(libFetchJson(`${base}/long`, { retries: 3, minDelayMs: 10 }), (e) => e.failureClass === 'blocked' && e.retryAfterMs === 86400000);
    assert.equal(hits, 11, 'no retries against a long Retry-After');
  } finally {
    server.close();
  }
});

test('live mode: sites of one Workday host are read one after another (one request in flight per host)', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchJson = async (url, opts) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    const site = url.split('/')[6];
    const { offset } = opts.body;
    const n = Math.max(0, Math.min(20, 30 - offset));
    return {
      total: offset === 0 ? 30 : 0,
      jobPostings: Array.from({ length: n }, (_, i) => ({
        title: `${site} job ${offset + i}`, externalPath: `/job/Berlin/${site}-${offset + i}_R${offset + i}`, locationsText: 'Berlin', postedOn: 'Posted Today',
      })),
    };
  };
  const out = sink();
  const summary = await runFeed(normalizeInput({ companyUrls: ['big.wd1/SiteA', 'big.wd1/SiteB', 'big.wd1/SiteC'], includeDescription: false }), {
    ...out, fetchJson, fetchText: async (u) => (u.endsWith('/robots.txt') ? 'User-agent: *\nDisallow: /refreshFacet/' : ''), now: () => NOW, hostGaps: {}, robotsCache: fresh(),
  });
  assert.equal(summary.boards_ok, 3);
  assert.equal(out.rows.length, 90);
  assert.equal(maxInFlight, 1);
});

test('live mode: a robots-disallowed site is reported as such (the Actor exits with a message, nothing charged)', async () => {
  const s = fakeSite(10, { robots: 'User-agent: *\nDisallow: /Big/' });
  const out = sink();
  const summary = await runFeed(normalizeInput({ companyUrls: ['big.wd1/Big'] }), {
    ...out, fetchJson: s.fetchJson, fetchText: s.fetchText, now: () => NOW, hostGaps: {}, robotsCache: fresh(),
  });
  assert.equal(out.rows.length, 0);
  assert.equal(s.bodies.length, 0);
  assert.deepEqual(summary.failed_boards, [{ board: 'workday:big.wd1/big', status: null, failure_class: 'blocked', robots: true }]);
});

test('robots.txt answered with an HTML page (Accept: text/html on Workday) is not a robots file', () => {
  const html = '<!DOCTYPE html>\n<html lang="en-US"><head></head></html>';
  assert.equal(robotsVerdict({ status: 200, text: html }, 'factpipe-jobs-feed', ['/wday/cxs/a/b/jobs']).allowed, false);
});
