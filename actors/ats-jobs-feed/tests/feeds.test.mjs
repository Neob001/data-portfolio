// Personio (/xml) and Teamtailor (/jobs.rss) career-site feeds: XML reader, board refs, parsers on real
// (trimmed) responses, robots.txt before any other request, live + search mode, enrichment, schema validity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseXml, child, childrenOf, textOf } from '../src/core/xml.js';
import {
  parseBoardRef, parseBoard, apiUrlFor, boardUrlFor, boardHost, robotsPathsFor, atsOfUrl, personioEmployment, ATS_LIST,
  personioEnglishUrl, teamtailorPageUrl, dedupeJobs,
} from '../src/core/transform.js';
import {
  fetchBoard, runFeed, toOutput, personioNameFromPage, boardRobots, EXTRA_FALLBACK_BOARDS, HOST_GAP_MS, TEAMTAILOR,
} from '../src/core/feed.js';
import { normalizeInput, compileFilter } from '../src/core/filters.js';
import { IndexWriter } from '../src/core/index_writer.js';
import { SENIORITY_LEVELS } from '../src/core/enrich.js';
import {
  load, fakeNetwork, sink, NOW, assertMatchesSchema, FIXTURE_BOARDS, PERSONIO_FIXTURE, TEAMTAILOR_FIXTURE, PERSONIO_BOARD,
  TEAMTAILOR_BOARD, FEED_BOARDS,
} from './helpers.mjs';

const P = load(PERSONIO_FIXTURE.file);
const T = load(TEAMTAILOR_FIXTURE.file);
const fresh = () => new Map();
const byId = (jobs, id) => jobs.find((j) => j.job_id.endsWith(`:${id}`));

test('xml: elements, attributes, CDATA, entities, namespaced names; broken XML is a schema change', () => {
  const root = parseXml('<?xml version="1.0"?>\n<!-- c --><rss a="1" b=\'x &amp; y\'><channel><title>A &amp; B &#252; &#x263A;</title>'
    + '<tt:loc><tt:city>Z&#252;rich</tt:city></tt:loc><e/><d><![CDATA[<p>x & <b>y</b></p>]]></d></channel></rss>');
  assert.equal(root.name, 'rss');
  assert.deepEqual(root.attrs, { a: '1', b: 'x & y' });
  const ch = child(root, 'channel');
  assert.equal(textOf(ch, 'title'), 'A & B ü ☺');
  assert.equal(textOf(child(ch, 'loc'), 'city'), 'Zürich', 'unprefixed names match prefixed elements');
  assert.equal(textOf(ch, 'tt:loc'), '');
  assert.equal(childrenOf(ch, 'e').length, 1);
  assert.equal(textOf(ch, 'd'), '<p>x & <b>y</b></p>');
  for (const bad of ['', '<a><b></a>', '<a>', '<a></a><b></b>', 'text', '<a>1 < 2</a>', '<html><body><p>Not found</body></html>']) {
    assert.throws(() => parseXml(bad), (e) => e.failureClass === 'schema_change', bad);
  }
});

test('board refs: Personio and Teamtailor URLs, explicit tokens, custom domains; hosts, feed and robots paths', () => {
  const cases = {
    'https://1komma5grad.jobs.personio.de/': { ats: 'personio', token: '1komma5grad' },
    'https://ACME.jobs.personio.com/job/123?language=en&display=de': { ats: 'personio', token: 'acme' },
    'acme.jobs.personio.de/xml': { ats: 'personio', token: 'acme' },
    'personio:Acme-GmbH': { ats: 'personio', token: 'acme-gmbh' },
    'https://career.teamtailor.com/jobs/8118064-uk-account-executive-smb': { ats: 'teamtailor', token: 'career' },
    'https://acme.na.teamtailor.com/jobs': { ats: 'teamtailor', token: 'acme.na' },
    'teamtailor:careers.acme.com': { ats: 'teamtailor', token: 'careers.acme.com' },
  };
  for (const [ref, want] of Object.entries(cases)) assert.deepEqual(parseBoardRef(ref), want, ref);
  for (const bad of ['https://www.personio.de/', 'https://www.teamtailor.com/en/', 'https://app.teamtailor.com/companies/x', 'https://jobs.personio.de/',
    'https://support.teamtailor.com/en/', 'https://careers.acme.com/jobs', 'https://acme.personio.de/']) {
    assert.equal(parseBoardRef(bad), null, bad);
  }
  assert.equal(apiUrlFor(PERSONIO_BOARD), 'https://1komma5grad.jobs.personio.de/xml');
  assert.equal(personioEnglishUrl(PERSONIO_BOARD), 'https://1komma5grad.jobs.personio.de/xml?language=en');
  assert.equal(boardUrlFor(PERSONIO_BOARD), 'https://1komma5grad.jobs.personio.de/');
  assert.equal(apiUrlFor({ ats: 'teamtailor', token: 'acme.na' }), 'https://acme.na.teamtailor.com/jobs.rss');
  assert.equal(apiUrlFor({ ats: 'teamtailor', token: 'careers.acme.com' }), 'https://careers.acme.com/jobs.rss');
  assert.equal(boardUrlFor(TEAMTAILOR_BOARD), 'https://career.teamtailor.com/jobs');
  assert.equal(boardHost({ ats: 'teamtailor', token: 'Careers.Acme.com' }), 'careers.acme.com');
  assert.deepEqual(robotsPathsFor(PERSONIO_BOARD), ['/xml', '/job/']);
  assert.deepEqual(robotsPathsFor(TEAMTAILOR_BOARD), ['/jobs.rss', '/jobs.rss?offset=100', '/jobs/']);
  assert.equal(teamtailorPageUrl(TEAMTAILOR_BOARD, 0), 'https://career.teamtailor.com/jobs.rss');
  assert.equal(teamtailorPageUrl(TEAMTAILOR_BOARD, 200), 'https://career.teamtailor.com/jobs.rss?offset=200');
  assert.equal(atsOfUrl('https://greenhouse.jobs.personio.de/xml'), 'personio', 'host decides, not a company called greenhouse');
  assert.equal(atsOfUrl('https://careers.acme.com/jobs.rss'), 'teamtailor');
  assert.equal(atsOfUrl('https://lever.teamtailor.com/robots.txt'), 'teamtailor');
  assert.ok(ATS_LIST.includes('personio') && ATS_LIST.includes('teamtailor') && !ATS_LIST.includes('bamboohr'));
  assert.ok(HOST_GAP_MS.personio >= 250 && HOST_GAP_MS.teamtailor >= 250);
});

test('personio: real feed -> flat records (subcompany, offices, structured salary, employment, hints, job URL)', () => {
  const { company_name, jobs } = parseBoard(PERSONIO_BOARD, P.xml);
  assert.equal(company_name, null, 'the feed has no board-level name');
  assert.equal(jobs.length, 6);
  const sal = byId(jobs, '2712319');
  assert.deepEqual([sal.job_id, sal.company_name, sal.department, sal.team], ['personio:1komma5grad:2712319', '1KOMMA5° Münster GmbH', 'Management', '1K5° Münster (Voltark)']);
  assert.deepEqual([sal.salary_min, sal.salary_max, sal.salary_currency, sal.salary_period], [36000, 50000, 'EUR', 'year']);
  assert.equal(sal.job_url, 'https://1komma5grad.jobs.personio.de/job/2712319');
  assert.equal(sal.apply_url, sal.job_url);
  assert.equal(sal.posted_at, '2026-07-14T17:08:03.000Z');
  assert.deepEqual([sal.seniority_hint, sal.years_experience_hint], ['entry', 1]);
  const multi = byId(jobs, '2800938');
  assert.deepEqual(multi.locations, ['Berlin', 'Berlin (Remote)'], 'office + additionalOffices');
  assert.deepEqual(multi.country_codes, ['DE']);
  assert.equal(multi.workplace_type, 'remote');
  assert.equal(byId(jobs, '2459891').employment_type, 'internship', 'working_student');
  assert.equal(byId(jobs, '2459891').seniority_hint, 'intern', 'student');
  assert.equal(byId(jobs, '2459891').years_experience_hint, 0, 'lt-1');
  assert.ok(!('seniority_hint' in byId(jobs, '2762189')), '"experienced" names no level');
  assert.equal(byId(jobs, '2762189').description_text, null, 'no text in the default language');
  assert.ok(jobs.filter((j) => j.description_text).every((j) => j.description_snippet && !/<|&[a-z]+;/.test(j.description_text)));
  assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(JSON.stringify(jobs)), 'no e-mail address in any record');
  // Employment mapping beyond the fixture.
  assert.deepEqual([['permanent', 'part-time'], ['permanent', 'full-or-part-time'], ['freelance', 'full-time'], ['trainee', 'full-time'],
    ['temporary', 'full-time'], ['intern', 'part-time'], ['', '']].map(([t, s]) => personioEmployment(t, s)),
  ['part_time', 'full_time', 'contract', 'internship', 'temporary', 'internship', null]);
  // Not a Personio feed -> schema change; a malformed position is skipped, not fatal.
  for (const bad of ['<html><body>Not found</body></html>', '<rss><channel/></rss>', '{"jobs":[]}', null]) {
    assert.throws(() => parseBoard(PERSONIO_BOARD, bad), (e) => e.failureClass === 'schema_change', String(bad));
  }
  const odd = P.xml.replace('<id>2712319</id>', '<id>not-a-number</id>');
  assert.equal(parseBoard(PERSONIO_BOARD, odd).jobs.length, 5);
});

test('teamtailor: real RSS -> records (channel name, city + country, remote status, department, role)', () => {
  const { company_name, jobs } = parseBoard(TEAMTAILOR_BOARD, T.rss);
  assert.equal(company_name, 'Teamtailor');
  assert.equal(jobs.length, 4);
  const apac = byId(jobs, '8144170');
  assert.equal(apac.job_url, 'https://career.teamtailor.com/jobs/8144170-partnership-account-executive-apac');
  assert.deepEqual(apac.locations, ['Sydney, Australia', 'Melbourne, Australia'], 'every location; no street address or zip');
  assert.deepEqual(apac.country_codes, ['AU']);
  assert.deepEqual([apac.department, apac.team, apac.workplace_type, apac.remote], ['Partnerships', 'Partnerships Manager', 'onsite', false]);
  const uk = byId(jobs, '8118064');
  assert.deepEqual([uk.workplace_type, uk.country_codes, uk.posted_at], ['hybrid', ['GB'], '2026-07-24T07:05:16.000Z']);
  assert.ok(uk.description_text.startsWith("Let's build the future together!"), 'HTML description decoded and cleaned');
  assert.ok(!JSON.stringify(jobs).includes('Laystall Court'), 'office street address is not copied');
  // remoteStatus "fully" = remote; an unknown/"temporary" value falls back to the location text.
  const fully = parseBoard(TEAMTAILOR_BOARD, T.rss.replace('<remoteStatus>none</remoteStatus>', '<remoteStatus>fully</remoteStatus>')).jobs;
  assert.ok(fully.some((j) => j.workplace_type === 'remote' && j.remote === true));
  const temp = parseBoard(TEAMTAILOR_BOARD, T.rss.replace(/<remoteStatus>[a-z]+<\/remoteStatus>/g, '<remoteStatus>temporary</remoteStatus>')).jobs;
  assert.ok(temp.every((j) => j.workplace_type === 'unknown'));
  assert.throws(() => parseBoard(TEAMTAILOR_BOARD, '<workzag-jobs/>'), /Unexpected teamtailor response/);
});

test('robots.txt first: allowed -> feed read; disallowed / 4xx / HTML / non-text/plain -> no other request to the host', async () => {
  const net = fakeNetwork();
  const r = await fetchBoard(TEAMTAILOR_BOARD, { fetchText: net.fetchText, robotsCache: fresh(), now: () => new Date(NOW) });
  assert.deepEqual(net.calls, ['https://career.teamtailor.com/robots.txt', 'https://career.teamtailor.com/jobs.rss'], 'robots.txt is the first request');
  assert.equal(r.jobs.length, 4);
  assert.equal(r.requests, 1);
  const robotsUrl = `https://${PERSONIO_FIXTURE.token}.jobs.personio.de/robots.txt`;
  const blocked = [
    { status: 200, text: 'User-agent: *\nDisallow: /xml', contentType: 'text/plain' },
    { status: 200, text: 'User-agent: *\nDisallow: /job/', contentType: 'text/plain' },
    { status: 200, text: 'User-agent: factpipe-jobs-feed\nDisallow: /', contentType: 'text/plain' },
    { status: 200, text: 'User-agent: *\nAllow: /', contentType: 'text/html; charset=utf-8' },
    { status: 200, text: '<!DOCTYPE html><html><body>robots</body></html>', contentType: 'text/plain' },
    () => { throw Object.assign(new Error('HTTP 404'), { status: 404 }); },
    () => { throw Object.assign(new Error('HTTP 503'), { status: 503 }); },
    () => { throw new Error('ECONNRESET'); },
  ];
  for (const robots of blocked) {
    const n = fakeNetwork({ [robotsUrl]: typeof robots === 'function' ? robots : () => robots });
    await assert.rejects(fetchBoard(PERSONIO_BOARD, { fetchText: n.fetchText, robotsCache: fresh() }),
      (e) => e.failureClass === 'blocked' && e.robots === true, JSON.stringify(robots));
    assert.deepEqual(n.calls, [robotsUrl], `only robots.txt was requested (${JSON.stringify(robots)})`);
  }
  // One robots.txt per host per run (cache), asked for as text/plain.
  const seen = [];
  const cache = fresh();
  const ft = async (url, opts) => { seen.push([url, opts.accept]); return { status: 200, text: 'User-agent: *\nAllow: /', contentType: 'text/plain' }; };
  for (let i = 0; i < 3; i += 1) assert.equal((await boardRobots(TEAMTAILOR_BOARD, { fetchText: ft, cache })).allowed, true);
  assert.deepEqual(seen, [['https://career.teamtailor.com/robots.txt', 'text/plain']]);
});

// A Teamtailor site with `total` jobs served as the real feed does: 100 items per page, next page at ?offset=N.
function bigTeamtailor(total, { ignoreOffset = false } = {}) {
  const item = T.rss.match(/<item>[\s\S]*?<\/item>/)[0];
  const head = T.rss.slice(0, T.rss.indexOf('<item>'));
  const tail = T.rss.slice(T.rss.lastIndexOf('</item>') + '</item>'.length);
  const page = (offset) => {
    const n = Math.max(0, Math.min(TEAMTAILOR.pageSize, total - offset));
    const items = Array.from({ length: n }, (_, i) => item.replace(/\/jobs\/\d+-/, `/jobs/${9000000 + offset + i}-`)
      .replace(/<title>[^<]*<\/title>/, `<title>Engineer ${offset + i}</title>`));
    return `${head}${items.join('\n')}${tail}`;
  };
  const routes = { [apiUrlFor(TEAMTAILOR_BOARD)]: () => page(0) };
  for (let o = 100; o < total + 300; o += 100) routes[teamtailorPageUrl(TEAMTAILOR_BOARD, o)] = () => page(ignoreOffset ? 0 : o);
  return fakeNetwork(routes);
}

test('teamtailor paging: ?offset=100, 200... until a short page; cap; an ignored offset ends the paging', async () => {
  const net = bigTeamtailor(250);
  const r = await fetchBoard(TEAMTAILOR_BOARD, { fetchText: net.fetchText, robotsCache: fresh(), now: () => new Date(NOW) });
  assert.equal(r.jobs.length, 250);
  assert.equal(new Set(r.jobs.map((j) => j.job_id)).size, 250);
  assert.deepEqual([r.requests, r.truncated], [3, false]);
  assert.deepEqual(net.calls.filter((u) => u.includes('jobs.rss')).map((u) => u.split('/').pop()), ['jobs.rss', 'jobs.rss?offset=100', 'jobs.rss?offset=200']);
  const exact = bigTeamtailor(200);
  const e = await fetchBoard(TEAMTAILOR_BOARD, { fetchText: exact.fetchText, robotsCache: fresh() });
  assert.deepEqual([e.jobs.length, e.requests], [200, 3], 'an empty page ends a site of exactly 200');
  const capped = bigTeamtailor(900);
  const c = await fetchBoard(TEAMTAILOR_BOARD, { fetchText: capped.fetchText, robotsCache: fresh(), maxJobs: 300 });
  assert.deepEqual([c.jobs.length, c.truncated, c.requests], [300, true, 3]);
  const late = bigTeamtailor(900);
  const d = await fetchBoard(TEAMTAILOR_BOARD, { fetchText: late.fetchText, robotsCache: fresh(), deadline: { hasTimeFor: () => false } });
  assert.deepEqual([d.jobs.length, d.truncated, d.requests], [100, true, 1]);
  const loop = bigTeamtailor(900, { ignoreOffset: true });
  const l = await fetchBoard(TEAMTAILOR_BOARD, { fetchText: loop.fetchText, robotsCache: fresh() });
  assert.deepEqual([l.jobs.length, l.requests], [100, 2], 'a server that ignores offset costs one extra request, no loop');
});

test('personio fetch: English feed only for positions without default-language text; name from the career page', async () => {
  const net = fakeNetwork();
  const r = await fetchBoard(PERSONIO_BOARD, { fetchText: net.fetchText, robotsCache: fresh(), now: () => new Date(NOW) });
  assert.deepEqual(net.calls, [`https://${PERSONIO_FIXTURE.token}.jobs.personio.de/robots.txt`, apiUrlFor(PERSONIO_BOARD),
    personioEnglishUrl(PERSONIO_BOARD), boardUrlFor(PERSONIO_BOARD)]);
  assert.equal(r.requests, 2);
  assert.equal(r.company_name, '1KOMMA5°');
  const filled = byId(r.jobs, '2762189');
  assert.ok(filled.description_text && filled.description_snippet, 'filled from ?language=en');
  assert.equal(filled.title, '(Senior) Category Manager IT & Software', 'title stays in the default language');
  assert.ok(byId(r.jobs, '2712319').description_text.startsWith('1KOMMA5°'), 'default-language texts are kept');
  assert.ok(r.jobs.every((j) => j.company_name.startsWith('1KOMMA5°')), 'subcompany per position');
  assert.ok(r.jobs.every((j) => j.source_url === apiUrlFor(PERSONIO_BOARD) && j.fetched_at === new Date(NOW).toISOString()));
  // Every position has a default-language text -> one feed request; skipName -> no page request.
  const n2 = fakeNetwork({ [apiUrlFor(PERSONIO_BOARD)]: () => P.xml.replace('<jobDescriptions></jobDescriptions>', '<jobDescriptions><jobDescription><name>Job</name><value><![CDATA[<p>Text</p>]]></value></jobDescription></jobDescriptions>') });
  const r2 = await fetchBoard(PERSONIO_BOARD, { fetchText: n2.fetchText, robotsCache: fresh(), skipName: true });
  assert.equal(r2.requests, 1);
  assert.deepEqual(n2.calls, [`https://${PERSONIO_FIXTURE.token}.jobs.personio.de/robots.txt`, apiUrlFor(PERSONIO_BOARD)]);
  // Career page titles.
  assert.equal(personioNameFromPage(P.page_title), '1KOMMA5°');
  for (const [t, want] of [['Jobs at Acme GmbH', 'Acme GmbH'], ['Karriere bei Müller &amp; Söhne', 'Müller & Söhne'], ["Offres d'emploi chez Lumen", 'Lumen'],
    ['Vacatures bij Blauw', 'Blauw'], ['Personio', null], ['Jobs bei uns', null], ['', null]]) {
    assert.equal(personioNameFromPage(`<title>${t}</title>`), want, t);
  }
});

async function live(input, extra = {}) {
  const net = fakeNetwork(extra);
  const out = sink();
  const summary = await runFeed(normalizeInput(input), {
    ...out, fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW, hostGaps: {}, robotsCache: fresh(),
  });
  return { summary, rows: out.rows, charges: out.charges, calls: net.calls };
}

test('live mode: Personio + Teamtailor boards -> schema-valid enriched rows, one charge each', async () => {
  const r = await live({ companyUrls: ['https://1komma5grad.jobs.personio.de/', 'https://career.teamtailor.com/jobs'] });
  assert.equal(r.summary.boards_ok, 2);
  assert.equal(r.rows.length, 10);
  assert.equal(r.charges, 10);
  for (const x of r.rows) assertMatchesSchema(x);
  assert.ok(r.rows.every((x) => x.description_status === 'included'));
  const sal = r.rows.find((x) => x.job_id === 'personio:1komma5grad:2712319');
  assert.deepEqual([sal.salary_source, sal.seniority, sal.years_experience_min], ['structured', 'entry', 1], 'structured salary; level + years from Personio');
  const ws = r.rows.find((x) => x.job_id === 'personio:1komma5grad:2795601');
  assert.equal(ws.seniority, 'intern', 'title rules ("Working Student")');
  const tt = r.rows.filter((x) => x.ats === 'teamtailor');
  assert.ok(tt.every((x) => x.company_name === 'Teamtailor' && SENIORITY_LEVELS.concat([null]).includes(x.seniority)));
  assert.equal(tt.find((x) => x.title === 'Regional Director CSM').seniority, 'director');
});

test('enrichment on feed rows: years from Personio without a description; seniority filter sees the Personio level', async () => {
  const r = await live({ companyUrls: ['personio:1komma5grad'], includeDescription: false });
  assert.equal(r.rows.length, 6);
  for (const x of r.rows) assertMatchesSchema(x);
  const sal = r.rows.find((x) => x.job_id.endsWith(':2712319'));
  assert.deepEqual([sal.description_status, sal.years_experience_min, sal.seniority, sal.visa_sponsorship], ['not_requested', 1, 'entry', null]);
  const entry = await live({ companyUrls: ['personio:1komma5grad'], seniority: ['entry'] });
  assert.deepEqual(entry.rows.map((x) => x.job_id), ['personio:1komma5grad:2712319'], 'title has no marker, Personio says entry-level');
  // Same rule in the index filter (records carry seniority_hint).
  const job = parseBoard(PERSONIO_BOARD, P.xml).jobs.find((j) => j.job_id.endsWith(':2712319'));
  assert.equal(compileFilter(normalizeInput({ seniority: ['entry'] }))(job), true);
  assert.equal(compileFilter(normalizeInput({ seniority: ['senior'] }))(job), false);
  const row = toOutput({ ...job, years_experience_hint: undefined, seniority_hint: undefined }, true);
  assert.equal(row.seniority, null);
});

test('live mode: a robots-disallowed feed host is reported (failed_boards.robots) and nothing else is requested from it', async () => {
  const robotsUrl = 'https://career.teamtailor.com/robots.txt';
  const r = await live({ companyUrls: ['teamtailor:career'] }, { [robotsUrl]: () => ({ status: 200, text: 'User-agent: *\nDisallow: /jobs', contentType: 'text/plain' }) });
  assert.equal(r.rows.length, 0);
  assert.equal(r.charges, 0);
  assert.deepEqual(r.summary.failed_boards, [{ board: 'teamtailor:career', status: null, failure_class: 'blocked', robots: true }]);
  assert.deepEqual(r.calls, [robotsUrl]);
});

test('index + search mode: feed jobs in their own shards (slim records keep the Personio hints); delivery re-reads the feed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'feeds-index-'));
  try {
    const builtAt = new Date(NOW - 86400000);
    const net = fakeNetwork();
    const writer = await new IndexWriter(dir, { builtAt }).open();
    for (const b of [...FIXTURE_BOARDS, ...FEED_BOARDS]) {
      const r = await fetchBoard(b, { fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => builtAt, robotsCache: fresh(), skipName: true });
      await writer.addBoard(b, r.company_name || b.token, r.jobs);
    }
    const manifest = await writer.finish();
    assert.equal(manifest.ats_counts.personio, 6);
    assert.equal(manifest.ats_counts.teamtailor, 4);
    assert.ok(manifest.shards.some((s) => s.ats === 'personio') && manifest.shards.some((s) => s.ats === 'teamtailor'));

    const out = sink();
    const s = fakeNetwork();
    const read = [];
    const { streamShardLines } = await import('../src/core/feed.js');
    const summary = await runFeed(normalizeInput({ ats: ['personio', 'teamtailor'], seniority: ['entry', 'director'] }), {
      ...out, indexBaseUrl: pathToFileURL(dir).href, now: () => NOW, hostGaps: {}, robotsCache: fresh(),
      fetchJson: s.fetchJson, fetchText: s.fetchText,
      streamShardLines: (base, rel) => { read.push(rel); return streamShardLines(base, rel); },
    });
    assert.equal(summary.mode, 'search');
    assert.ok(read.every((f) => /\/(personio|teamtailor)-/.test(f)), read.join(','));
    assert.deepEqual(out.rows.map((x) => x.job_id).sort(), ['personio:1komma5grad:2712319', 'teamtailor:career:8124466', 'teamtailor:career:8297677']);
    for (const x of out.rows) assertMatchesSchema(x);
    assert.ok(out.rows.every((x) => x.description_status === 'included' && x.description_text));
    assert.equal(out.rows.find((x) => x.ats === 'personio').years_experience_min, 1);
    assert.equal(summary.description_boards_fetched, 2, 'one live feed read per board');
    assert.ok(s.calls[0].endsWith('/robots.txt') || s.calls.filter((u) => u.endsWith('/robots.txt')).length === 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('teamtailor dedupe: a group site listing a sister site\'s job (same global id + link) is one opening', () => {
  const group = parseBoard({ ats: 'teamtailor', token: 'acmegroup' }, T.rss.replace('<title>Teamtailor</title>', '<title>Acme Group</title>')).jobs;
  const sister = parseBoard(TEAMTAILOR_BOARD, T.rss).jobs;
  const merged = dedupeJobs([...group, ...sister]);
  assert.equal(merged.length, sister.length);
  assert.ok(merged.every((j) => j.duplicate_sources.length === 1));
  // Two different openings with the same title and place on one site stay two.
  const twin = T.rss.replace(/(<item>[\s\S]*?<\/item>)/, (m) => `${m}\n${m.replace(/\/jobs\/(\d+)-/, '/jobs/99$1-')}`);
  assert.equal(dedupeJobs(parseBoard(TEAMTAILOR_BOARD, twin).jobs).length, sister.length + 1);
});

test('fallback boards exist for the new platforms (platform not yet in the index)', () => {
  for (const ats of ['personio', 'teamtailor']) {
    assert.ok(EXTRA_FALLBACK_BOARDS[ats]?.length >= 2, ats);
    for (const b of EXTRA_FALLBACK_BOARDS[ats]) assert.deepEqual(parseBoardRef(`${b.ats}:${b.token}`), b);
  }
});
