// Shared test helpers: fixtures, a fake ATS network, and the dataset-schema guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiUrlFor } from '../src/transform.js';

export const load = (f) => JSON.parse(readFileSync(new URL(`../golden/${f}`, import.meta.url), 'utf8'));

export const FIXTURES = {
  greenhouse: { token: 'gitlab', file: 'greenhouse_jobs.json' },
  lever: { token: 'shieldai', file: 'lever_postings.json' },
  ashby: { token: 'ramp', file: 'ashby_jobs.json' },
  workable: { token: 'blueground', file: 'workable_account.json' },
  recruitee: { token: 'channable', file: 'recruitee_offers.json' },
};
export const FIXTURE_BOARDS = Object.entries(FIXTURES).map(([ats, { token }]) => ({ ats, token }));

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
  for (const [url, fn] of Object.entries(extra)) routes.set(url, fn);
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    const route = routes.get(url);
    if (!route) throw Object.assign(new Error(`HTTP 404 at ${url}`), { status: 404, failureClass: 'http_error' });
    return structuredClone(route());
  };
  const fetchText = async (url) => {
    calls.push(url);
    if (url.includes('lever.co/shieldai')) return '<html><head><title>Shield AI</title></head></html>';
    if (url.includes('ashbyhq.com/ramp')) return '<html><head><title>Ramp Jobs</title></head></html>';
    throw new Error('no page');
  };
  return { fetchJson, fetchText, calls };
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

// Fixed clock: two days after the newest fixture posting.
export const NOW = Date.parse('2026-09-20T12:00:00Z');
