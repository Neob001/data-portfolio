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
import { createDeadline } from '../lib/deadline.js';
import {
  parseBoard, apiUrlFor, boardUrlFor, boardKey, dedupeJobs, atsOfUrl, parseWorkdayDetail, workdayDetailUrl,
  boardHost, robotsPathsFor, personioEnglishUrl, teamtailorPageUrl, ROBOTS_CHECKED_ATS,
} from './transform.js';
import { selectShards, shardsForCompanies, INDEX_FORMAT, defaultApplyUrl } from './index_format.js';
import { clean, snippetOf, normKey } from './text.js';
import { robotsVerdict } from './robots.js';
import { enrichRow } from './enrich.js';

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

// Per-ATS fallback boards for a platform that FALLBACK_BOARDS does not cover (used when the index is
// unreachable or has no shard of the requested platform yet). Mid-size Workday sites (150-400 jobs, so
// 8-20 list pages each) keep the fallback run short.
export const EXTRA_FALLBACK_BOARDS = {
  workday: [
    { ats: 'workday', token: 'workday.wd5/Workday' },
    { ats: 'workday', token: 'crowdstrike.wd5/crowdstrikecareers' },
    { ats: 'workday', token: 'redhat.wd5/jobs' },
    { ats: 'workday', token: 'adobe.wd5/external_experienced' },
    { ats: 'workday', token: 'paypal.wd1/jobs' },
  ],
  // Career-site feeds: one request per board (+ robots.txt per host); mid-size boards (60-90 jobs, validated
  // 2026-10-14) with descriptions.
  personio: [
    { ats: 'personio', token: 'ommax' },
    { ats: 'personio', token: 'zollsoft' },
    { ats: 'personio', token: 'pmx' },
  ],
  teamtailor: [
    { ats: 'teamtailor', token: 'huaweiresearchcentergermanyaustria' },
    { ats: 'teamtailor', token: 'luminorbank' },
    { ats: 'teamtailor', token: 'ingeteam' },
  ],
};

// Workday CXS limits. The jobs endpoint rejects limit > 20 (HTTP 400) and reports at most total=2000.
export const WORKDAY = {
  pageSize: 20,
  maxJobsPerBoard: 2000, // live mode default cap per site (the index build sets its own, smaller cap)
  liveBoardBudgetMs: 150000, // stop paging one site after this long (newest jobs come first)
  pageReserveMs: 45000, // do not start another page with less than this left before the run deadline
  detailConcurrency: 2, // parallel job-detail calls for descriptions (all paced per ATS, see HOST_GAP_MS)
};
// Teamtailor /jobs.rss pages: 100 items each, next ones at ?offset=N. Live mode reads up to 2,000 jobs per site
// (the index build sets its own cap); a page that adds no new job ends the paging (offset ignored).
export const TEAMTAILOR = { pageSize: 100, maxJobsPerBoard: 2000, pageReserveMs: 20000 };

// robots.txt product token we answer to (our User-Agent below starts with it).
export const ROBOTS_AGENT = 'factpipe-jobs-feed';

const UA = 'Mozilla/5.0 (compatible; factpipe-jobs-feed/1.0; +https://apify.com/factpipe)';

export const OUTPUT_FIELDS = [
  'job_id', 'title', 'company_name', 'company_board', 'ats', 'department', 'team', 'employment_type', 'seniority',
  'workplace_type', 'locations', 'country_codes', 'remote', 'salary_min', 'salary_max', 'salary_currency',
  'salary_period', 'salary_source', 'years_experience_min', 'visa_sponsorship', 'posted_at', 'updated_at', 'apply_url',
  'job_url', 'description_text', 'description_snippet', 'description_status', 'duplicate_sources', 'match_score',
  'matched_in', 'source_url', 'fetched_at',
];

/**
 * Output row. description_status: included | not_requested | unavailable (live fetch failed / empty).
 * match_score / matched_in: keyword relevance (rank.js), null when the run has no keywords.
 * Enrichment (enrich.js, deterministic): seniority from the title on every row; salary from the text
 * (salary_source "description"), years_experience_min and visa_sponsorship only when the full
 * description was read (includeDescription, or live mode where the board read returns it anyway).
 */
export function toOutput(job, includeDescription) {
  const row = {};
  for (const k of OUTPUT_FIELDS) row[k] = job[k] === undefined ? null : job[k];
  for (const k of ['locations', 'country_codes', 'duplicate_sources']) if (!Array.isArray(row[k])) row[k] = [];
  // Structured level / experience from the ATS (Personio) back up the title / description rules.
  enrichRow(row, row.description_text, { seniority: job.seniority_hint ?? null, yearsMin: job.years_experience_hint ?? null });
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

/**
 * GET a text resource (pages, robots.txt, XML/RSS feeds). opts: { accept, meta, timeoutMs = 15000, retries = 0 }.
 * 429 / 5xx / network errors are retried with backoff; other HTTP errors throw at once (FetchError with
 * .status). meta: true -> { status, text, contentType } (robots.txt needs the content type), else the text.
 */
export async function defaultFetchText(url, { accept = null, meta = false, timeoutMs = 15000, retries = 0 } = {}) {
  let last;
  for (let a = 0; a <= retries; a += 1) {
    if (a) await new Promise((r) => setTimeout(r, 1000 * 2 ** (a - 1)));
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': UA, ...(accept ? { accept } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timeout = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      last = new FetchError(`${timeout ? `Timeout after ${timeoutMs}ms` : e.message} at ${url}`, timeout ? 'timeout' : 'site_down');
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      last = new FetchError(`HTTP ${res.status} at ${url}`, res.status === 429 ? 'blocked' : 'site_down', res.status);
      continue;
    }
    if (!res.ok) throw new FetchError(`HTTP ${res.status} at ${url}`, res.status === 403 ? 'blocked' : 'http_error', res.status);
    const text = await res.text();
    return meta ? { status: res.status, text, contentType: res.headers.get('content-type') || '' } : text;
  }
  throw last;
}

/** fetchText() result -> body text (a test double or a meta call may return { text }). */
const bodyOf = (r) => (typeof r === 'string' ? r : r?.text ?? '');

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

/**
 * Company name from a Workday career-site page: its og:title when it reads "Careers at X", "X Careers"
 * or "X Jobs" (the <title> is empty; the page is a JS app). null otherwise (callers fall back to the tenant).
 */
export function workdayNameFromPage(html) {
  const m = String(html || '').match(/<meta[^>]*property="og:title"[^>]*content="([^"]{1,200})"/i)
    || String(html || '').match(/<meta[^>]*content="([^"]{1,200})"[^>]*property="og:title"/i);
  if (!m) return null;
  const t = clean(m[1].replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"'));
  if (!t) return null;
  const n = t.match(/^(?:careers?|jobs?|work|opportunities)\s+(?:at|with|@)\s+(.{2,80})$/i)?.[1]
    || t.match(/^(.{2,80}?)\s+(?:careers?|jobs?|career site|job opportunities)$/i)?.[1];
  const name = clean(n?.replace(/[!.]+$/, '').replace(/^(?:welcome to|join)\s+/i, ''));
  return name && !/^(our|the|external|internal|search|find|all|global)$/i.test(name) ? name : null;
}

/**
 * Company name from a Personio career page <title> ("Jobs bei X", "Jobs at X", "Karriere bei X", "Offres d'emploi
 * chez X"...); null when the title has another form (callers fall back to the directory name / token).
 */
export function personioNameFromPage(html) {
  const m = String(html || '').match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  if (!m) return null;
  const t = clean(m[1].replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"'));
  const n = t?.match(/^(?:jobs?|stellenangebote|stellen|karriere|careers?|offres d['’]emploi|emplois?|vacatures|ofertas de (?:empleo|trabajo)|empleos?|posizioni aperte|lavora con noi|vagas|lediga jobb|ledige stillinger|työpaikat)\s+(?:bei|at|chez|bij|en|in|presso|da|na|hos|à|@|von)\s+(.{2,100})$/i)?.[1];
  const name = clean(n);
  return name && !/^(personio|uns|us|our company)$/i.test(name) ? name : null;
}

// ------------------------------------------------------------------ robots.txt (career-site hosts)
const ROBOTS_CACHE = new Map(); // host -> Promise<{ status, text, contentType? } | { error }>

/** GET /robots.txt with Accept: text/plain (asked for text/html, Workday hosts answer with their HTML app). */
async function fetchRobots(url, fetchText) {
  try {
    const r = await fetchText(url, { accept: 'text/plain', meta: true, retries: 1, timeoutMs: 15000 });
    return typeof r === 'string' ? { status: 200, text: r } : { status: r.status ?? 200, text: r.text ?? '', contentType: r.contentType ?? null };
  } catch (e) {
    return e?.status ? { status: e.status, text: '' } : { error: e?.message || 'unreachable' };
  }
}

/**
 * Robots verdict for the paths we read on a board's host ({ allowed, reason }), for the platforms in
 * ROBOTS_CHECKED_ATS (Workday career-site JSON, Personio and Teamtailor feeds). Called BEFORE any other
 * request to that host; one robots.txt fetch per host per process (cache). Only a text/plain robots.txt
 * that allows every path counts as permission (robots.js robotsVerdict).
 */
export async function boardRobots(board, { fetchText = defaultFetchText, cache = ROBOTS_CACHE, agent = ROBOTS_AGENT } = {}) {
  const host = boardHost(board);
  if (!cache.has(host)) cache.set(host, fetchRobots(`https://${host}/robots.txt`, fetchText));
  return robotsVerdict(await cache.get(host), agent, robotsPathsFor(board));
}
export const workdayRobots = boardRobots;

function robotsError(board, reason) {
  return Object.assign(new FetchError(`${boardKey(board)} skipped: ${reason}`, 'blocked', null), { robots: true });
}

/**
 * One Workday site, list pages only (no descriptions): POST .../jobs pages of 20, newest first, until
 * the site's total, `maxJobs`, the per-site `budgetMs` or the run deadline is reached. A site cut short
 * returns the jobs it has with `truncated: true`.
 */
async function fetchWorkdayBoard(board, { fetchJson, fetchText, now, skipName, maxJobs = WORKDAY.maxJobsPerBoard,
  budgetMs = WORKDAY.liveBoardBudgetMs, deadline = null, robotsCache, robotsAgent }) {
  const verdict = await workdayRobots(board, { fetchText, cache: robotsCache, agent: robotsAgent });
  if (!verdict.allowed) throw robotsError(board, verdict.reason);
  const url = apiUrlFor(board);
  const started = Date.now();
  const postings = [];
  const seen = new Set();
  let total = null;
  let truncated = false;
  let pages = 0;
  for (let offset = 0; ; offset += WORKDAY.pageSize) {
    if (pages > 0 && (Date.now() - started >= budgetMs || (deadline && !deadline.hasTimeFor(WORKDAY.pageReserveMs)))) { truncated = true; break; }
    const page = await fetchJson(url, {
      method: 'POST',
      body: { appliedFacets: {}, limit: WORKDAY.pageSize, offset, searchText: '' },
      headers: { 'User-Agent': UA, 'content-type': 'application/json', 'accept-language': 'en-US' },
      retries: 2, timeoutMs: 30000, minDelayMs: 1000,
    });
    pages += 1;
    if (!Array.isArray(page?.jobPostings)) parseBoard(board, page); // throws schema_change
    if (total === null) total = Number(page.total) || 0; // later pages report total 0
    for (const p of page.jobPostings) {
      if (p?.externalPath && !seen.has(p.externalPath)) { seen.add(p.externalPath); postings.push(p); }
    }
    if (page.jobPostings.length < WORKDAY.pageSize || offset + WORKDAY.pageSize >= total) break;
    if (postings.length >= maxJobs) { truncated = true; break; }
  }
  if (postings.length > maxJobs) { postings.length = maxJobs; truncated = true; }
  const fetchedAt = now();
  const parsed = parseBoard(board, { total, jobPostings: postings }, { fetchedAt });
  let name = null;
  if (!skipName && parsed.jobs.length) {
    try { name = workdayNameFromPage(await fetchText(boardUrlFor(board))); } catch { name = null; }
  }
  const iso = fetchedAt.toISOString();
  const jobs = parsed.jobs.map((j) => ({ ...j, company_name: name || j.company_name, source_url: url, fetched_at: iso }));
  return { board, company_name: name, jobs, source_url: url, truncated, total, pages };
}

// Feed requests: what the feed is, then anything (some hosts label XML as text/html).
const FEED_ACCEPT = {
  personio: 'application/xml, text/xml;q=0.9, */*;q=0.1',
  teamtailor: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.1',
};

/**
 * One Personio / Teamtailor board: robots.txt of its host first (never any other request when it does not
 * allow /xml + /job/ resp. /jobs.rss (+ ?offset=) + /jobs/), then the feed: Personio one request (+ an English
 * one only when a position came without description); Teamtailor pages of 100 until a short page, `maxJobs`
 * or the run deadline (then `truncated`). `requests` counts feed requests (robots.txt not included).
 */
async function fetchFeedBoard(board, { fetchText, now, skipName, robotsCache, robotsAgent, feedTimeoutMs = 60000,
  maxJobs = TEAMTAILOR.maxJobsPerBoard, deadline = null }) {
  const verdict = await boardRobots(board, { fetchText, cache: robotsCache, agent: robotsAgent });
  if (!verdict.allowed) throw robotsError(board, verdict.reason);
  const url = apiUrlFor(board);
  const opts = { accept: FEED_ACCEPT[board.ats], retries: 2, timeoutMs: feedTimeoutMs };
  const parsed = parseBoard(board, bodyOf(await fetchText(url, opts)));
  let { jobs } = parsed;
  let requests = 1;
  let truncated = false;
  if (board.ats === 'teamtailor' && parsed.items >= TEAMTAILOR.pageSize) {
    const ids = new Set(jobs.map((j) => j.job_id));
    for (let offset = TEAMTAILOR.pageSize; ; offset += TEAMTAILOR.pageSize) {
      if (jobs.length >= maxJobs || (deadline && !deadline.hasTimeFor(TEAMTAILOR.pageReserveMs))) { truncated = true; break; }
      const page = parseBoard(board, bodyOf(await fetchText(teamtailorPageUrl(board, offset), opts)));
      requests += 1;
      const fresh = page.jobs.filter((j) => !ids.has(j.job_id));
      for (const j of fresh) { ids.add(j.job_id); jobs.push(j); }
      if (page.items < TEAMTAILOR.pageSize || !fresh.length) break;
    }
    if (jobs.length > maxJobs) { jobs = jobs.slice(0, maxJobs); truncated = true; }
  }
  if (board.ats === 'personio' && jobs.some((j) => !j.description_text)) {
    try {
      requests += 1;
      const en = new Map(parseBoard(board, bodyOf(await fetchText(personioEnglishUrl(board), opts))).jobs.map((j) => [j.job_id, j]));
      jobs = jobs.map((j) => (j.description_text || !en.get(j.job_id)?.description_text ? j
        : { ...j, description_text: en.get(j.job_id).description_text, description_snippet: en.get(j.job_id).description_snippet }));
    } catch { /* the default-language feed stands */ }
  }
  let name = parsed.company_name;
  if (!name && board.ats === 'personio' && !skipName && jobs.length) {
    try { name = personioNameFromPage(bodyOf(await fetchText(boardUrlFor(board), { timeoutMs: 20000 }))); } catch { name = null; }
  }
  const iso = now().toISOString();
  const token = String(board.token);
  // Personio: a position's own <subcompany> beats the board name; the token is only the last resort.
  const out = jobs.map((j) => ({
    ...j, company_name: j.company_name && j.company_name !== token ? j.company_name : name || j.company_name, source_url: url, fetched_at: iso,
  }));
  return { board, company_name: name, jobs: out, source_url: url, requests, truncated };
}

// ------------------------------------------------------------------ live boards
/** Fetch one board live -> { board, company_name, jobs, source_url } ; throws FetchError on failure. */
export async function fetchBoard(board, { fetchJson = libFetchJson, fetchText = defaultFetchText, now = () => new Date(), skipName = false, ...wd } = {}) {
  if (board.ats === 'workday') return fetchWorkdayBoard(board, { fetchJson, fetchText, now, skipName, ...wd });
  if (board.ats === 'personio' || board.ats === 'teamtailor') return fetchFeedBoard(board, { fetchText, now, skipName, ...wd });
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
// Workday: at most one request start per 250 ms across all Workday hosts in a run, and one request in
// flight per site (its pages are read one after another): career-site JSON is not a documented API.
// Personio / Teamtailor: one subdomain per company, all on one platform: 250 ms between request starts.
export const HOST_GAP_MS = { greenhouse: 0, ashby: 0, recruitee: 0, lever: 1000, workable: 3000, workday: 250, personio: 250, teamtailor: 250 };

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
 *               streamShardLines?, fallbackBoards?, now?, topK?, deadline?, robotsCache? }
 */
export async function runFeed(opts, deps) {
  const log = deps.log || (() => {});
  const nowMs = deps.now ? deps.now() : Date.now();
  const search = compileSearch(opts);
  const ranked = opts.keywords.some((k) => compileKeyword(k).phrase);
  const tracker = deps.tracker || null;
  const pace = deps.pacer || hostPacer(deps.hostGaps);
  const deadline = deps.deadline || createDeadline();
  const rawFetchText = deps.fetchText || defaultFetchText;
  // Pages, robots.txt and feeds are paced per ATS like the JSON calls.
  const fetchText = async (url, o) => { await pace(atsOfUrl(url)); return rawFetchText(url, o); };
  const robotsCache = deps.robotsCache || undefined;
  const summary = {
    mode: opts.mode, rows: 0, charged_events: 0, matched: 0, skipped_seen: 0, skipped_closed: 0, stop_reason: 'exhausted',
    ranking: ranked ? 'relevance' : 'newest',
    boards_requested: 0, boards_ok: 0, boards_failed: 0, boards_truncated: 0, failed_boards: [], shards_total: 0, shards_read: 0, shards_failed: 0,
    ranking_passes: 0, index_scan_ms: 0, delivery_ms: 0, description_boards_fetched: 0, description_boards_failed: 0, descriptions_unavailable: 0,
    description_jobs_fetched: 0, description_jobs_failed: 0,
    index_built_at: null, index_jobs: null, used_fallback: false, fallback_reason: null, bad_refs: opts.badRefs || [],
  };
  const delivered = new Set();
  const perCompany = new Map();
  let stopped = false;
  const pacedFetchJson = (fj) => async (url, o) => {
    await pace(atsOfUrl(url));
    return (fj || libFetchJson)(url, o);
  };
  const paced = pacedFetchJson(deps.fetchJson);

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
      boardCache.set(k, fetchBoard(board, { fetchJson: paced, fetchText, robotsCache, skipName: true, now: () => new Date(nowMs) })
        .then((r) => { summary.description_boards_fetched += 1; return new Map(r.jobs.map((j) => [j.job_id, j.description_text])); })
        .catch((e) => { summary.description_boards_failed += 1; log(`Description fetch for ${k} failed: ${e.message}`); return null; }));
    }
    return boardCache.get(k);
  }

  // ---- Workday: its list endpoint has no descriptions, so each delivered job gets one detail call.
  // -> { description_text, locations, country_codes } | 'closed' (HTTP 404: closed since listed) | null
  const detailCache = new Map();
  function liveWorkdayJob(job) {
    if (!detailCache.has(job.job_id)) {
      detailCache.set(job.job_id, (async () => {
        const board = job._board || { ats: 'workday', token: job.company_board };
        const verdict = await workdayRobots(board, { fetchText, cache: robotsCache });
        if (!verdict.allowed) { summary.description_jobs_failed += 1; log(`Workday description for ${job.job_id} skipped: ${verdict.reason}`); return null; }
        const url = workdayDetailUrl(board, job.job_url);
        if (!url || !deadline.hasTimeFor(20000)) { summary.description_jobs_failed += 1; return null; }
        try {
          const r = await paced(url, { headers: { 'User-Agent': UA, 'accept-language': 'en-US' }, retries: 1, timeoutMs: 20000, minDelayMs: 1000 });
          summary.description_jobs_fetched += 1;
          return parseWorkdayDetail(board, r);
        } catch (e) {
          if (e.status === 404 || e.status === 410) return 'closed';
          summary.description_jobs_failed += 1;
          log(`Workday description for ${job.job_id} failed: ${e.message}`);
          return null;
        }
      })());
    }
    return detailCache.get(job.job_id);
  }
  const needsWorkdayDetail = (job) => job.ats === 'workday' && opts.includeDescription;
  // Index records need their board re-read for descriptions; live-mode records already carry them.
  const needsBoard = (job) => opts.includeDescription && job._board && job.ats !== 'workday';

  /**
   * Deliver matches in the given order, fetching descriptions only for jobs about to be delivered
   * (index records: one board call per board; Workday: one detail call per job). Jobs found closed are
   * skipped (not delivered, not charged). `prechecked`: filters and the incremental check already ran.
   */
  async function deliver(matches, { prechecked = false } = {}) {
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
      const boards = [...new Map(batch.filter(needsBoard).map((j) => [boardKey(j._board), j._board])).values()];
      await Promise.all([
        mapLimit(boards, 8, (b) => liveBoard(b)),
        mapLimit(batch.filter(needsWorkdayDetail), WORKDAY.detailConcurrency, (j) => liveWorkdayJob(j)),
      ]);
      for (const job of batch) {
        if (stopped) break;
        if (needsBoard(job)) {
          const live = await liveBoard(job._board);
          if (live && !live.has(job.job_id)) { summary.skipped_closed += 1; continue; } // closed since the index build
          job.description_text = live ? live.get(job.job_id) || null : null;
        } else if (needsWorkdayDetail(job)) {
          const d = await liveWorkdayJob(job);
          if (d === 'closed') { summary.skipped_closed += 1; continue; }
          if (d) {
            job.description_text = d.description_text;
            job.description_snippet = job.description_snippet || snippetOf(d.description_text);
            // The detail names every location; the list only the primary one. The detail list replaces it
            // when it contains it (so location filters still hold), else both are kept.
            const keys = new Set(d.locations.map(normKey));
            job.locations = d.locations.length && job.locations.every((l) => keys.has(normKey(l)))
              ? d.locations : [...new Set([...job.locations, ...d.locations])];
            job.country_codes = [...new Set([...job.country_codes, ...d.country_codes])].sort();
          }
        }
        const { kw, _board, ...out } = job;
        await emit(out);
      }
    }
  }

  async function runLive(boards) {
    summary.boards_requested = boards.length;
    // Several sites of one Workday tenant share a host: read them one after another.
    const groups = new Map();
    for (const b of boards) {
      const k = ROBOTS_CHECKED_ATS.includes(b.ats) ? boardHost(b) : boardKey(b);
      (groups.get(k) || groups.set(k, []).get(k)).push(b);
    }
    const results = await mapLimit([...groups.values()], 6, async (group) => {
      const out = [];
      for (const b of group) out.push(...await liveOne(b));
      return out;
    });
    const jobs = [];
    for (const job of dedupeJobs(results.flat())) {
      const r = search(job, nowMs);
      if (r && accept(job, r)) jobs.push(job);
    }
    jobs.sort(ranked ? rankCmp : newestCmp);
    await deliver(jobs, { prechecked: true });
  }

  /** One live board -> its jobs ([] when it failed; the failure is recorded in the summary). */
  async function liveOne(b) {
    try {
      const r = await fetchBoard(b, { fetchJson: paced, fetchText, now: () => new Date(nowMs), deadline, robotsCache });
      summary.boards_ok += 1;
      if (r.truncated) {
        summary.boards_truncated += 1;
        log(`Board ${boardKey(b)}: read the newest ${r.jobs.length} of ${r.total} jobs (per-site cap / time budget).`);
      }
      return r.jobs;
    } catch (e) {
      summary.boards_failed += 1;
      summary.failed_boards.push({ board: boardKey(b), status: e.status ?? null, failure_class: e.failureClass || 'unknown', ...(e.robots ? { robots: true } : {}) });
      log(`Board ${boardKey(b)} failed: ${e.message}`);
      return [];
    }
  }

  /** Built-in boards for a live fallback; a platform FALLBACK_BOARDS lacks (Workday, Personio, Teamtailor) gets its own. */
  function fallbackBoards() {
    const base = deps.fallbackBoards || FALLBACK_BOARDS;
    if (!opts.ats.length || base.some((b) => opts.ats.includes(b.ats))) return base;
    const extra = opts.ats.flatMap((a) => EXTRA_FALLBACK_BOARDS[a] || []);
    return extra.length ? extra : base;
  }

  async function runFallback(reason, code) {
    const boards = fallbackBoards();
    log(`${reason}; falling back to live fetch of ${boards.length} built-in boards.`);
    summary.used_fallback = true;
    summary.fallback_reason = code;
    summary.mode = 'fallback_live';
    await runLive(boards);
    return summary;
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
    return runFallback(`Jobs index unreachable (${e.message})`, 'index_unreachable');
  }
  // A platform the index does not hold yet (a newly added source before its first nightly build).
  if (opts.ats.length && !index.manifest.shards.some((s) => opts.ats.includes(s.ats))) {
    const own = fallbackBoards().filter((b) => opts.ats.includes(b.ats));
    if (own.length) {
      summary.index_built_at = index.manifest.built_at;
      return runFallback(`The jobs index (built ${index.manifest.built_at}) has no ${opts.ats.join('/')} jobs yet`, 'platform_not_indexed');
    }
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
      await deliver(list, { prechecked: true });
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
