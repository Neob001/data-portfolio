// Whole-index delivery: stream every shard of the published jobs index that can match the filters and push
// the matching jobs in batches. Reads only the index (GitHub release assets): no live board requests, no
// descriptions, no ranking. Pure orchestration with injected I/O so tests drive it without Apify.
import { createBrotliDecompress, createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { openIndex, readIndexFile, expandIndexRecord, toOutput, OUTPUT_FIELDS } from './core/feed.js';
import { compileSearch } from './core/filters.js';
import { selectShards } from './core/index_format.js';
import { ATS_LIST } from './core/transform.js';
import { SENIORITY_LEVELS } from './core/enrich.js';
import { isCountryCode } from './core/geo.js';
import { createDeadline } from './lib/deadline.js';
import { idHash } from './seen.js';

export { OUTPUT_FIELDS };
export const EVENT = 'job-result';
export const BATCH_SIZE = 1000;
export const MAX_RESULTS_DEFAULT = 100000;
export const MAX_RESULTS_LIMIT = 2000000;
// Do not start another batch with less than this left before the run's timeout (state save + summary).
export const BATCH_RESERVE_MS = 45000;

const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : [])
  .map((x) => String(x ?? '').trim())
  .filter(Boolean);

/** Raw Actor input -> validated options. Throws a readable Error on bad input. */
export function normalizeBulkInput(input = {}) {
  const ats = [...new Set(strList(input.ats).map((a) => a.toLowerCase()))];
  for (const a of ats) if (!ATS_LIST.includes(a)) throw new Error(`Unknown ATS "${a}". Supported: ${ATS_LIST.join(', ')}`);
  const countries = [...new Set(strList(input.countries).map((c) => c.toUpperCase().replace(/^UK$/, 'GB')))];
  for (const c of countries) if (!isCountryCode(c)) throw new Error(`"${c}" is not an ISO 3166-1 alpha-2 country code (e.g. US, DE, GB)`);
  const remote = input.remote ?? 'any';
  if (!['any', 'remote_only', 'onsite_only'].includes(remote)) throw new Error(`"remote" must be any, remote_only or onsite_only (got ${remote})`);
  const seniority = [...new Set(strList(input.seniority).map((s) => s.toLowerCase()))];
  for (const s of seniority) if (!SENIORITY_LEVELS.includes(s)) throw new Error(`Unknown seniority "${s}". Use: ${SENIORITY_LEVELS.join(', ')}`);
  const postedWithinDays = input.postedWithinDays === undefined || input.postedWithinDays === null || input.postedWithinDays === ''
    ? null : Number(input.postedWithinDays);
  if (postedWithinDays !== null && (!Number.isFinite(postedWithinDays) || postedWithinDays <= 0)) throw new Error('"postedWithinDays" must be a positive number');
  const maxResults = input.maxResults === undefined || input.maxResults === null || input.maxResults === '' ? MAX_RESULTS_DEFAULT : Number(input.maxResults);
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > MAX_RESULTS_LIMIT) throw new Error(`"maxResults" must be an integer from 1 to ${MAX_RESULTS_LIMIT}`);
  const fields = [...new Set(strList(input.fields))];
  for (const f of fields) if (!OUTPUT_FIELDS.includes(f)) throw new Error(`Unknown output field "${f}". Use any of: ${OUTPUT_FIELDS.join(', ')}`);
  return {
    ats,
    countries,
    remote,
    seniority,
    postedWithinDays,
    sinceLastRun: input.sinceLastRun === undefined ? true : Boolean(input.sinceLastRun),
    maxResults,
    fields: fields.length ? fields : null,
  };
}

/** Filter subset that defines one incremental feed (the state key). maxResults and fields are not part of it. */
export function bulkFilterIdentity(opts) {
  return {
    feed: 'bulk',
    ats: [...opts.ats].sort(),
    countries: [...opts.countries].sort(),
    remote: opts.remote,
    seniority: [...opts.seniority].sort(),
    postedWithinDays: opts.postedWithinDays,
  };
}

/** normalizeBulkInput() result -> the core's compileSearch() options (no keywords, no ranking). */
export function searchOptions(opts) {
  return {
    keywords: [], keywordMatch: 'any', keywordScope: 'title', excludeKeywords: [], locations: [], countryCodes: opts.countries,
    remote: opts.remote, companies: [], ats: opts.ats, departments: [], employmentTypes: [], seniority: opts.seniority,
    postedWithinDays: opts.postedWithinDays,
  };
}

/** Output row (ats-jobs-feed schema, no description) reduced to `fields` (in schema order) when given. */
export function bulkRow(job, fields = null) {
  const row = toOutput(job, false);
  if (!fields) return row;
  const out = {};
  for (const f of OUTPUT_FIELDS) if (fields.includes(f)) out[f] = row[f];
  return out;
}

/** Async iterator over the JSON lines of one downloaded (compressed) shard, decompressed as a stream. */
export async function* shardLines(buf, file) {
  const unzip = file.endsWith('.br') ? createBrotliDecompress() : createGunzip();
  unzip.setEncoding('utf8');
  Readable.from([buf]).pipe(unzip);
  let rest = '';
  for await (const chunk of unzip) {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop();
    for (const line of parts) if (line) yield line;
  }
  if (rest) yield rest;
}

/**
 * @param opts normalizeBulkInput() result
 * @param deps {
 *   indexBaseUrl?, readIndexFile?,                 index access (core openIndex / readIndexFile)
 *   room(): number,                                jobs still chargeable within the user's max charge (Infinity = no limit)
 *   deliver(rows): Promise,                        push one batch to the dataset and charge one `job-result` per row
 *   seen?: SeenSet,                                incremental state (sinceLastRun), or null
 *   deadline?, log?, now?, batchSize? }
 */
export async function runBulk(opts, deps) {
  const log = deps.log || (() => {});
  const nowMs = deps.now ? deps.now() : Date.now();
  const deadline = deps.deadline || createDeadline();
  const batchSize = deps.batchSize || BATCH_SIZE;
  const seen = deps.seen || null;
  const readShard = deps.readIndexFile || readIndexFile;
  const search = compileSearch(searchOptions(opts));
  const summary = {
    rows: 0, charged_events: 0, matched: 0, skipped_seen: 0, repeated_in_index: 0, stop_reason: 'exhausted', complete: false,
    shards_total: 0, shards_read: 0, shards_failed: 0, batches: 0, index_built_at: null, index_jobs: null,
    seen_before: seen ? seen.size : null, read_ms: 0, deliver_ms: 0,
  };

  const index = await openIndex(deps);
  const { manifest } = index;
  summary.index_built_at = manifest.built_at;
  summary.index_jobs = manifest.jobs;
  const order = selectShards(manifest, { ats: opts.ats, postedWithinDays: opts.postedWithinDays }, { now: nowMs });
  summary.shards_total = order.length;

  const inRun = new Set(); // job_id hashes matched so far in this run (~50 MB at 900k jobs)
  let stopped = false;
  let batch = [];
  let ids = [];
  let pending = null; // the batch being pushed while the next one is parsed

  const stop = (reason) => { if (!stopped) { stopped = true; summary.stop_reason = reason; } };

  async function settle() {
    if (!pending) return;
    const p = pending;
    pending = null;
    await p;
  }

  let queued = 0; // rows handed to deliver() (pushed or being pushed)

  /**
   * Push the current batch once the previous push has finished (so the charge-limit room is exact), cut to
   * maxResults and to the jobs still chargeable within the user's max charge.
   */
  async function flush() {
    await settle();
    const take = batch;
    const takeIds = ids;
    batch = [];
    ids = [];
    if (!take.length || stopped) return;
    if (!deadline.hasTimeFor(BATCH_RESERVE_MS)) { stop('deadline'); return; }
    const want = Math.min(take.length, opts.maxResults - queued);
    const room = deps.room ? deps.room() : Infinity;
    const n = Math.max(0, Math.min(want, Math.floor(room)));
    if (n > 0) {
      const rows = n === take.length ? take : take.slice(0, n);
      const t0 = Date.now();
      queued += n;
      pending = (async () => {
        const res = await deps.deliver(rows);
        summary.deliver_ms += Date.now() - t0;
        summary.batches += 1;
        summary.rows += n;
        summary.charged_events += n;
        if (seen) for (let k = 0; k < n; k += 1) seen.add(takeIds[k]);
        if (res?.eventChargeLimitReached) stop('charge_limit');
      })();
    }
    if (n < want) { await settle(); stop('charge_limit'); } else if (queued >= opts.maxResults) { await settle(); stop('max_results'); }
  }

  // Prefetch: download shard k+1 while shard k is parsed and pushed (compressed shards are <= 5 MB each).
  const fetchShard = (i) => readShard(index.base, manifest.shards[i].file, { timeoutMs: 120000, attempts: 5 })
    .then((buf) => ({ buf }), (error) => ({ error }));
  let next = order.length ? fetchShard(order[0]) : null;
  for (let k = 0; k < order.length && !stopped; k += 1) {
    const i = order[k];
    const shard = manifest.shards[i];
    const got = await next;
    next = k + 1 < order.length ? fetchShard(order[k + 1]) : null;
    if (got.error) {
      summary.shards_failed += 1;
      log(`Skipping shard ${shard.file}: ${got.error.message}`);
      continue;
    }
    const t0 = Date.now();
    let boards = {};
    try {
      for await (const line of shardLines(got.buf, shard.file)) {
        if (stopped) break;
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (rec._boards) { boards = rec._boards; continue; }
        const job = expandIndexRecord(rec, boards, manifest.built_at);
        if (!search(job, nowMs)) continue;
        // The index can hold one job_id more than once (measured 2026-11-02: 30,818 repeated Workable records):
        // a job is delivered and charged once per run.
        const h = idHash(job.job_id);
        if (inRun.has(h)) { summary.repeated_in_index += 1; continue; }
        inRun.add(h);
        summary.matched += 1;
        if (seen && seen.seen(h)) { summary.skipped_seen += 1; continue; }
        batch.push(bulkRow(job, opts.fields));
        ids.push(h);
        if (batch.length >= batchSize || queued + batch.length >= opts.maxResults) await flush();
      }
    } catch (e) {
      // A corrupt shard: the rows already pushed from it stay delivered (and remembered); the rest is skipped.
      summary.shards_failed += 1;
      log(`Shard ${shard.file} unreadable: ${e.message}`);
      continue;
    } finally {
      summary.read_ms += Date.now() - t0;
    }
    summary.shards_read += 1;
  }
  if (!stopped) await flush();
  await settle();
  if (summary.shards_failed && summary.shards_failed === order.length) {
    throw Object.assign(new Error(`all ${order.length} index shards failed to load`), { failureClass: 'site_down' });
  }
  summary.complete = summary.stop_reason === 'exhausted' && summary.shards_failed === 0;
  return summary;
}
