// Shared test helpers: golden fixtures, fake network, and the dataset-schema guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stamp } from '../src/lib/records.js';

export const load = (f) => JSON.parse(readFileSync(new URL(`../golden/${f}`, import.meta.url), 'utf8'));

export const FIXTURES = ['shopify_store.json', 'wordpress_site.json', 'nextjs_vercel.json'];

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

/** A stamped row as main.js pushes it. */
export const stamped = (row) => stamp(row, row.final_url || row.url);

/** fetchPage stand-in serving golden fixtures by URL (Headers object like undici's). */
export function fakeFetch(routes = {}) {
  const calls = [];
  const fixtures = Object.fromEntries(FIXTURES.map((f) => { const d = load(f); return [d.url, d]; }));
  const fetchPage = async (url, opts = {}) => {
    calls.push({ url, timeoutMs: opts.timeoutMs });
    const route = routes[url];
    if (typeof route === 'function') return route(url, calls.filter((c) => c.url === url).length);
    if (route) return route;
    const fx = fixtures[url];
    if (!fx) throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${new URL(url).hostname}`), { code: 'ENOTFOUND' }) });
    return { finalUrl: fx.url, status: fx.status, headers: new Headers(fx.headers), setCookies: fx.setCookies, html: fx.html, truncated: false };
  };
  return { fetchPage, calls };
}

/** lookupDns stand-in: fixture DNS by registrable domain; unknown domains are NXDOMAIN. */
export function fakeDns(extra = {}) {
  const byDomain = {};
  for (const f of FIXTURES) {
    const d = load(f);
    const host = new URL(d.url).hostname.replace(/^www\./, '');
    byDomain[host] = d.dns;
  }
  Object.assign(byDomain, extra);
  const nx = { error: 'ENOTFOUND' };
  return async ({ domain }) => byDomain[domain] ?? { mx: nx, txt: nx, ns: nx, soa: nx, dmarcTxt: nx, cname: nx };
}

export const page = ({ url = 'https://example.com/', status = 200, headers = {}, setCookies = [], html = '' } = {}) => (
  { finalUrl: url, status, headers: new Headers(headers), setCookies, html, truncated: false });

export const netError = (code, name = 'Error') => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code, name }) });
