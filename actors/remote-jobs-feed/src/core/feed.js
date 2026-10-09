// Run orchestration with injected I/O so tests can drive it end to end without Apify.
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { createGunzip, createBrotliDecompress, gunzipSync } from 'node:zlib';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchJson as libFetchJson, FetchError } from '../lib/http.js';
import { compileSearch } from './filters.js';
import { compileKeyword } from './keywords.js';
import { TopK, rankCmp, newestCmp } from './rank.js';
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
  'description_status', 'duplicate_sources', 'match_score', 'matched_in', 'source_url', 'fetched_at',
];

/**
 * Output row. description_status: included | not_requested | unavailable (live fetch failed / empty).
 * match_score / matched_in: keyword relevance (rank.js), null when the run has no keywords.
 */
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

/**
 * Slim index record + its shard's board header -> job object with every output field.
 * Header keys are boardKey()s, so EU Lever boards are "lever:eu:<token>". `builtAt` backs up a
 * missing header timestamp (fetched_at must be a string in the dataset schema).
 */
export function expandIndexRecord(rec, boards, builtAt = null) {
  const token = String(rec.company_board).toLowerCase();
  const b = boards[`${rec.ats}:${token}`] || boards[`${rec.ats}:eu:${token}`] || {};
  const board = { ats: rec.ats, token: b.t || rec.company_board, ...(b.r ? { region: b.r } : {}) };
  return {
    ...rec,
    apply_url: rec.apply_url || defaultApplyUrl(rec.ats, rec.job_url),
    duplicate_sources: rec.duplicate_sources || [],
    description_text: null,
    kw: b.kw ? `${rec.kw || ''} ${b.kw}` : (rec.kw || ''),
    source_url: apiUrlFor(board),
    fetched_at: b.f || builtAt || null,
    _board: board,
  };
}

/** Date the incremental tracker orders jobs by (YYYY-MM-DD). Undated jobs sort first, i.e. "old". */
export const trackDate = (job) => (job.posted_at || job.updated_at || '1970-01-01').slice(0, 10);

// ------------------------------------------------------------------ default I/O
const isLocal = (base) => base.startsWith('file://') || base.startsWith('/') || /^[A-Za-z]:\\/.test(base);
const localPath = (base, rel) => (base.startsWith('file://') ? fileURLToPath(`${base.replace(/\/$/, '')}/${rel}`) : `${base.replace(/\/$/, '')}/${rel}`);

/** retry404: keep retrying a 404 (manifest.json is briefly missing while the nightly publish swaps it). */
export async function readIndexFile(base, rel, { timeoutMs = 30000, attempts = 3, retry404 = false } = {}) {
  if (isLocal(base)) return readFile(localPath(base, rel));
  let last;
  for (let a = 0; a < attempts; a += 1) {
    if (a) await new Promise((r) => setTimeout(r, 1000 * a));
    try {
      const res = await fetch(`${base.replace(/\/$/, '')}/${rel}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 404) throw new FetchError(`HTTP 404 for index file ${rel}`, 'http_error', 404);
      if (!res.ok) throw new FetchError(`HTTP ${res.status} for index file ${rel}`, res.status >= 500 ? 'site_down' : 'http_error', res.status);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      last = e;
      if (e.status === 404 && !retry404) break;
    }
  }
  throw last;
}

/**
 * Async iterator over the lines of a brotli (.br) or gzip (.gz) JSONL shard, streamed (bounded memory).
 * A download that stalls for `stallMs` (no bytes) is aborted, so the caller can retry it quickly.
 */
export async function* streamShardLines(base, rel, { timeoutMs = 120000, stallMs = 20000 } = {}) {
  let source;
  let timer = null;
  if (isLocal(base)) {
    source = createReadStream(localPath(base, rel));
  } else {
    const stall = new AbortController();
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => stall.abort(new FetchError(`shard ${rel} stalled for ${stallMs / 1000} s`, 'timeout')), stallMs);
    };
    arm();
    let res;
    try {
      res = await fetch(`${base.replace(/\/$/, '')}/${rel}`, {
        headers: { 'User-Agent': UA }, signal: AbortSignal.any([stall.signal, AbortSignal.timeout(timeoutMs)]),
      });
    } catch (e) {
      clearTimeout(timer);
      throw e;
    }
    if (!res.ok || !res.body) {
      clearTimeout(timer);
      throw new FetchError(`HTTP ${res.status} for shard ${rel}`, res.status >= 500 ? 'site_down' : 'http_error', res.status);
    }
    source = Readable.fromWeb(res.body);
    source.on('data', arm);
  }
  const unzip = rel.endsWith('.br') ? createBrotliDecompress() : createGunzip();
  source.on('error', (e) => unzip.destroy(e));
  const rl = createInterface({ input: source.pipe(unzip), crlfDelay: Infinity });
  try {
    for await (const line of rl) if (line) yield line;
  } finally {
    clearTimeout(timer);
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

export async function mapLimit(items, limit, fn) {
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

// ------------------------------------------------------------------ index access (shared by all jobs Actors)
/** Parallel shard downloads when every needed shard is read anyway (ranking, aggregation). */
export const SHARD_CONCURRENCY = 4;

/**
 * Open the published index: -> { base, manifest, readFile, stream }. Throws when the manifest is
 * unreachable or has an unsupported format (callers fall back to live boards).
 */
export async function openIndex(deps = {}) {
  const base = deps.indexBaseUrl || INDEX_BASE_URL;
  const readFileImpl = deps.readIndexFile || readIndexFile;
  const stream = deps.streamShardLines || streamShardLines;
  const manifest = JSON.parse((await readFileImpl(base, 'manifest.json', { timeoutMs: 20000, attempts: 5, retry404: true })).toString('utf8'));
  if (manifest.format !== INDEX_FORMAT || !Array.isArray(manifest.shards)) throw new Error(`unsupported index format ${manifest.format}`);
  return { base, manifest, readFile: readFileImpl, stream };
}

/** directory.json.gz rows: [ats, token, company_name, jobs, [shard indices]]. */
export async function readDirectory(index) {
  return JSON.parse(gunzipSync(await index.readFile(index.base, index.manifest.directory || 'directory.json.gz')).toString('utf8'));
}

/**
 * Stream one shard into a fresh accumulator; on a network error the shard is re-read from the start
 * into a new accumulator (up to `attempts` times), so a retry never double-counts.
 * @param begin () => { add(job, boardHeader) }  @returns the accumulator of the successful attempt
 */
export async function scanShard(index, shard, begin, { attempts = 3, log = () => {} } = {}) {
  let last;
  for (let a = 0; a < attempts; a += 1) {
    if (a) await new Promise((r) => setTimeout(r, 1000 * a));
    const acc = begin();
    let boards = {};
    try {
      for await (const line of index.stream(index.base, shard.file)) {
        let rec;
        try { rec = JSON.parse(line); } catch { continue; }
        if (rec._boards) { boards = rec._boards; continue; }
        acc.add(expandIndexRecord(rec, boards, index.manifest.built_at), boards);
      }
      return acc;
    } catch (e) {
      last = e;
      log(`Shard ${shard.file} read failed (attempt ${a + 1}/${attempts}): ${e.message}`);
    }
  }
  throw Object.assign(last || new Error(`shard ${shard.file} unreadable`), { failureClass: last?.failureClass || 'site_down' });
}

// ------------------------------------------------------------------ the run
/**
 * @param opts normalizeInput() result
 * @param deps { pushData, charge, tracker?, log?, indexBaseUrl?, fetchJson?, fetchText?, readIndexFile?,
 *               streamShardLines?, fallbackBoards?, now?, topK? }
 */
export async function runFeed(opts, deps) {
  const log = deps.log || (() => {});
  const nowMs = deps.now ? deps.now() : Date.now();
  const search = compileSearch(opts);
  const ranked = opts.keywords.some((k) => compileKeyword(k).phrase);
  const tracker = deps.tracker || null;
  const pace = deps.pacer || hostPacer(deps.hostGaps);
  const summary = {
    mode: opts.mode, rows: 0, charged_events: 0, matched: 0, skipped_seen: 0, skipped_closed: 0, stop_reason: 'exhausted',
    ranking: ranked ? 'relevance' : 'newest',
    boards_requested: 0, boards_ok: 0, boards_failed: 0, failed_boards: [], shards_total: 0, shards_read: 0, shards_failed: 0,
    ranking_passes: 0, index_scan_ms: 0, delivery_ms: 0, description_boards_fetched: 0, description_boards_failed: 0, descriptions_unavailable: 0,
    index_built_at: null, index_jobs: null, used_fallback: false, bad_refs: opts.badRefs || [],
  };
  const delivered = new Set();
  const perCompany = new Map();
  const companyFull = (job) => opts.maxPerCompany != null && (perCompany.get(job.company_board) || 0) >= opts.maxPerCompany;
  let stopped = false;
  const pacedFetchJson = (fj) => async (url, o) => {
    const ats = /greenhouse/.test(url) ? 'greenhouse' : /lever\.co/.test(url) ? 'lever' : /ashbyhq/.test(url) ? 'ashby' : /workable/.test(url) ? 'workable' : 'recruitee';
    await pace(ats);
    return (fj || libFetchJson)(url, o);
  };

  /** Incremental check for a job that passed the filters; stamps its relevance. Counts into `c`. */
  function accept(job, r, c = summary) {
    c.matched += 1;
    if (tracker?.isDuplicate(trackDate(job), job.job_id)) { c.skipped_seen += 1; return false; }
    job.match_score = r.score;
    job.matched_in = r.matched_in;
    return true;
  }

  /** Filter + dedupe + incremental check. */
  function eligible(job) {
    if (delivered.has(job.job_id)) return false;
    const r = search(job, nowMs);
    return Boolean(r) && accept(job, r);
  }

  async function emit(job) {
    const row = toOutput(job, opts.includeDescription);
    if (row.description_status === 'unavailable') summary.descriptions_unavailable += 1;
    await deps.pushData(row);
    delivered.add(job.job_id);
    perCompany.set(job.company_board, (perCompany.get(job.company_board) || 0) + 1);
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

  /**
   * Deliver index matches in the given order, fetching descriptions only for jobs about to be
   * delivered. `prechecked`: filters and the incremental check already ran (ranked path).
   */
  async function deliverIndexed(matches, { prechecked = false } = {}) {
    let i = 0;
    while (i < matches.length && !stopped) {
      const batch = [];
      while (i < matches.length && batch.length < opts.maxResults - summary.rows) {
        const job = matches[i];
        i += 1;
        if (opts.maxPerCompany != null && (perCompany.get(job.company_board) || 0)
          + batch.filter((b) => b.company_board === job.company_board).length >= opts.maxPerCompany) continue;
        if (prechecked ? !delivered.has(job.job_id) : eligible(job)) batch.push(job);
      }
      if (!batch.length) break;
      if (opts.includeDescription) {
        const boards = [...new Map(batch.map((j) => [boardKey(j._board), j._board])).values()];
        await mapLimit(boards, 8, (b) => liveBoard(b));
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
    const jobs = [];
    for (const job of dedupeJobs(results.flat())) {
      const r = search(job, nowMs);
      if (r && accept(job, r)) jobs.push(job);
    }
    jobs.sort(ranked ? rankCmp : newestCmp);
    for (const job of jobs) {
      if (stopped) break;
      if (!delivered.has(job.job_id) && !companyFull(job)) await emit(job);
    }
  }

  if (opts.mode === 'live') {
    if (opts.boards.length === 0) throw Object.assign(new Error(`No supported job-board URL in input: ${opts.badRefs.join(', ')}`), { failureClass: 'http_error' });
    await runLive(opts.boards);
    return summary;
  }

  // Search mode: stream the slim index; fall back to live boards when it is unreachable.
  let index;
  try {
    index = await openIndex(deps);
  } catch (e) {
    log(`Jobs index unreachable (${e.message}); falling back to live fetch of ${(deps.fallbackBoards || FALLBACK_BOARDS).length} built-in boards.`);
    summary.used_fallback = true;
    summary.mode = 'fallback_live';
    await runLive(deps.fallbackBoards || FALLBACK_BOARDS);
    return summary;
  }
  const { manifest } = index;
  summary.index_built_at = manifest.built_at;
  summary.index_jobs = manifest.jobs;

  let shardAllow = null;
  if (opts.companies.length) {
    const { allow, matched } = shardsForCompanies(await readDirectory(index), opts.companies);
    shardAllow = allow;
    log(`companies filter matched ${matched.length} boards in the index${matched.length ? '' : ' - add the company board URL in live mode (companyUrls) if it is not indexed yet'}.`);
  }
  const order = selectShards(manifest, opts, { since: tracker?.since ?? null, now: nowMs, shardAllow });
  summary.shards_total = order.length;
  const shardFailed = (i, e) => {
    summary.shards_failed += 1;
    log(`Skipping shard ${manifest.shards[i].file}: ${e.message}`);
    if (summary.shards_failed === order.length) throw e; // nothing readable: fail loudly
  };

  // Candidates are collected into a bounded top-K (K = 3 x maxResults, max 3,000) and only the delivered
  // set gets live descriptions. When more than K candidates exist and the run still needs rows after
  // delivering them (closed jobs, or maxResults > 1,000), another pass collects the next K strictly
  // below the last candidate of the previous pass.
  //  - with keywords: relevance order (rank.js) over every needed shard;
  //  - without: newest first, one posted-date band at a time (all ATSs of the band merged), so the run
  //    stops after the first bands that fill maxResults.
  const K = deps.topK || Math.min(3000, opts.maxResults * 3);
  const cmp = ranked ? rankCmp : newestCmp;
  async function collectAndDeliver(shardIdxs) {
    let boundary = null;
    let pass = 0;
    while (!stopped) {
      pass += 1;
      summary.ranking_passes += 1;
      const first = pass === 1;
      const top = new TopK(K, cmp);
      const t0 = Date.now();
      await mapLimit(shardIdxs, SHARD_CONCURRENCY, async (i) => {
        let acc;
        try {
          acc = await scanShard(index, manifest.shards[i], () => {
            const local = new TopK(K, cmp);
            const c = { matched: 0, skipped_seen: 0 };
            return {
              local, c,
              add: (job) => {
                if (delivered.has(job.job_id)) return;
                const r = search(job, nowMs);
                if (!r || !accept(job, r, c)) return;
                if (boundary && cmp(boundary, job) >= 0) return; // already ranked in an earlier pass
                local.push(job);
              },
            };
          }, { log });
        } catch (e) { if (first) shardFailed(i, e); return; }
        if (first) { summary.shards_read += 1; summary.matched += acc.c.matched; summary.skipped_seen += acc.c.skipped_seen; }
        top.dropped += acc.local.dropped;
        for (const job of acc.local.heap) top.push(job);
      });
      const list = top.sorted();
      const t1 = Date.now();
      summary.index_scan_ms += t1 - t0;
      if (!list.length) return;
      await deliverIndexed(list, { prechecked: true });
      summary.delivery_ms += Date.now() - t1;
      if (!top.dropped) return;
      boundary = list[list.length - 1];
    }
  }

  if (ranked) {
    await collectAndDeliver(order);
  } else {
    const bands = [...new Set(order.map((i) => manifest.shards[i].band))];
    for (const band of bands) {
      if (stopped) break;
      await collectAndDeliver(order.filter((i) => manifest.shards[i].band === band));
    }
  }
  return summary;
}
