// Platform detection and careers-page discovery on golden pages (real careers pages, captured 2026-10-22, trimmed).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectPlatforms, boardFromUrl, unsupportedPlatformOf, careersLinks, careersScore, postingLinks, parseCompanyInput,
  isTeamtailorCareerSite, templatedBoards, unescapePage, siteOf, robotsPath, missRow, jobRow, ROW_FIELDS, REASONS, LIMITS,
} from '../src/transform.js';
import { ATS_LIST } from '../src/core/transform.js';
import { robotsVerdict } from '../src/core/robots.js';
import { ROBOTS_AGENT, OUTPUT_FIELDS } from '../src/core/feed.js';
import { page, ROBOTS_ANSWERS, assertMatchesSchema } from './helpers.mjs';

const boardsOf = (file) => {
  const { url, html } = page(file);
  return detectPlatforms(html, url).boards.map(({ ats, token, region }) => (region ? `${ats}:${region}:${token}` : `${ats}:${token}`));
};

test('every platform of the core is detected on a real careers page', () => {
  const cases = {
    'greenhouse_figma_careers.html': ['greenhouse:figma'], // job links boards.greenhouse.io/figma/jobs/...?gh_jid=
    'greenhouse_airbnb_posting.html': ['greenhouse:airbnb'], // embed script boards.greenhouse.io/embed/job_board/js?for=airbnb
    'greenhouse_attentive_careers.html': ['greenhouse:attentive'], // inline JS: boardToken = 'attentive' + `boards-api.../${boardToken}`
    'lever_palantir_careers.html': ['lever:palantir'],
    'shieldai_home.html': ['lever:shieldai'],
    'ashby_notion_careers.html': ['ashby:notion'],
    'ashby_ramp_careers.html': ['ashby:ramp'], // links inside inline JSON
    'workable_blueground_careers.html': ['workable:blueground'], // blueground.workable.com + apply.workable.com/j/<id>
    'recruitee_tether_home.html': ['recruitee:tether'],
    'workday_redhat_jobs.html': ['workday:redhat.wd5/jobs'], // .../jobs/login, /en-US/jobs/introduceYourself
    'workday_accenture_careers.html': ['workday:accenture.wd103/AccentureCareers'], // URLs entity-encoded (&#34;)
    'workday_workday_careers.html': ['workday:workday.wd5/Workday'],
    'personio_pmx_home.html': ['personio:pmx'], // JSON-escaped (\/ and &quot;)
    'teamtailor_sacyr_home.html': ['teamtailor:sacyr'],
    'teamtailor_home.html': ['teamtailor:career'],
    'teamtailor_qliro_careersite.html': ['teamtailor:career.qliro.com'], // Teamtailor career site on a custom domain
  };
  const seen = new Set();
  for (const [file, want] of Object.entries(cases)) {
    assert.deepEqual(boardsOf(file), want, file);
    for (const b of want) seen.add(b.split(':')[0]);
  }
  assert.deepEqual([...seen].sort(), [...ATS_LIST].sort(), 'golden pages cover every platform of the core');
});

test('unsupported platform and in-house careers pages: no board', () => {
  const r = page('unsupported_rentokil_careers.html');
  assert.deepEqual(detectPlatforms(r.html, r.url), { boards: [], unsupported: 'smartrecruiters' });
  const cf = page('none_cloudflare_careers.html');
  assert.deepEqual(detectPlatforms(cf.html, cf.url), { boards: [], unsupported: null });
  assert.equal(unsupportedPlatformOf('https://jobs.smartrecruiters.com/RentokilInitial1/espana'), 'smartrecruiters');
  assert.equal(unsupportedPlatformOf('https://acme.wd1.myworkdayjobs.com/x'), null);
  assert.equal(unsupportedPlatformOf('https://fa-abcd-saasfaprod1.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX'), 'oracle_recruiting_cloud');
  assert.equal(unsupportedPlatformOf('https://www.oraclecloud.com/pricing'), null);
  for (const u of ['https://careers.adobe.com', 'https://www.example.com/careers']) assert.equal(unsupportedPlatformOf(u), null, u);
});

test('boardFromUrl: board hosts only, embeds, placeholders and service hosts rejected', () => {
  const ok = {
    'https://boards.greenhouse.io/embed/job_board/js?for=airbnb': 'greenhouse:airbnb',
    'https://job-boards.greenhouse.io/embed/job_app?token=123&for=Acme': 'greenhouse:acme',
    'https://job-boards.greenhouse.io/gitlab/jobs/123': 'greenhouse:gitlab',
    'https://boards-api.greenhouse.io/v1/boards/attentive/departments': 'greenhouse:attentive',
    'https://jobs.eu.lever.co/acme/abc': 'lever:eu:acme',
    'https://jobs.ashbyhq.com/kraken.com?af_js_web=true': 'ashby:kraken.com',
    'https://apply.workable.com/acme/j/ABC123/': 'workable:acme',
    'https://acme.recruitee.com/o/engineer': 'recruitee:acme',
    'https://nvidia.wd5.myworkdayjobs.com/NVIDIAExternalCareerSite/login': 'workday:nvidia.wd5/NVIDIAExternalCareerSite',
    'https://wd3.myworkdaysite.com/recruiting/acme/External': 'workday:acme.wd3/External',
    'https://pmx.jobs.personio.de/job/123?language=de': 'personio:pmx',
    'https://acme.jobs.personio.com/': 'personio:acme',
    'https://career.teamtailor.com/jobs': 'teamtailor:career',
    'https://acme.na.teamtailor.com/': 'teamtailor:acme.na',
  };
  for (const [u, want] of Object.entries(ok)) {
    const b = boardFromUrl(u);
    assert.equal(b && `${b.ats}:${b.region ? `${b.region}:` : ''}${b.token}`, want, u);
  }
  for (const u of [
    'https://boards.greenhouse.io/embed/job_board/js', 'https://www.greenhouse.io/careers', 'https://api.greenhouse.io/v1/x',
    'https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs', 'https://jobs.lever.co/', 'https://www.workable.com/assets/embed.js',
    'https://apply.workable.com/j/2DA03D2059', 'https://www.teamtailor.com/en/', 'https://trust.teamtailor.com/', 'https://app.teamtailor.com/x',
    'https://media.cdn.teamtailor.com/x.png', 'https://jobs.personio.de/', 'https://www.personio.de/', 'https://example.com/greenhouse:acme',
    'greenhouse:acme', 'https://www.myworkday.com/acme/d/home.htmld',
  ]) assert.equal(boardFromUrl(u), null, u);
});

test('page text: entities, JSON escapes and templated tokens are read', () => {
  assert.equal(unescapePage('href=&#34;https:\\/\\/a.jobs.personio.de\\/&quot;'), 'href="https://a.jobs.personio.de/"');
  assert.deepEqual(templatedBoards("const boardToken = 'attentive';\nfetch(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`)"), [{ ats: 'greenhouse', token: 'attentive' }]);
  assert.deepEqual(templatedBoards('fetch(`https://api.lever.co/v0/postings/${site}?mode=json`)'), [], 'variable without a literal value');
  assert.deepEqual(boardsOf('greenhouse_airbnb_posting.html'), ['greenhouse:airbnb']);
});

test('Teamtailor career-site markers: stylesheet + careersite controllers (custom domains only)', () => {
  assert.equal(isTeamtailorCareerSite(page('teamtailor_qliro_careersite.html').html), true);
  for (const f of ['teamtailor_home.html', 'teamtailor_sacyr_home.html', 'none_cloudflare_careers.html']) assert.equal(isTeamtailorCareerSite(page(f).html), false, f);
  // A two-label custom domain with a 2-letter TLD would read as a regional *.teamtailor.com token in the core.
  const { html } = page('teamtailor_qliro_careersite.html');
  assert.deepEqual(detectPlatforms(html, 'https://qliro.se/').boards, []);
});

test('careers links: same site, careers words in text/path/host, best first; postings as last resort', () => {
  const rh = page('redhat_home.html');
  assert.deepEqual(careersLinks(rh.html, rh.url).map((l) => l.url), ['https://www.redhat.com/en/jobs']);
  const cf = page('none_cloudflare_careers.html');
  assert.equal(careersLinks(cf.html, cf.url)[0].url, 'https://www.cloudflare.com/careers/jobs/');
  assert.ok(careersLinks(cf.html, cf.url).length <= LIMITS.linksPerPage);
  const html = `<a href="/about">About</a><a href="/careers">Careers</a><a href="https://www.linkedin.com/company/acme/jobs">LinkedIn</a>
    <a href="https://jobs.acme-group.com/">Jobs</a><a href="https://other.com/careers">Partner careers</a><a href="/blog/jobs-report">Jobs report</a>
    <a href="mailto:jobs@acme.com">Mail</a><a href="/careers/brochure.pdf">Careers PDF</a><a href="https://careers.acme.com/">Work with us</a>`;
  assert.deepEqual(careersLinks(html, 'https://www.acme.com/', { limit: 10 }).map((l) => l.url), [
    'https://careers.acme.com/', 'https://www.acme.com/careers', 'https://jobs.acme-group.com/', 'https://www.acme.com/blog/jobs-report',
  ]);
  assert.equal(careersScore('https://www.acme.com/jobs/12345-engineer', ''), 2, 'a single posting is not a careers page');
  const ab = page('greenhouse_airbnb_posting.html');
  assert.deepEqual(postingLinks(ab.html, ab.url), ['https://careers.airbnb.com/positions/7789554/']);
  assert.deepEqual(postingLinks('<a href="/careers?gh_jid=4567">Engineer</a>', 'https://acme.com/careers'), ['https://acme.com/careers?gh_jid=4567']);
});

test('robots answers of real hosts: only a 2xx text/plain file that allows the path is permission', () => {
  const v = (host, path = '/') => robotsVerdict(ROBOTS_ANSWERS[host], ROBOTS_AGENT, [path]);
  assert.equal(v('careers.airhelp.com').allowed, false, 'robots.txt answered with text/html');
  assert.match(v('careers.airhelp.com').reason, /not text\/plain/);
  assert.equal(v('www.sap.com').allowed, false, 'User-agent: * Disallow: /');
  assert.match(v('www.sap.com').reason, /disallows \//);
  assert.equal(v('www.channable.com').allowed, false, 'robots.txt HTTP 403');
});

test('input URLs: scheme added, junk rejected, explicit board refs', () => {
  assert.deepEqual(parseCompanyInput('redhat.com'), { url: 'https://redhat.com/' });
  assert.deepEqual(parseCompanyInput(' https://www.Acme.com/careers#open '), { url: 'https://www.acme.com/careers' });
  assert.deepEqual(parseCompanyInput('teamtailor:careers.mynewsdesk.com'), { board: { ats: 'teamtailor', token: 'careers.mynewsdesk.com' } });
  for (const bad of ['', 'not a url', 'ftp://acme.com', 'http://localhost:3000', 'https://10.0.0.1/', 'acme', 'https://-acme.com']) {
    assert.ok(parseCompanyInput(bad).error, bad);
  }
  assert.equal(siteOf('careers.acme.co.uk'), 'acme.co.uk');
  assert.equal(siteOf('www.redhat.com'), 'redhat.com');
  assert.equal(robotsPath('https://a.com/careers?x=1'), '/careers?x=1');
});

test('rows: explanatory rows carry every field (schema-valid, nothing charged); job rows = extras + core fields', () => {
  assert.deepEqual(ROW_FIELDS.slice(6), OUTPUT_FIELDS);
  for (const reason of REASONS) {
    const r = missRow({ query: 'x', reason, detail: 'why', platform: reason === 'unsupported_platform' ? 'smartrecruiters' : null });
    assertMatchesSchema(r);
    assert.deepEqual(Object.keys(r), ROW_FIELDS);
    assert.equal(r.found, false);
  }
  assert.throws(() => missRow({ query: 'x', reason: 'nope' }), /unknown reason/);
  const core = Object.fromEntries(OUTPUT_FIELDS.map((k) => [k, null]));
  const row = jobRow({ ...core, ats: 'lever', locations: ['Berlin'] }, { query: 'acme.com', careersPageUrl: 'https://acme.com/careers' });
  assert.deepEqual(Object.keys(row), ROW_FIELDS);
  assert.deepEqual([row.found, row.reason, row.detected_platform, row.careers_page_url, row.country_codes], [true, null, 'lever', 'https://acme.com/careers', []]);
});
