// Run orchestration with injected I/O so tests can drive it end to end without Apify.
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip, gunzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchJson as libFetchJson, FetchError } from './lib/http.js';
import { compileFilter } from './filters.js';
import { parseBoard, apiUrlFor, boardUrlFor, boardKey, dedupeJobs } from './transform.js';
import { selectShards, shardsForCompanies, INDEX_FORMAT } from './index_format.js';
import { clean } from './text.js';

// Where the prebuilt jobs index is hosted (manifest.json + directory.json.gz + shards/).
// Placeholder until hosting is configured; overridable with the JOBS_INDEX_URL env var.
export const INDEX_BASE_URL = 'https://jobs-index.factpipe.invalid/v1';

// Large, long-lived boards used when the index is unreachable, so the run still returns rows.
export const FALLBACK_BOARDS = [
  { ats: 'greenhouse', token: 'gitlab' },
  { ats: 'greenhouse', token: 'grafanalabs' },
  { ats: 'greenhouse', token: 'elastic' },
  { ats: 'greenhouse', token: 'canonical' },
  { ats: 'greenhouse', token: 'datadog' },
  { ats: 'greenhouse', token: 'cloudflare' },
  { ats: 'ashby', token: 'supabase' },
  { ats: 'ashby', token: 'posthog' },
  { ats: 'lever', token: 'acceldata' },
  { ats: 'workable', token: 'blueground' },
];

const UA = 'Mozilla/5.0 (compatible; factpipe-jobs-feed/1.0; +https://apify.com/factpipe)';

export const OUTPUT_FIELDS = [
  'job_id', 'title', 'company_name', 'company_board', 'ats', 'department', 'team', 'employment_type',
  'workplace_type', 'locations', 'country_codes', 'remote', 'salary_min', 'salary_max', 'salary_currency',
  'salary_period', 'posted_at', 'updated_at', 'apply_url', 'job_url', 'description_text', 'description_snippet',
  'duplicate_sources', 'source_url', 'fetched_at',
];

export function toOutput(job, includeDescription) {
  const row = {};
  for (const k of OUTPUT_FIELDS) row[k] = job[k] === undefined ? null : job[k];
  for (const k of ['locations', 'country_codes', 'duplicate_sources']) if (!Array.isArray(row[k])) row[k] = [];
  if (!includeDescription) row.description_text = null;
  return row;
}

/** Date the incremental tracker orders jobs by (YYYY-MM-DD). Undated jobs sort first, i.e. "old". */
export const trackDate = (job) => (job.posted_at || job.updated_at || '1970-01-01').slice(0, 10);

// ------------------------------------------------------------------ default I/O
const isLocal = (base) => base.startsWith('file://') || base.startsWith('/') || /^[A-Za-z]:\\/.test(base);
const localPath = (base, rel) => (base.startsWith('file://') ? fileURLToPath(`${base.replace(/\/$/, '')}/${rel}`) : `${base.replace(/\/$/, '')}/${rel}`);

export async function readIndexFile(base, rel, { timeoutMs = 30000 } = {}) {
  if (isLocal(base)) return readFile(localPath(base, rel));
  const res = await fetch(`${base.replace(/\/$/, '')}/${rel}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new FetchError(`HTTP ${res.status} for index file ${rel}`, res.status >= 500 ? 'site_down' : 'http_error', res.status);
  return Buffer.from(await res.arrayBuffer());
}

/** Async iterator over the lines of a gzip'd JSONL shard, streamed (bounded memory). */
export async function* streamShardLines(base, rel, { timeoutMs = 120000 } = {}) {
  let source;
  if (isLocal(base)) {
    source = createReadStream(localPath(base, rel));
  } else {
    const res = await fetch(`${base.replace(/\/$/, '')}/${rel}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.body) throw new FetchError(`HTTP ${res.status} for shard ${rel}`, res.status >= 500 ? 'site_down' : 'http_error', res.status);
    source = Readable.fromWeb(res.body);
  }
  const gunzip = createGunzip();
  source.on('error', (e) => gunzip.destroy(e));
  const rl = createInterface({ input: source.pipe(gunzip), crlfDelay: Infinity });
  try {
    for await (const line of rl) if (line) yield line;
  } finally {
    rl.close();
    source.destroy?.();
  }
}

async function defaultFetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new FetchError(`HTTP ${res.status} at ${url}`, 'http_error', res.status);
  return res.text();
}

/** Company display name from a hosted board page title (Lever and Ashby APIs don't return it). */
export function companyNameFromTitle(ats, html) {
  const m = String(html || '').match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  if (!m) return null;
  let t = clean(m[1].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"'));
  if (!t) return null;
  if (ats === 'ashby') t = t.replace(/\s+(jobs|careers)$/i, '');
  if (/^(jobs|careers|ashby|lever|job board|404|not found)$/i.test(t)) return null;
  return t;
}

// ------------------------------------------------------------------ live boards
/** Fetch one board live -> { board, company_name, jobs, source_url } ; throws FetchError on failure. */
export async function fetchBoard(board, { fetchJson = libFetchJson, fetchText = defaultFetchText, now = () => new Date() } = {}) {
  const url = apiUrlFor(board);
  const response = await fetchJson(url, { headers: { 'User-Agent': UA }, retries: 2, timeoutMs: board.ats === 'lever' ? 90000 : 45000, minDelayMs: 1000 });
  const parsed = parseBoard(board, response);
  let name = parsed.company_name;
  if (!name && (board.ats === 'lever' || board.ats === 'ashby') && parsed.jobs.length) {
    try { name = companyNameFromTitle(board.ats, await fetchText(boardUrlFor(board))); } catch { name = null; }
  }
  const fetchedAt = now().toISOString();
  const jobs = parsed.jobs.map((j) => ({ ...j, company_name: name || j.company_name, source_url: url, fetched_at: fetchedAt }));
  return { board, company_name: name, jobs, source_url: url };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

// ------------------------------------------------------------------ the run
/**
 * @param opts normalizeInput() result
 * @param deps { pushData, charge, tracker?, log?, indexBaseUrl?, fetchJson?, fetchText?, readIndexFile?,
 *               streamShardLines?, fallbackBoards?, now? }
 */
export async function runFeed(opts, deps) {
  const log = deps.log || (() => {});
  const nowMs = deps.now ? deps.now() : Date.now();
  const filter = compileFilter(opts);
  const tracker = deps.tracker || null;
  const summary = {
    mode: opts.mode, rows: 0, charged_events: 0, matched: 0, skipped_seen: 0, stop_reason: 'exhausted',
    boards_requested: 0, boards_ok: 0, boards_failed: 0, failed_boards: [], shards_total: 0, shards_read: 0,
    index_built_at: null, index_jobs: null, used_fallback: false, bad_refs: opts.badRefs || [],
  };
  const delivered = new Set();
  let stopped = false;

  async function deliver(job) {
    if (stopped) return;
    if (!filter(job, nowMs)) return;
    if (delivered.has(job.job_id)) return;
    summary.matched += 1;
    if (tracker?.isDuplicate(trackDate(job), job.job_id)) { summary.skipped_seen += 1; return; }
    await deps.pushData(toOutput(job, opts.includeDescription));
    delivered.add(job.job_id);
    tracker?.observe(trackDate(job), job.job_id);
    summary.rows += 1;
    // PPE: one job-result per delivered row; nothing else is ever charged.
    const res = await deps.charge({ eventName: 'job-result' });
    summary.charged_events += 1;
    if (res?.eventChargeLimitReached) { stopped = true; summary.stop_reason = 'charge_limit'; return; }
    if (summary.rows >= opts.maxResults) { stopped = true; summary.stop_reason = 'max_results'; }
  }

  async function runLive(boards) {
    summary.boards_requested = boards.length;
    const results = await mapLimit(boards, 6, async (b) => {
      try {
        const r = await fetchBoard(b, { fetchJson: deps.fetchJson, fetchText: deps.fetchText, now: () => new Date(nowMs) });
        summary.boards_ok += 1;
        return r.jobs;
      } catch (e) {
        summary.boards_failed += 1;
        summary.failed_boards.push({ board: boardKey(b), status: e.status ?? null, failure_class: e.failureClass || 'unknown' });
        log(`Board ${boardKey(b)} failed: ${e.message}`);
        return [];
      }
    });
    const jobs = dedupeJobs(results.flat());
    jobs.sort((a, b) => (b.posted_at || '').localeCompare(a.posted_at || '') || a.job_id.localeCompare(b.job_id));
    for (const job of jobs) {
      if (stopped) break;
      await deliver(job);
    }
  }

  if (opts.mode === 'live') {
    if (opts.boards.length === 0) throw Object.assign(new Error(`No supported job-board URL in input: ${opts.badRefs.join(', ')}`), { failureClass: 'http_error' });
    await runLive(opts.boards);
    return summary;
  }

  // Search mode: stream the prebuilt index; fall back to live boards when it is unreachable.
  const base = deps.indexBaseUrl || INDEX_BASE_URL;
  const readFileImpl = deps.readIndexFile || readIndexFile;
  const streamImpl = deps.streamShardLines || streamShardLines;
  let manifest;
  try {
    manifest = JSON.parse((await readFileImpl(base, 'manifest.json', { timeoutMs: 20000 })).toString('utf8'));
    if (manifest.format !== INDEX_FORMAT || !Array.isArray(manifest.shards)) throw new Error(`unsupported index format ${manifest.format}`);
  } catch (e) {
    log(`Jobs index unreachable (${e.message}); falling back to live fetch of ${(deps.fallbackBoards || FALLBACK_BOARDS).length} built-in boards.`);
    summary.used_fallback = true;
    summary.mode = 'fallback_live';
    await runLive(deps.fallbackBoards || FALLBACK_BOARDS);
    return summary;
  }
  summary.index_built_at = manifest.built_at;
  summary.index_jobs = manifest.jobs;

  let shardAllow = null;
  if (opts.companies.length) {
    const dir = JSON.parse(gunzipSync(await readFileImpl(base, manifest.directory || 'directory.json.gz')).toString('utf8'));
    const { allow, matched } = shardsForCompanies(dir, opts.companies);
    shardAllow = allow;
    log(`companies filter matched ${matched.length} boards in the index${matched.length ? '' : ' - add the company board URL in live mode (companyUrls) if it is not indexed yet'}.`);
  }
  const order = selectShards(manifest, opts, { since: tracker?.since ?? null, now: nowMs, shardAllow });
  summary.shards_total = order.length;
  for (const i of order) {
    if (stopped) break;
    const shard = manifest.shards[i];
    summary.shards_read += 1;
    for await (const line of streamImpl(base, shard.file)) {
      let job;
      try { job = JSON.parse(line); } catch { continue; }
      await deliver(job);
      if (stopped) break;
    }
  }
  return summary;
}
