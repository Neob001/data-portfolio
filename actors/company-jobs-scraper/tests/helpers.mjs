// Shared test helpers: golden pages (real careers pages, trimmed) and job-board responses (real, trimmed),
// a fake web (company pages + robots.txt + ATS APIs/feeds) and the dataset-schema guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { atsOfUrl } from '../src/core/transform.js';

const read = (p) => readFileSync(new URL(`../golden/${p}`, import.meta.url), 'utf8');
export const loadJobs = (f) => JSON.parse(read(`jobs/${f}`));
export const ROBOTS_ANSWERS = JSON.parse(read('pages/robots_answers.json'));

/** Golden page -> { url (where it was captured), html }. */
export function page(file) {
  const html = read(`pages/${file}`);
  return { url: html.match(/golden: (\S+)/)[1], html };
}

export const PLAIN = (text) => ({ status: 200, text, contentType: 'text/plain; charset=utf-8' });
export const HTML = (text) => ({ status: 200, text, contentType: 'text/html; charset=utf-8' });
export const REDIRECT = (location, status = 301) => ({ status, location, contentType: 'text/html', text: '' });
const ALLOW_ALL = PLAIN('User-agent: *\nDisallow: /private/\n');

// Job-board answers by platform (any token): the real goldens of the jobs core.
const WD = loadJobs('workday_site.json');
const PERSONIO = loadJobs('personio_feed.json');
const TEAMTAILOR = loadJobs('teamtailor_jobs.json');
const JSON_BY_ATS = {
  greenhouse: () => loadJobs('greenhouse_jobs.json'),
  lever: () => loadJobs('lever_postings.json'),
  ashby: () => loadJobs('ashby_jobs.json'),
  workable: () => loadJobs('workable_account.json'),
  recruitee: () => loadJobs('recruitee_offers.json'),
};

/**
 * Fake web. pages: { url: answer } for company pages (answer = HTML(...) / REDIRECT(...) / { status } / Error);
 * robots: { host: answer } (default: a text/plain file allowing everything but /private/); missingBoards: API
 * URL substrings answered 404. Records every request in `calls` (method + URL).
 */
export function fakeWeb({ pages = {}, robots = {}, missingBoards = [] } = {}) {
  const calls = [];
  const fetchPage = async (url) => {
    calls.push(`PAGE ${url}`);
    const a = pages[url];
    if (a === undefined) return { status: 404, text: '<html>not found</html>', contentType: 'text/html' };
    if (a instanceof Error) throw a;
    return a;
  };
  const robotsOf = (host) => {
    const a = robots[host];
    if (a === undefined) {
      if (/\.myworkdayjobs\.com$/.test(host)) return PLAIN(WD.robots_txt);
      if (/\.jobs\.personio\.(de|com)$/.test(host)) return PLAIN(PERSONIO.robots_txt);
      if (/teamtailor\.com$|^career\.qliro\.com$/.test(host)) return PLAIN(TEAMTAILOR.robots_txt);
      return ALLOW_ALL;
    }
    return a;
  };
  const fetchText = async (url, opts = {}) => {
    calls.push(`TEXT ${url}`);
    const u = new URL(url);
    let a;
    if (u.pathname === '/robots.txt') {
      assert.equal(opts.accept, 'text/plain', 'robots.txt is always asked for as text/plain');
      a = robotsOf(u.hostname);
    } else if (missingBoards.some((m) => url.includes(m))) a = { status: 404 };
    else if (/\.jobs\.personio\.(de|com)\/xml/.test(url)) a = { status: 200, text: url.includes('language=en') ? PERSONIO.xml_en : PERSONIO.xml };
    else if (/\/jobs\.rss/.test(url)) a = { status: 200, text: TEAMTAILOR.rss };
    else if (/\.myworkdayjobs\.com\//.test(url)) a = { status: 200, text: `<html><head>${WD.site_page_head}</head></html>` };
    else if (/jobs\.personio\./.test(url)) a = { status: 200, text: `<html><head>${PERSONIO.page_title}</head></html>` };
    else if (/lever\.co|ashbyhq\.com/.test(url)) a = { status: 200, text: '<html><head><title>Acme Jobs</title></head></html>' };
    else a = { status: 404 };
    if (a instanceof Error) throw a;
    if (a.status >= 400) throw Object.assign(new Error(`HTTP ${a.status} at ${url}`), { status: a.status, failureClass: 'http_error' });
    return opts.meta ? { status: a.status, text: a.text ?? '', contentType: a.contentType ?? 'text/plain' } : a.text;
  };
  const fetchJson = async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url}`);
    if (missingBoards.some((m) => url.includes(m))) throw Object.assign(new Error(`HTTP 404 at ${url}`), { status: 404, failureClass: 'http_error' });
    const ats = atsOfUrl(url);
    if (ats === 'workday') {
      if (url.endsWith('/jobs')) return structuredClone(WD.jobs);
      const path = Object.keys(WD.details).find((p) => url.endsWith(p.replace(/^\/job/, '/job')) || url.includes(p));
      if (path) return structuredClone(WD.details[path]);
      throw Object.assign(new Error(`HTTP 404 at ${url}`), { status: 404, failureClass: 'http_error' });
    }
    return structuredClone(JSON_BY_ATS[ats]());
  };
  return { fetchPage, fetchText, fetchJson, calls, pagesFor: (host) => calls.filter((c) => c.startsWith('PAGE ') && new URL(c.slice(5)).hostname === host) };
}

// Apify validates every pushed row against .actor/actor.json dataset fields (types AND enums); a violating
// row is rejected and the run crashes. Every row produced in tests goes through this.
const DATASET_FIELDS = JSON.parse(readFileSync(new URL('../.actor/actor.json', import.meta.url), 'utf8')).storages.dataset.fields.properties;
export function assertMatchesSchema(row) {
  for (const [key, value] of Object.entries(row)) {
    const spec = DATASET_FIELDS[key];
    assert.ok(spec, `field ${key} is not declared in .actor/actor.json`);
    const types = [].concat(spec.type);
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const ok = types.includes(actual) || (actual === 'integer' && types.includes('number'));
    assert.ok(ok, `field ${key}=${JSON.stringify(value)} is ${actual}, schema allows ${types}`);
    // Apify validates enums like JSON Schema: null must itself be listed in the enum.
    if (spec.enum) assert.ok(spec.enum.includes(value), `field ${key}=${value} not in enum ${spec.enum}`);
    if (actual === 'array' && spec.items?.type) for (const v of value) assert.equal(typeof v, spec.items.type, `${key}[] item ${v}`);
  }
  for (const key of Object.keys(DATASET_FIELDS)) assert.ok(key in row, `row misses declared field ${key}`);
}

/** pushData/charge recorder with the schema guard and an optional charge limit. */
export function sink({ chargeLimit = Infinity } = {}) {
  const rows = [];
  let charges = 0;
  return {
    rows,
    get charges() { return charges; },
    pushData: async (row) => { assertMatchesSchema(row); rows.push(row); },
    charge: async ({ eventName }) => {
      assert.equal(eventName, 'job-result');
      charges += 1;
      return { eventChargeLimitReached: charges >= chargeLimit };
    },
  };
}

export const NOW = Date.parse('2026-10-22T12:00:00Z');
/** deps for runCompanies: fake web + sink, no pacing delays. */
export function deps(web, out, extra = {}) {
  return { ...out, fetchPage: web.fetchPage, fetchText: web.fetchText, fetchJson: web.fetchJson, pace: async () => {}, atsPacer: async () => {}, now: () => NOW, ...extra };
}
