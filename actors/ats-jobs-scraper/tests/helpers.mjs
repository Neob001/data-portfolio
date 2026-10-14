// Shared test helpers: fixtures, a fake ATS network, and the dataset-schema guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiUrlFor, boardUrlFor, workdayDetailUrl, personioEnglishUrl } from '../src/core/transform.js';
import { fetchBoard } from '../src/core/feed.js';
import { IndexWriter } from '../src/core/index_writer.js';

export const load = (f) => JSON.parse(readFileSync(new URL(`../golden/${f}`, import.meta.url), 'utf8'));

export const FIXTURES = {
  greenhouse: { token: 'gitlab', file: 'greenhouse_jobs.json' },
  lever: { token: 'shieldai', file: 'lever_postings.json' },
  ashby: { token: 'ramp', file: 'ashby_jobs.json' },
  workable: { token: 'blueground', file: 'workable_account.json' },
  recruitee: { token: 'channable', file: 'recruitee_offers.json' },
};
export const FIXTURE_BOARDS = Object.entries(FIXTURES).map(([ats, { token }]) => ({ ats, token }));

// Workday golden (kept out of FIXTURES so the five-ATS expectations above stay as they are): one real
// list page, the detail responses of its postings, the host's robots.txt and the site page's og:title.
export const WORKDAY_FIXTURE = { token: 'workday.wd5/Workday', file: 'workday_site.json' };
export const WORKDAY_BOARD = { ats: 'workday', token: WORKDAY_FIXTURE.token };
/** [url, () => response] routes of the Workday fixture: the jobs endpoint and every job detail. */
export function workdayRoutes() {
  const fx = load(WORKDAY_FIXTURE.file);
  const routes = [[apiUrlFor(WORKDAY_BOARD), () => fx.jobs]];
  for (const [path, d] of Object.entries(fx.details)) routes.push([workdayDetailUrl(WORKDAY_BOARD, `${boardUrlFor(WORKDAY_BOARD)}${path}`), () => d]);
  return routes;
}

// Career-site feed goldens (also outside FIXTURES): real Personio /xml (+ its ?language=en version) and
// Teamtailor /jobs.rss responses, trimmed, with the hosts' robots.txt (served as text/plain).
export const PERSONIO_FIXTURE = { token: '1komma5grad', file: 'personio_feed.json' };
export const TEAMTAILOR_FIXTURE = { token: 'career', file: 'teamtailor_jobs.json' };
export const PERSONIO_BOARD = { ats: 'personio', token: PERSONIO_FIXTURE.token };
export const TEAMTAILOR_BOARD = { ats: 'teamtailor', token: TEAMTAILOR_FIXTURE.token };
export const FEED_BOARDS = [PERSONIO_BOARD, TEAMTAILOR_BOARD];
const plain = (text) => ({ status: 200, text, contentType: 'text/plain; charset=utf-8' });
/** [url, () => text | { status, text, contentType }] routes of the feed goldens (fetchText). */
export function feedRoutes() {
  const p = load(PERSONIO_FIXTURE.file);
  const t = load(TEAMTAILOR_FIXTURE.file);
  return [
    [`https://${PERSONIO_FIXTURE.token}.jobs.personio.de/robots.txt`, () => plain(p.robots_txt)],
    [apiUrlFor(PERSONIO_BOARD), () => p.xml],
    [personioEnglishUrl(PERSONIO_BOARD), () => p.xml_en],
    [boardUrlFor(PERSONIO_BOARD), () => `<html><head>${p.page_title}</head><body></body></html>`],
    [`https://${TEAMTAILOR_FIXTURE.token}.teamtailor.com/robots.txt`, () => plain(t.robots_txt)],
    [apiUrlFor(TEAMTAILOR_BOARD), () => t.rss],
  ];
}

// Apify validates every pushed row against .actor/actor.json dataset fields (types AND enums); a
// violating row is rejected and the run crashes. Every row produced in tests goes through this.
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

/** fetchJson stand-in serving golden fixtures by ATS API URL; records calls. */
export function fakeNetwork(extra = {}) {
  const routes = new Map();
  for (const [ats, { token, file }] of Object.entries(FIXTURES)) routes.set(apiUrlFor({ ats, token }), () => load(file));
  for (const [url, fn] of workdayRoutes()) routes.set(url, fn);
  for (const [url, fn] of Object.entries(extra)) routes.set(url, fn);
  const calls = [];
  const fetchJson = async (url, opts = {}) => {
    calls.push(url);
    const route = routes.get(url);
    if (!route) throw Object.assign(new Error(`HTTP 404 at ${url}`), { status: 404, failureClass: 'http_error' });
    return structuredClone(route(opts));
  };
  const textRoutes = new Map(feedRoutes());
  // Extra routes for robots.txt and feed URLs are text (fetchText); the rest are JSON API routes (fetchJson).
  const isText = (url) => textRoutes.has(url) || /\/robots\.txt$|\.personio\.(?:de|com)\/xml(?:\?|$)|\/jobs\.rss(?:\?|$)/.test(url);
  for (const [url, fn] of Object.entries(extra)) if (isText(url)) textRoutes.set(url, fn);
  const fetchText = async (url, opts = {}) => {
    calls.push(url);
    if (textRoutes.has(url)) {
      const v = textRoutes.get(url)(opts);
      return typeof v === 'string' || opts.meta ? v : v.text;
    }
    if (/\.myworkdayjobs\.com\/robots\.txt$/.test(url)) return load(WORKDAY_FIXTURE.file).robots_txt;
    if (url === boardUrlFor(WORKDAY_BOARD)) return `<html><head>${load(WORKDAY_FIXTURE.file).site_page_head}</head></html>`;
    if (url.includes('lever.co/shieldai')) return '<html><head><title>Shield AI</title></head></html>';
    if (url.includes('ashbyhq.com/ramp')) return '<html><head><title>Ramp Jobs</title></head></html>';
    throw new Error('no page');
  };
  return { fetchJson, fetchText, calls };
}

/** pushData/charge recorder with the schema guard and an optional charge limit. */
export function sink({ chargeLimit = Infinity, event = 'job-result' } = {}) {
  const rows = [];
  let charges = 0;
  return {
    rows,
    get charges() { return charges; },
    pushData: async (row) => { assertMatchesSchema(row); rows.push(row); },
    charge: async ({ eventName }) => {
      assert.equal(eventName, event);
      charges += 1;
      return { eventChargeLimitReached: charges >= chargeLimit };
    },
  };
}

// Fixed clock: two days after the newest fixture posting.
export const NOW = Date.parse('2026-09-20T12:00:00Z');

/** Build a real index (same writer the builder uses) from the fixture boards into a temp dir. */
export async function buildIndex(dir, { extraJobs = [], builtAt = new Date(NOW - 86400000) } = {}) {
  const net = fakeNetwork();
  const writer = await new IndexWriter(dir, { builtAt }).open();
  for (const b of FIXTURE_BOARDS) {
    const r = await fetchBoard(b, { fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => builtAt });
    await writer.addBoard(b, r.company_name, r.jobs);
  }
  if (extraJobs.length) await writer.addBoard({ ats: extraJobs[0].ats, token: extraJobs[0].company_board }, extraJobs[0].company_name, extraJobs);
  return writer.finish();
}
