// Run orchestration with injected I/O so tests can drive it end to end without Apify.
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip, createBrotliDecompress, gunzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchJson as libFetchJson, FetchError } from './lib/http.js';
import { compileFilter } from './filters.js';
import { parseBoard, apiUrlFor, boardUrlFor, boardKey, dedupeJobs } from './transform.js';
import { selectShards, shardsForCompanies, INDEX_FORMAT, defaultApplyUrl } from './index_format.js';
import { clean } from './text.js';

// Where the prebuilt jobs index is hosted (manifest.json + directory.json.gz + shards/).
// Placeholder until hosting is configured; overridable with the JOBS_INDEX_URL env var.
export const INDEX_BASE_URL = 'https://github.com/Neob001/data-portfolio/releases/download/jobs-index';

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
  'description_status', 'duplicate_sources', 'source_url', 'fetched_at',
];

/** Output row. description_status: included | not_requested | unavailable (live fetch failed / empty). */
export function toOutput(job, includeDescription) {
  const row = {};
  for (const k of OUTPUT_FIELDS) row[k] = job[k] === undefined ? null : job[k];
  for (const k of ['locations', 'country_codes', 'duplicate_sources']) if (!Array.isArray(row[k])) row[k] = [];
  if (!includeDescription) {
    row.description_text = null;
    row.description_status = 'not_requested';
  } else {
    row.description_status = row.description_text ? 'included' : 'unavailable';
  }
  return row;
}

/** Slim index record + its shard's board header -> job object with every output field. */
export function expandIndexRecord(rec, boards) {
  const b = boards[`${rec.ats}:${String(rec.company_board).toLowerCase()}`] || {};
  const board = { ats: rec.ats, token: b.t || rec.company_board, ...(b.r ? { region: b.r } : {}) };
  return {
    ...rec,
    apply_url: rec.apply_url || defaultApplyUrl(rec.ats, rec.job_url),
    duplicate_sources: rec.duplicate_sources || [],
    description_text: null,
    kw: b.kw ? `${rec.kw || ''} ${b.kw}` : (rec.kw || ''),
    source_url: apiUrlFor(board),
    fetched_at: b.f || null,
    _board: board,
  };
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

/** Async iterator over the lines of a brotli (.br) or gzip (.gz) JSONL shard, streamed (bounded memory). */
export async function* streamShardLines(base, rel, { timeoutMs = 120000 } = {}) {
  let source;
  if (isLocal(base)) {
    source = createReadStream(localPath(base, rel));
  } else {
    const res = await fetch(`${base.replace(/\/$/, '')}/${rel}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok || !res.body) throw new FetchError(`HTTP ${res.status} for shard ${rel}`, res.status >= 500 ? 'site_down' : 'http_error', res.status);
    source = Readable.fromWeb(res.body);
  }
  const unzip = rel.endsWith('.br') ? createBrotliDecompress() : createGunzip();
  source.on('error', (e) => unzip.destroy(e));
  const rl = createInterface({ input: source.pipe(unzip), crlfDelay: Infinity });
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
export async function fetchBoard(board, { fetchJson = libFetchJson, fetchText = defaultFetchText, now = () => new Date(), skipName = false } = {}) {
  const url = apiUrlFor(board);
  const response = await fetchJson(url, { headers: { 'User-Agent': UA }, retries: 2, timeoutMs: board.ats === 'lever' ? 90000 : 45000, minDelayMs: 1000 });
  const parsed = parseBoard(board, response);
  let name = parsed.company_name;
  if (!name && !skipName && (board.ats === 'lever' || board.ats === 'ashby') && parsed.jobs.length) {
    try { name = companyNameFromTitle(board.ats, await fetchText(boardUrlFor(board))); } catch { name = null; }
  }
  const fetchedAt = now().toISOString();
  const jobs = parsed.jobs.map((j) => ({ ...j, company_name: name || j.company_name, source_url: url, fetched_at: fetchedAt }));
  return { board, company_name: name, jobs, source_url: url };
}

// Minimum spacing between request starts per ATS host (Lever robots.txt Crawl-delay: 1; Workable
// rate-limits hard). Shared by live mode and on-demand descriptions within a run.
export const HOST_GAP_MS = { greenhouse: 0, ashby: 0, recruitee: 0, lever: 1000, workable: 3000 };

export function hostPacer(gaps = HOST_GAP_MS) {
  const next = {};
  return async (ats) => {
    const gap = gaps[ats] || 0;
    if (!gap) return;
    const now = Date.now();
    const wait = Math.max(0, (next[ats] || 0) - now);
    next[ats] = Math.max(now, next[ats] || 0) + gap;
    if (wait) await new Promise((r) => setTimeout(r, wait));
  };
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
  const pace = deps.pacer || hostPacer(deps.hostGaps);
  const summary = {
    mode: opts.mode, rows: 0, charged_events: 0, matched: 0, skipped_seen: 0, skipped_closed: 0, stop_reason: 'exhausted',
    boards_requested: 0, boards_ok: 0, boards_failed: 0, failed_boards: [], shards_total: 0, shards_read: 0,
    description_boards_fetched: 0, description_boards_failed: 0, descriptions_unavailable: 0,
    index_built_at: null, index_jobs: null, used_fallback: false, bad_refs: opts.badRefs || [],
  };
  const delivered = new Set();
  let stopped = false;
  const pacedFetchJson = (fj) => async (url, o) => {
    const ats = /greenhouse/.test(url) ? 'greenhouse' : /lever\.co/.test(url) ? 'lever' : /ashbyhq/.test(url) ? 'ashby' : /workable/.test(url) ? 'workable' : 'recruitee';
    await pace(ats);
    return (fj || libFetchJson)(url, o);
  };

  /** Filter + dedupe + incremental check (no side effects on output). */
  function eligible(job) {
    if (!filter(job, nowMs) || delivered.has(job.job_id)) return false;
    summary.matched += 1;
    if (tracker?.isDuplicate(trackDate(job), job.job_id)) { summary.skipped_seen += 1; return false; }
    return true;
  }

  async function emit(job) {
    const row = toOutput(job, opts.includeDescription);
    if (row.description_status === 'unavailable') summary.descriptions_unavailable += 1;
    await deps.pushData(row);
    delivered.add(job.job_id);
    tracker?.observe(trackDate(job), job.job_id);
    summary.rows += 1;
    // PPE: one job-result per delivered row (with or without description); nothing else is charged.
    const res = await deps.charge({ eventName: 'job-result' });
    summary.charged_events += 1;
    if (res?.eventChargeLimitReached) { stopped = true; summary.stop_reason = 'charge_limit'; return; }
    if (summary.rows >= opts.maxResults) { stopped = true; summary.stop_reason = 'max_results'; }
  }

  // ---- on-demand descriptions: one live API call per board returns all its jobs; cached per run.
  const boardCache = new Map(); // boardKey -> Promise<Map(job_id -> description_text) | null>
  function liveBoard(board) {
    const k = boardKey(board);
    if (!boardCache.has(k)) {
      boardCache.set(k, fetchBoard(board, { fetchJson: pacedFetchJson(deps.fetchJson), skipName: true, now: () => new Date(nowMs) })
        .then((r) => { summary.description_boards_fetched += 1; return new Map(r.jobs.map((j) => [j.job_id, j.description_text])); })
        .catch((e) => { summary.description_boards_failed += 1; log(`Description fetch for ${k} failed: ${e.message}`); return null; }));
    }
    return boardCache.get(k);
  }

  /** Deliver index matches (already sorted), fetching descriptions only for jobs that will be delivered. */
  async function deliverIndexed(matches) {
    let i = 0;
    while (i < matches.length && !stopped) {
      const batch = [];
      while (i < matches.length && batch.length < opts.maxResults - summary.rows) {
        const job = matches[i];
        i += 1;
        if (eligible(job)) batch.push(job);
      }
      if (!batch.length) break;
      if (opts.includeDescription) {
        const boards = [...new Map(batch.map((j) => [boardKey(j._board), j._board])).values()];
        await mapLimit(boards, 6, (b) => liveBoard(b));
      }
      for (const job of batch) {
        if (stopped) break;
        if (opts.includeDescription) {
          const live = await liveBoard(job._board);
          if (live && !live.has(job.job_id)) { summary.skipped_closed += 1; continue; } // closed since the index build
          job.description_text = live ? live.get(job.job_id) || null : null;
        }
        const { kw, _board, ...out } = job;
        await emit(out);
      }
    }
  }

  async function runLive(boards) {
    summary.boards_requested = boards.length;
    const results = await mapLimit(boards, 6, async (b) => {
      try {
        const r = await fetchBoard(b, { fetchJson: pacedFetchJson(deps.fetchJson), fetchText: deps.fetchText, now: () => new Date(nowMs) });
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
      if (eligible(job)) await emit(job);
    }
  }

  if (opts.mode === 'live') {
    if (opts.boards.length === 0) throw Object.assign(new Error(`No supported job-board URL in input: ${opts.badRefs.join(', ')}`), { failureClass: 'http_error' });
    await runLive(opts.boards);
    return summary;
  }

  // Search mode: stream the slim index; fall back to live boards when it is unreachable.
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
    let boards = {};
    const matches = [];
    for await (const line of streamImpl(base, shard.file)) {
      let rec;
      try { rec = JSON.parse(line); } catch { continue; }
      if (rec._boards) { boards = rec._boards; continue; }
      const job = expandIndexRecord(rec, boards);
      if (filter(job, nowMs)) matches.push(job); // cheap pre-filter; eligible() re-checks with side effects
    }
    matches.sort((a, b) => (b.posted_at || '').localeCompare(a.posted_at || '') || a.job_id.localeCompare(b.job_id));
    await deliverIndexed(matches);
  }
  return summary;
}
