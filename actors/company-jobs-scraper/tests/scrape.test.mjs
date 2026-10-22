// End to end without network: company URL -> robots.txt -> pages -> platform -> jobs (shared core live mode),
// over a fake web built from the golden pages and the core's real job-board goldens.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCompanies, discoverCompany, perHostPacer } from '../src/scrape.js';
import { LIMITS, ROW_FIELDS } from '../src/transform.js';
import { fakeWeb, page, sink, deps, HTML, PLAIN, REDIRECT, ROBOTS_ANSWERS, loadJobs } from './helpers.mjs';

const pg = (file) => HTML(page(file).html);
const nav = (...links) => HTML(`<html><head><title>Home</title></head><body><nav>${links.map(([h, t]) => `<a href="${h}">${t}</a>`).join('')}</nav></body></html>`);
const run = (web, input, extra = {}) => {
  const out = sink(extra.sink);
  return runCompanies(input, deps(web, out, extra)).then((summary) => ({ summary, rows: out.rows, charges: out.charges }));
};
const byQuery = (rows) => rows.reduce((m, r) => ((m[r.query] ||= []).push(r), m), {});

test('homepage -> careers link -> board on every platform; rows have the core schema + detection fields', async () => {
  const web = fakeWeb({
    pages: {
      'https://www.redhat.com/': REDIRECT('https://www.redhat.com/en'),
      'https://www.redhat.com/en': pg('redhat_home.html'),
      'https://www.redhat.com/en/jobs': pg('workday_redhat_jobs.html'),
      'https://shield.ai/': pg('shieldai_home.html'),
      'https://www.theblueground.com/': nav(['/about', 'About'], ['/careers', 'Careers']),
      'https://www.theblueground.com/careers': pg('workable_blueground_careers.html'),
      'https://tether.io/': pg('recruitee_tether_home.html'),
      'https://pmx-group.com/': pg('personio_pmx_home.html'),
      'https://sacyr.com/': pg('teamtailor_sacyr_home.html'),
      'https://www.qliro.com/': nav(['https://career.qliro.com/', 'Careers']),
      'https://career.qliro.com/': pg('teamtailor_qliro_careersite.html'),
      'https://ramp.com/': nav(['/careers', 'Careers']),
      'https://ramp.com/careers': pg('ashby_ramp_careers.html'),
      'https://www.figma.com/': nav(['/careers/', 'Careers']),
      'https://www.figma.com/careers/': pg('greenhouse_figma_careers.html'),
    },
    missingBoards: ['aechelontechnology'],
  });
  const input = ['https://www.redhat.com', 'shield.ai', 'https://www.theblueground.com', 'https://tether.io', 'https://pmx-group.com',
    'https://sacyr.com', 'https://www.qliro.com', 'https://ramp.com', 'https://www.figma.com'];
  const { summary, rows, charges } = await run(web, { companyUrls: input, maxJobsPerCompany: 2 });
  const q = byQuery(rows);
  const want = {
    'https://www.redhat.com': ['workday', 'redhat.wd5/jobs', 'https://www.redhat.com/en/jobs'],
    'shield.ai': ['lever', 'shieldai', 'https://shield.ai/'],
    'https://www.theblueground.com': ['workable', 'blueground', 'https://www.theblueground.com/careers'],
    'https://tether.io': ['recruitee', 'tether', 'https://tether.io/'],
    'https://pmx-group.com': ['personio', 'pmx', 'https://pmx-group.com/'],
    'https://sacyr.com': ['teamtailor', 'sacyr', 'https://sacyr.com/'],
    'https://www.qliro.com': ['teamtailor', 'career.qliro.com', 'https://career.qliro.com/'],
    'https://ramp.com': ['ashby', 'ramp', 'https://ramp.com/careers'],
    'https://www.figma.com': ['greenhouse', 'figma', 'https://www.figma.com/careers/'],
  };
  for (const [query, [ats, board, careers]] of Object.entries(want)) {
    assert.equal(q[query]?.length, 2, `${query}: maxJobsPerCompany rows`);
    for (const r of q[query]) {
      assert.deepEqual([r.found, r.reason, r.ats, r.detected_platform, r.company_board, r.careers_page_url], [true, null, ats, ats, board, careers], query);
      assert.deepEqual(Object.keys(r), ROW_FIELDS);
      assert.ok(r.job_url && r.title && r.fetched_at && r.source_url);
    }
  }
  assert.equal(charges, 18);
  assert.equal(summary.companies_with_jobs, 9);
  assert.deepEqual(summary.reasons, {});
  // Workday rows carry the core's enrichment + descriptions (one detail call per delivered job).
  assert.ok(q['https://www.redhat.com'].every((r) => r.description_status === 'included' && 'seniority' in r && 'visa_sponsorship' in r));
  // robots.txt of each company host was read before its first page.
  for (const host of ['www.redhat.com', 'shield.ai', 'career.qliro.com']) {
    const i = web.calls.indexOf(`TEXT https://${host}/robots.txt`);
    const j = web.calls.findIndex((c) => c.startsWith(`PAGE https://${host}/`));
    assert.ok(i >= 0 && i < j, host);
  }
  assert.equal(web.calls.filter((c) => c === 'TEXT https://career.qliro.com/robots.txt').length, 1, 'one robots fetch per host (shared with the core)');
});

test('direct board URLs and redirects to a board skip page fetching', async () => {
  const web = fakeWeb({ pages: { 'https://www.action1.com/careers': REDIRECT('https://apply.workable.com/action1/') } });
  const { rows } = await run(web, { companyUrls: ['https://boards.greenhouse.io/gitlab', 'https://www.action1.com/careers', 'teamtailor:career.qliro.com'], maxJobsPerCompany: 1 });
  const q = byQuery(rows);
  assert.equal(q['https://boards.greenhouse.io/gitlab'][0].careers_page_url, 'https://boards.greenhouse.io/gitlab');
  assert.equal(q['https://www.action1.com/careers'][0].company_board, 'action1');
  assert.equal(q['https://www.action1.com/careers'][0].careers_page_url, 'https://www.action1.com/careers');
  assert.equal(q['teamtailor:career.qliro.com'][0].ats, 'teamtailor');
  assert.ok(!web.calls.some((c) => c.startsWith('PAGE https://apply.workable.com') || c.startsWith('PAGE https://boards.greenhouse.io')), 'board pages are never scraped');
});

test('robots-disallowed company host: no page request at all, one free explanatory row', async () => {
  const web = fakeWeb({
    pages: { 'https://careers.airhelp.com/': pg('none_cloudflare_careers.html'), 'https://www.sap.com/': pg('redhat_home.html') },
    robots: {
      'careers.airhelp.com': ROBOTS_ANSWERS['careers.airhelp.com'], // text/html answer
      'www.sap.com': ROBOTS_ANSWERS['www.sap.com'], // User-agent: * Disallow: /
      'www.channable.com': { status: 403, text: '' },
      'nofile.example.org': { status: 404, text: '' },
    },
  });
  const { rows, charges } = await run(web, { companyUrls: ['https://careers.airhelp.com', 'https://www.sap.com', 'https://www.channable.com', 'https://nofile.example.org'] });
  assert.equal(charges, 0);
  assert.equal(rows.length, 4);
  for (const r of rows) assert.deepEqual([r.found, r.reason], [false, 'robots_disallowed'], r.query);
  assert.match(byQuery(rows)['https://careers.airhelp.com'][0].reason_detail, /not text\/plain/);
  assert.equal(web.calls.filter((c) => c.startsWith('PAGE ')).length, 0, 'never a page request to a host whose robots.txt is not permission');
});

test('robots.txt disallowing only the careers path: homepage read, careers page not', async () => {
  const web = fakeWeb({
    pages: { 'https://acme.com/': nav(['/careers', 'Careers']), 'https://acme.com/careers': pg('greenhouse_figma_careers.html') },
    robots: { 'acme.com': PLAIN('User-agent: *\nDisallow: /careers\n') },
  });
  const { rows } = await run(web, { companyUrls: ['acme.com'] });
  assert.deepEqual([rows.length, rows[0].reason], [1, 'robots_disallowed']);
  assert.ok(!web.calls.includes('PAGE https://acme.com/careers'));
  assert.ok(web.calls.includes('PAGE https://acme.com/'));
});

test('unsupported platform, in-house careers page, bad URLs, dead site: one free row each, run continues', async () => {
  const web = fakeWeb({
    pages: {
      'https://www.rentokil-initial.com/': nav(['https://careers.rentokil-initial.com/', 'Careers']),
      'https://careers.rentokil-initial.com/': pg('unsupported_rentokil_careers.html'),
      'https://www.cloudflare.com/': nav(['/careers/', 'Careers']),
      'https://www.cloudflare.com/careers/': pg('none_cloudflare_careers.html'),
      'https://www.cloudflare.com/careers/jobs/': HTML('<html><div id="jobs"></div><script src="/app.js"></script></html>'),
      'https://dead.example.net/': new TypeError('fetch failed'),
      'https://jobs.smartrecruiters.com/Acme': HTML('never fetched'),
    },
  });
  const input = ['https://www.rentokil-initial.com', 'https://www.cloudflare.com', 'not a url', 'ftp://x.com', 'https://dead.example.net',
    'https://jobs.smartrecruiters.com/Acme', 'https://boards.greenhouse.io/gitlab'];
  const { rows, charges, summary } = await run(web, { companyUrls: input, maxJobsPerCompany: 1 });
  const q = byQuery(rows);
  assert.deepEqual([q['https://www.rentokil-initial.com'][0].reason, q['https://www.rentokil-initial.com'][0].detected_platform], ['unsupported_platform', 'smartrecruiters']);
  assert.equal(q['https://www.rentokil-initial.com'][0].careers_page_url, 'https://careers.rentokil-initial.com/');
  assert.equal(q['https://www.cloudflare.com'][0].reason, 'no_supported_ats_detected');
  assert.equal(q['https://www.cloudflare.com'][0].careers_page_url, 'https://www.cloudflare.com/careers/');
  assert.equal(q['not a url'][0].reason, 'invalid_url');
  assert.equal(q['ftp://x.com'][0].reason, 'invalid_url');
  assert.equal(q['ftp://x.com'][0].source_url, null);
  assert.equal(q['https://dead.example.net'][0].reason, 'site_unreachable');
  assert.equal(q['https://jobs.smartrecruiters.com/Acme'][0].detected_platform, 'smartrecruiters');
  assert.ok(!web.calls.includes('PAGE https://jobs.smartrecruiters.com/Acme'));
  assert.equal(q['https://boards.greenhouse.io/gitlab'][0].found, true);
  assert.equal(charges, 1, 'only the job row is charged');
  assert.equal(summary.companies_with_jobs, 1);
  assert.equal(summary.info_rows, 6);
  // the dead site is not probed path by path
  assert.equal(web.calls.filter((c) => c.startsWith('PAGE https://dead.example.net')).length, 1);
});

test('dead or empty boards, duplicate inputs; charge limit stops the run', async () => {
  const web = fakeWeb({
    pages: { 'https://acme.com/': nav(['https://jobs.lever.co/acme-old', 'Jobs']), 'https://www.palantir.com/careers/': pg('lever_palantir_careers.html') },
    missingBoards: ['acme-old'],
  });
  const { rows } = await run(web, { companyUrls: ['https://acme.com', 'https://www.palantir.com/careers/', 'https://jobs.lever.co/palantir', 'https://jobs.lever.co/palantir/'], maxJobsPerCompany: 1 });
  const q = byQuery(rows);
  assert.equal(q['https://acme.com'][0].reason, 'ats_board_not_found');
  assert.equal(q['https://acme.com'][0].detected_platform, 'lever');
  assert.equal(q['https://www.palantir.com/careers/'][0].found, true);
  assert.equal(q['https://jobs.lever.co/palantir'][0].reason, 'duplicate_input', 'same board as an earlier input: listed (and charged) once');
  assert.equal(q['https://jobs.lever.co/palantir/'], undefined, 'identical input lines are read once');

  const emptyWeb = fakeWeb();
  const empty = structuredClone(loadJobs('greenhouse_jobs.json'));
  empty.jobs = [];
  const fetchJson = async () => empty;
  const r2 = await run(emptyWeb, { companyUrls: ['https://boards.greenhouse.io/acme'] }, { fetchJson });
  assert.deepEqual([r2.rows.length, r2.rows[0].reason, r2.charges], [1, 'ats_board_empty', 0]);

  const web3 = fakeWeb();
  const r3 = await run(web3, { companyUrls: ['https://boards.greenhouse.io/a', 'https://boards.greenhouse.io/b', 'https://boards.greenhouse.io/c'], maxJobsPerCompany: 3 },
    { sink: { chargeLimit: 2 }, concurrency: 1 });
  assert.equal(r3.charges, 2);
  assert.equal(r3.rows.length, 2);
  assert.equal(r3.summary.stop_reason, 'charge_limit');
});

test('Workday board robots.txt disallowing the site -> ats_board_disallowed; time limit -> not_processed', async () => {
  const web = fakeWeb({ robots: { 'acme.wd1.myworkdayjobs.com': PLAIN('User-agent: *\nDisallow: /\n') } });
  const { rows } = await run(web, { companyUrls: ['https://acme.wd1.myworkdayjobs.com/External'] });
  assert.equal(rows[0].reason, 'ats_board_disallowed');
  assert.ok(!web.calls.some((c) => c.startsWith('POST ')), 'no jobs call');

  const late = await run(fakeWeb(), { companyUrls: ['https://boards.greenhouse.io/gitlab', 'shield.ai'] }, { deadline: { hasTimeFor: () => false } });
  assert.deepEqual(late.rows.map((r) => r.reason), ['not_processed', 'not_processed']);
  assert.equal(late.summary.stop_reason, 'time_limit');
});

test('discovery budget: few pages per company, careers paths probed last, depth limited', async () => {
  // A site where every page links two more careers-ish pages and nothing has a board.
  let n = 0;
  const pages = new Proxy({}, { get: (_, url) => (typeof url === 'string' && url.startsWith('https://big.example.org/')
    ? nav([`/careers/p${++n}`, 'Careers'], [`/jobs/q${++n}`, 'Jobs']) : undefined) });
  const web = fakeWeb({ pages });
  const d = await discoverCompany('https://big.example.org', { fetchPage: web.fetchPage, fetchText: web.fetchText, pace: async () => {}, robotsCache: new Map() });
  assert.equal(d.miss.reason, 'no_supported_ats_detected');
  assert.ok(d.pages <= LIMITS.pagesPerCompany, `${d.pages} pages`);
  assert.equal(web.calls.filter((c) => c.startsWith('TEXT https://big.example.org/robots.txt')).length, 1);
  // Careers paths are probed when no page links a careers page.
  const web2 = fakeWeb({ pages: { 'https://plain.example.org/': nav(['/about', 'About']), 'https://plain.example.org/careers': pg('ashby_notion_careers.html') } });
  const d2 = await discoverCompany('plain.example.org', { fetchPage: web2.fetchPage, fetchText: web2.fetchText, pace: async () => {}, robotsCache: new Map() });
  assert.deepEqual(d2.boards, [{ ats: 'ashby', token: 'notion' }]);
  assert.equal(d2.careersPageUrl, 'https://plain.example.org/careers');
});

test('a careers page rendered by the company front end: one posting page reveals the ATS', async () => {
  const web = fakeWeb({
    pages: {
      'https://careers.airbnb.com/': nav(['/positions', 'Job Search']),
      'https://careers.airbnb.com/positions': HTML(page('greenhouse_airbnb_posting.html').html.replace(/<script[^>]*grnhse[\s\S]*?<\/script>|<script[^>]*greenhouse[^>]*><\/script>/gi, '')),
      'https://careers.airbnb.com/positions/7789554/': pg('greenhouse_airbnb_posting.html'),
    },
  });
  const d = await discoverCompany('https://careers.airbnb.com/', { fetchPage: web.fetchPage, fetchText: web.fetchText, pace: async () => {}, robotsCache: new Map() });
  assert.deepEqual(d.boards, [{ ats: 'greenhouse', token: 'airbnb' }]);
});

test('per-host pacer spaces request starts on one host only', async () => {
  const pace = perHostPacer(50);
  const t0 = Date.now();
  await Promise.all([pace('a.com'), pace('b.com')]);
  assert.ok(Date.now() - t0 < 40, 'different hosts do not wait');
  await pace('a.com');
  assert.ok(Date.now() - t0 >= 45, 'same host waits the gap');
});
