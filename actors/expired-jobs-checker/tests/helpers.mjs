// Test helpers: a real (tiny) jobs index built from trimmed real index records, and the dataset-schema guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IndexWriter } from '../src/core/index_writer.js';
import { defaultApplyUrl } from '../src/core/index_format.js';

// golden/index_sample.json: 64 records of 32 boards (4 per platform) from the published build 2026-11-02.
export const SAMPLE = JSON.parse(readFileSync(new URL('../golden/index_sample.json', import.meta.url), 'utf8'));
export const BUILT_AT = new Date(SAMPLE.built_at);
export const NOW = BUILT_AT.getTime() + 3600000;

/** Sample records grouped per board -> [{ board, name, jobs }] (jobs as the builder hands them to the writer). */
export function sampleBoards(records = SAMPLE.records) {
  const out = new Map();
  for (const r of records) {
    const bk = Object.keys(SAMPLE.boards).find((k) => k === `${r.ats}:${String(r.company_board).toLowerCase()}` || k === `${r.ats}:eu:${String(r.company_board).toLowerCase()}`);
    const h = SAMPLE.boards[bk] || { t: r.company_board, f: SAMPLE.built_at };
    if (!out.has(bk)) out.set(bk, { board: { ats: r.ats, token: h.t, ...(h.r ? { region: h.r } : {}) }, name: r.company_name, jobs: [] });
    const { kw, ...rest } = r;
    out.get(bk).jobs.push({ ...rest, apply_url: r.apply_url || defaultApplyUrl(r.ats, r.job_url), description_text: null, fetched_at: h.f });
  }
  return [...out.values()];
}

/** Build a real index (the builder's IndexWriter) into a fresh temp dir. extraBoards: [{ board, name, jobs }]. */
export async function buildSampleIndex({ records, extraBoards = [], builtAt = BUILT_AT } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'bulk-index-'));
  const w = await new IndexWriter(dir, { builtAt }).open();
  for (const b of [...sampleBoards(records), ...extraBoards]) await w.addBoard(b.board, b.name, b.jobs);
  const manifest = await w.finish();
  return { dir, manifest };
}

/** A synthetic job record of a board (all writer fields set). */
export function makeJob(board, i, over = {}) {
  const id = `${board.ats}:${String(board.token).toLowerCase()}:${over.id ?? `9${i}`}`;
  const jobUrl = `https://example-${board.ats}.test/${board.token}/jobs/${over.id ?? `9${i}`}`;
  return {
    job_id: id, title: over.title ?? `Synthetic Role ${i}`, company_name: over.company_name ?? `Company ${board.token}`, company_board: board.token, ats: board.ats,
    department: null, team: null, employment_type: 'full_time', workplace_type: 'onsite', locations: over.locations ?? [`City ${i}`], country_codes: over.country_codes ?? ['DE'],
    remote: false, salary_min: null, salary_max: null, salary_currency: null, salary_period: null,
    posted_at: over.posted_at ?? new Date(BUILT_AT.getTime() - 3600000).toISOString(), updated_at: null,
    apply_url: jobUrl, job_url: jobUrl, description_text: null, description_snippet: null, duplicate_sources: [], fetched_at: SAMPLE.built_at, ...over,
  };
}

// Apify validates every pushed row against .actor/actor.json dataset fields (types AND enums, null listed in the
// enum explicitly); a violating row crashes the run. Every row produced in tests goes through this.
const DATASET_FIELDS = JSON.parse(readFileSync(new URL('../.actor/actor.json', import.meta.url), 'utf8')).storages.dataset.fields.properties;
export function assertMatchesSchema(row, { partial = false } = {}) {
  for (const [key, value] of Object.entries(row)) {
    const spec = DATASET_FIELDS[key];
    assert.ok(spec, `field ${key} is not declared in .actor/actor.json`);
    const types = [].concat(spec.type);
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    assert.ok(types.includes(actual) || (actual === 'integer' && types.includes('number')), `field ${key}=${JSON.stringify(value)} is ${actual}, schema allows ${types}`);
    if (spec.enum) assert.ok(spec.enum.includes(value), `field ${key}=${value} not in enum ${spec.enum}`);
    if (actual === 'array' && spec.items?.type) for (const v of value) assert.equal(typeof v, spec.items.type, `${key}[] item ${v}`);
  }
  if (!partial) for (const key of Object.keys(DATASET_FIELDS)) assert.ok(key in row, `row misses declared field ${key}`);
}

/**
 * deliver/room recorder: schema guard on every row, `job-checked` charges counted (the caller says how many rows
 * of a batch are chargeable), optional charge limit.
 */
export function sink({ chargeLimit = Infinity } = {}) {
  const rows = [];
  const batches = [];
  let charges = 0;
  return {
    rows,
    batches,
    get charges() { return charges; },
    room: () => chargeLimit - charges,
    deliver: async (batch, chargeCount) => {
      for (const r of batch) assertMatchesSchema(r);
      assert.equal(chargeCount, batch.filter((r) => r.status !== 'unknown').length, 'open/closed rows are charged, unknown rows are free');
      batches.push(batch.length);
      rows.push(...batch);
      charges += chargeCount;
      return { eventChargeLimitReached: charges >= chargeLimit, chargedCount: chargeCount };
    },
  };
}
