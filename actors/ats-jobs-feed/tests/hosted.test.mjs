// JazzHR (career page + job-page JSON-LD) and Pinpoint (postings.json + job-page JSON-LD): board refs, parsers on
// real (trimmed) responses, robots.txt per host before any other request and per job page, live + search mode,
// schema validity of the rows in every jobs Actor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  parseBoardRef, parseBoard, apiUrlFor, boardUrlFor, boardHost, robotsPathsFor, jobPathsFor, atsOfUrl, ATS_LIST,
  ROBOTS_CHECKED_ATS, parseJobPostingLd, parseJobPage, mergeJobDetail, jazzhrNameFromPage,
} from '../src/core/transform.js';
import {
  fetchBoard, runFeed, toOutput, EXTRA_FALLBACK_BOARDS, HOST_GAP_MS, pinpointNameFromPage, compactDetail, streamShardLines, readJobPages,
} from '../src/core/feed.js';
import { normalizeInput } from '../src/core/filters.js';
import { IndexWriter } from '../src/core/index_writer.js';
import { load, sink, assertMatchesSchema } from './helpers.mjs';

const J = load('jazzhr_board.json');
const P = load('pinpoint_postings.json');
const JB = { ats: 'jazzhr', token: J.token };
const PB = { ats: 'pinpoint', token: P.token };
const NOW = Date.parse('2026-11-16T12:00:00Z');
const plain = (text) => ({ status: 200, text, contentType: 'text/plain; charset=utf-8' });
const [JOB1, JOB2, JOB3] = Object.keys(J.job_pages).concat(['https://brennancenter.applytojob.com/apply/yXddZk0ojF/Counsel-Voting-Rights-And-Elections-Program']);

/** fetchText stand-in: golden routes (+ overrides); unknown URL -> HTTP 404. Records calls. */
function net(extra = {}) {
  const routes = {
    'https://brennancenter.applytojob.com/robots.txt': () => plain(J.robots_txt),
    [apiUrlFor(JB)]: () => J.page,
    ...Object.fromEntries(Object.entries(J.job_pages).map(([u, h]) => [u, () => h])),
    'https://nypl.pinpointhq.com/robots.txt': () => plain(P.robots_txt),
    [apiUrlFor(PB)]: () => JSON.stringify(P.json),
    [boardUrlFor(PB)]: () => `<html><head>${P.page_title}</head></html>`,
    ...Object.fromEntries(Object.entries(P.job_pages).map(([u, h]) => [u, () => h])),
    ...extra,
  };
  const calls = [];
  const fetchText = async (url, opts = {}) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw Object.assign(new Error(`HTTP 404 at ${url}`), { status: 404, failureClass: 'http_error' });
    const v = r(opts);
    if (v && v.status && v.status >= 400) throw Object.assign(new Error(`HTTP ${v.status} at ${url}`), { status: v.status });
    return typeof v === 'string' || opts.meta ? v : v.text;
  };
  const fetchJson = async (url) => { calls.push(url); throw Object.assign(new Error(`HTTP 404 at ${url}`), { status: 404 }); };
  return { fetchText, fetchJson, calls };
}

test('board refs, hosts, endpoints and robots paths (JazzHR, Pinpoint)', () => {
  const cases = {
    'https://brennancenter.applytojob.com/apply': JB,
    'https://BrennanCenter.applytojob.com/apply/WpIfUaLo9Q/Associate-Editor?source=GS': JB,
    'jazzhr:brennancenter': JB,
    'https://nypl.pinpointhq.com/': PB,
    'https://nypl.pinpointhq.com/en/postings/7ea0cec2-63cc-4f0d-a3e1-f3104da45065': PB,
    'pinpoint:NYPL': PB,
  };
  for (const [ref, want] of Object.entries(cases)) assert.deepEqual(parseBoardRef(ref), want, ref);
  for (const bad of ['https://www.pinpointhq.com', 'https://app.applytojob.com/x', 'https://www.jazzhr.com/']) assert.equal(parseBoardRef(bad), null, bad);
  assert.ok(ATS_LIST.includes('jazzhr') && ATS_LIST.includes('pinpoint'));
  assert.ok(ROBOTS_CHECKED_ATS.includes('jazzhr') && ROBOTS_CHECKED_ATS.includes('pinpoint'));
  assert.equal(boardHost(JB), 'brennancenter.applytojob.com');
  assert.equal(apiUrlFor(PB), 'https://nypl.pinpointhq.com/postings.json');
  assert.deepEqual(robotsPathsFor(JB), ['/apply', '/apply/']);
  assert.deepEqual(jobPathsFor(PB, { job_url: 'https://nypl.pinpointhq.com/en/postings/84dda664-8f70-4e4e-be51-0aa3a51fe02d' }),
    ['/en/postings/84dda664-8f70-4e4e-be51-0aa3a51fe02d', '/postings/84dda664-8f70-4e4e-be51-0aa3a51fe02d']);
  assert.equal(atsOfUrl(JOB1), 'jazzhr');
  assert.equal(atsOfUrl(apiUrlFor(PB)), 'pinpoint');
  assert.ok(HOST_GAP_MS.jazzhr >= 500 && HOST_GAP_MS.pinpoint >= 500);
  for (const ats of ['jazzhr', 'pinpoint']) {
    assert.ok(EXTRA_FALLBACK_BOARDS[ats]?.length >= 2, ats);
    for (const b of EXTRA_FALLBACK_BOARDS[ats]) assert.deepEqual(parseBoardRef(`${b.ats}:${b.token}`), b);
  }
});

test('jazzhr: real career page -> list records; job-page JSON-LD -> date, pay, type, description', () => {
  const r = parseBoard(JB, J.page);
  assert.equal(r.company_name, 'Brennan Center for Justice');
  assert.equal(jazzhrNameFromPage(J.page), 'Brennan Center for Justice');
  assert.deepEqual(r.jobs.map((j) => j.job_id), ['jazzhr:brennancenter:WpIfUaLo9Q', 'jazzhr:brennancenter:SuEESwkhOF', 'jazzhr:brennancenter:yXddZk0ojF']);
  const j = r.jobs[1];
  assert.deepEqual([j.title, j.locations, j.country_codes, j.job_url, j.posted_at, j.description_text],
    ['Counsel, Democracy', ['New York, NY'], ['US'], JOB2, null, null]);
  const d = parseJobPostingLd(J.job_pages[JOB1]);
  assert.deepEqual([d.posted_at, d.employment_type, d.salary_min, d.salary_max, d.salary_currency, d.salary_period, d.company_name],
    ['2026-10-08T00:00:00.000Z', 'FULL TIME', 100000, 120000, 'USD', 'year', 'Brennan Center for Justice']);
  assert.ok(d.description_text.startsWith('The Brennan Center for Justice'));
  const m = mergeJobDetail(r.jobs[0], d);
  assert.deepEqual([m.posted_at, m.employment_type, m.salary_min, m.locations], ['2026-10-08T00:00:00.000Z', 'full_time', 100000, ['New York, NY']]);
  assert.ok(m.description_snippet.startsWith('The Brennan Center'));
  assert.equal(parseJobPostingLd('<html><body>no structured data</body></html>'), null);
  // A JazzHR job page without JobPosting data (real markup, 2026-11-16): the #job-description block is the only field.
  const bare = `<div class='col col-xs-7 description' id="job-description">\n<p>We are growing our <b>Frontend</b> team. Mail jobs@example.com</p>\n</div>\n`
    + '<div class="resumator-mobile-apply-wrapper mobile"><a>Share</a><button>Apply</button></div><div id="job-application-form-container">form</div>';
  assert.deepEqual(parseJobPage('jazzhr', bare), { description_text: 'We are growing our Frontend team. Mail [email redacted]' });
  assert.equal(parseJobPage('pinpoint', bare), null, 'the fallback is JazzHR markup only');
  assert.deepEqual(parseJobPage('jazzhr', J.job_pages[JOB1]), d);
  assert.equal(mergeJobDetail(r.jobs[0], null), r.jobs[0]);
  assert.throws(() => parseBoard(JB, '<html><body>Not found</body></html>'), (e) => e.failureClass === 'schema_change');
  // Cache form: trimmed description, no title / company.
  const c = compactDetail(d, true, 50);
  assert.equal(c.description_text.length, 50);
  assert.ok(!('title' in c) && !('company_name' in c));
  assert.equal(compactDetail(d, false).description_text, null);
});

test('pinpoint: real postings.json -> records (UUID id, department, workplace, published pay, no reporting_to)', () => {
  const r = parseBoard(PB, JSON.stringify(P.json));
  assert.equal(r.jobs.length, 3);
  const [a, b] = r.jobs;
  assert.equal(a.job_id, 'pinpoint:nypl:7ea0cec2-63cc-4f0d-a3e1-f3104da45065');
  assert.deepEqual([a.department, a.employment_type, a.workplace_type, a.remote, a.salary_min, a.salary_currency, a.salary_period, a.posted_at],
    ['Facilities', 'full_time', 'onsite', false, 44904, 'USD', 'year', null]);
  assert.deepEqual([b.workplace_type, b.locations], ['hybrid', ['New York, New York']]);
  assert.ok(r.jobs.every((j) => j.description_text && !JSON.stringify(j).includes('Jane Example')), 'reporting_to is never copied');
  const d = parseJobPostingLd(P.job_pages[a.job_url]);
  const m = mergeJobDetail(a, d);
  assert.deepEqual([m.posted_at, m.country_codes, m.description_text], ['2026-07-08T19:01:26.000Z', ['US'], a.description_text], 'date from the page, text from the feed');
  assert.equal(pinpointNameFromPage(P.page_title), 'The New York Public Library');
  assert.equal(pinpointNameFromPage('<meta property="og:title" content="Careers at Acme Ltd">'), 'Acme Ltd');
  assert.throws(() => parseBoard(PB, '<html></html>'), (e) => e.failureClass === 'schema_change');
  assert.throws(() => parseBoard(PB, '{"jobs": []}'), (e) => e.failureClass === 'schema_change');
});

test('fetch: robots.txt first; job pages read up to maxDetails; known details reused; a 404 page is a closed job', async () => {
  const n = net({ [JOB2]: () => ({ status: 404 }) });
  const known = new Map([['jazzhr:brennancenter:yXddZk0ojF', { posted_at: '2026-11-01T00:00:00.000Z', description_text: 'Cached text.' }]]);
  const r = await fetchBoard(JB, { fetchText: n.fetchText, now: () => new Date(NOW), robotsCache: new Map(), knownDetails: known });
  assert.equal(n.calls[0], 'https://brennancenter.applytojob.com/robots.txt');
  assert.deepEqual(r.jobs.map((j) => j.job_id.split(':')[2]), ['WpIfUaLo9Q', 'yXddZk0ojF'], 'SuEESwkhOF closed (job page 404)');
  assert.equal(r.closed, 1);
  assert.equal(r.details.size, 1);
  assert.equal(r.jobs[1].description_text, 'Cached text.');
  assert.ok(!n.calls.includes(JOB3), 'known detail: no request');
  assert.ok(r.jobs.every((j) => j.source_url === apiUrlFor(JB) && j.fetched_at === new Date(NOW).toISOString() && j.company_name === 'Brennan Center for Justice'));
  const capped = net();
  const r0 = await fetchBoard(JB, { fetchText: capped.fetchText, now: () => new Date(NOW), robotsCache: new Map(), maxDetails: 0 });
  assert.equal(r0.jobs.length, 3);
  assert.deepEqual(capped.calls, ['https://brennancenter.applytojob.com/robots.txt', apiUrlFor(JB)], 'maxDetails 0: list only');
});

test('readJobPages (build pass 2): cached list + robots per page; no request without a missing page; deadline stops it', async () => {
  const jobs = parseBoard(JB, J.page).jobs;
  const all = new Map(jobs.map((j) => [j.job_id, { posted_at: '2026-11-01T00:00:00.000Z' }]));
  const none = net();
  const r0 = await readJobPages(JB, jobs, { fetchText: none.fetchText, robotsCache: new Map(), knownDetails: all, maxDetails: 15 });
  assert.deepEqual(none.calls, [], 'every page known: no request at all (not even robots.txt)');
  assert.ok(r0.jobs.every((j) => j.posted_at === '2026-11-01T00:00:00.000Z'));
  const n = net();
  const r = await readJobPages(JB, jobs, { fetchText: n.fetchText, robotsCache: new Map(), maxDetails: 15 });
  assert.deepEqual(n.calls, ['https://brennancenter.applytojob.com/robots.txt', JOB1, JOB2, JOB3]);
  assert.deepEqual([r.details.size, r.closed, r.jobs.length, r.requests], [2, 1, 2, 3]);
  const late = net();
  const r2 = await readJobPages(JB, jobs, { fetchText: late.fetchText, robotsCache: new Map(), maxDetails: 15, deadline: { hasTimeFor: () => false } });
  assert.equal(r2.requests, 0);
  assert.equal(r2.jobs.length, 3, 'out of time: the list stands');
  const deny = net({ 'https://brennancenter.applytojob.com/robots.txt': () => plain('User-agent: *\nDisallow: /apply/SuEESwkhOF') });
  const r3 = await readJobPages(JB, jobs, { fetchText: deny.fetchText, robotsCache: new Map(), maxDetails: 15 });
  assert.ok(!deny.calls.includes(JOB2), 'a disallowed job page is never requested');
  assert.equal(r3.jobs.length, 2);
});

test('robots: a disallowing tenant is never read; a disallowed posting is dropped; HTML robots / 5xx = not read', async () => {
  const deny = net({ 'https://nypl.pinpointhq.com/robots.txt': () => plain('User-agent: *\nDisallow: /') });
  await assert.rejects(fetchBoard(PB, { fetchText: deny.fetchText, now: () => new Date(NOW), robotsCache: new Map() }), (e) => e.robots === true);
  assert.deepEqual(deny.calls, ['https://nypl.pinpointhq.com/robots.txt']);
  const first = P.json.data[0].url.match(/postings\/([0-9a-f-]{36})/)[1];
  const one = net({ 'https://nypl.pinpointhq.com/robots.txt': () => plain(`${P.robots_txt}\nUser-agent: *\nDisallow: /postings/${first}\n`) });
  const r = await fetchBoard(PB, { fetchText: one.fetchText, now: () => new Date(NOW), robotsCache: new Map(), skipName: true });
  assert.equal(r.robots_dropped, 1);
  assert.ok(!r.jobs.some((j) => j.job_id.endsWith(first)));
  assert.ok(!one.calls.includes(P.json.data[0].url), 'the disallowed job page is never requested');
  for (const bad of [{ status: 200, text: '<html>app</html>', contentType: 'text/html' }, { status: 503 }]) {
    const n = net({ 'https://brennancenter.applytojob.com/robots.txt': () => bad });
    await assert.rejects(fetchBoard(JB, { fetchText: n.fetchText, now: () => new Date(NOW), robotsCache: new Map() }), (e) => e.robots === true);
    assert.deepEqual(n.calls.filter((u) => !u.endsWith('/robots.txt')), []);
  }
  const missing = net({ 'https://brennancenter.applytojob.com/robots.txt': () => ({ status: 404 }) });
  const ok = await fetchBoard(JB, { fetchText: missing.fetchText, now: () => new Date(NOW), robotsCache: new Map(), maxDetails: 0 });
  assert.equal(ok.jobs.length, 3, 'no robots.txt (404) = no restrictions (R1)');
});

async function live(input, extra = {}) {
  const n = net(extra);
  const out = sink();
  const summary = await runFeed(normalizeInput(input), { ...out, fetchJson: n.fetchJson, fetchText: n.fetchText, now: () => NOW, hostGaps: {}, robotsCache: new Map() });
  return { summary, rows: out.rows, charges: out.charges, calls: n.calls };
}

test('live mode: JazzHR + Pinpoint boards -> schema-valid rows with descriptions, one charge each, closed jobs free', async () => {
  const r = await live({ companyUrls: ['https://brennancenter.applytojob.com/apply', 'https://nypl.pinpointhq.com/'] });
  assert.equal(r.summary.boards_ok, 2);
  // Job pages missing from the goldens answer 404 = closed since the list was read (JazzHR job 3, Pinpoint postings
  // 2 and 3): not delivered, not charged.
  assert.deepEqual(r.rows.map((x) => x.job_id).sort(), ['jazzhr:brennancenter:SuEESwkhOF', 'jazzhr:brennancenter:WpIfUaLo9Q',
    'pinpoint:nypl:7ea0cec2-63cc-4f0d-a3e1-f3104da45065']);
  assert.equal(r.charges, 3);
  for (const x of r.rows) assertMatchesSchema(x);
  assert.ok(r.rows.every((x) => x.description_status === 'included'));
  const ed = r.rows.find((x) => x.job_id === 'jazzhr:brennancenter:WpIfUaLo9Q');
  assert.deepEqual([ed.salary_source, ed.employment_type, ed.posted_at], ['structured', 'full_time', '2026-10-08T00:00:00.000Z']);
  assert.ok(r.rows.filter((x) => x.ats === 'pinpoint').every((x) => x.company_name === 'The New York Public Library'));
});

test('index + search mode: list records in the index; delivery reads the JazzHR job page, skips a closed one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hosted-index-'));
  try {
    const builtAt = new Date(NOW - 3600000);
    const n = net();
    const writer = await new IndexWriter(dir, { builtAt }).open();
    for (const b of [JB, PB]) {
      const r = await fetchBoard(b, { fetchText: n.fetchText, now: () => builtAt, robotsCache: new Map(), skipName: true, maxDetails: 0 });
      await writer.addBoard(b, r.company_name || b.token, r.jobs);
    }
    const manifest = await writer.finish();
    assert.deepEqual([manifest.ats_counts.jazzhr, manifest.ats_counts.pinpoint], [3, 3]);
    const out = sink();
    const s = net({ [JOB2]: () => ({ status: 410 }) });
    const summary = await runFeed(normalizeInput({ ats: ['jazzhr', 'pinpoint'] }), {
      ...out, indexBaseUrl: pathToFileURL(dir).href, now: () => NOW, hostGaps: {}, robotsCache: new Map(), fetchJson: s.fetchJson, fetchText: s.fetchText, streamShardLines,
    });
    assert.equal(summary.mode, 'search');
    const ids = out.rows.map((x) => x.job_id);
    assert.ok(!ids.includes('jazzhr:brennancenter:SuEESwkhOF') && !ids.includes('jazzhr:brennancenter:yXddZk0ojF'), 'closed (410 / 404): not delivered');
    assert.equal(summary.skipped_closed, 2);
    assert.equal(out.rows.length, 4);
    assert.equal(out.charges, 4);
    for (const x of out.rows) assertMatchesSchema(x);
    assert.ok(out.rows.every((x) => x.description_text));
    assert.ok(!s.calls.includes(apiUrlFor(JB)), 'JazzHR descriptions come from job pages, not a board re-read');
    assert.equal(summary.description_boards_fetched, 1, 'Pinpoint: one postings.json re-read');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('every jobs Actor accepts JazzHR and Pinpoint rows (dataset schema enums)', () => {
  const rows = [...parseBoard(JB, J.page).jobs, ...parseBoard(PB, JSON.stringify(P.json)).jobs]
    .map((j) => toOutput({ ...j, source_url: apiUrlFor({ ats: j.ats, token: j.company_board }), fetched_at: new Date(NOW).toISOString(), match_score: null, matched_in: null }, true));
  for (const slug of ['ats-jobs-feed', 'ats-jobs-scraper', 'remote-jobs-feed', 'companies-hiring', 'jobs-bulk-feed', 'greenhouse-jobs-api', 'lever-jobs-api',
    'ashby-jobs-api', 'workday-jobs-api']) {
    const f = new URL(`../../${slug}/.actor/actor.json`, import.meta.url);
    if (!existsSync(f)) continue;
    const props = JSON.parse(readFileSync(f, 'utf8')).storages.dataset.fields.properties;
    for (const ats of ['jazzhr', 'pinpoint']) assert.ok(props.ats.enum.includes(ats), `${slug}: dataset ats enum lacks ${ats}`);
  }
  for (const x of rows) assertMatchesSchema(x);
});
