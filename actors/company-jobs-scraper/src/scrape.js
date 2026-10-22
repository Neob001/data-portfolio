// Run orchestration with injected I/O (tests drive it end to end without Apify or network):
// company URL -> careers page -> job platform -> jobs through the shared jobs core's live mode.
import { normalizeInput } from './core/filters.js';
import { runFeed, hostPacer, mapLimit, defaultFetchText, ROBOTS_AGENT } from './core/feed.js';
import { robotsVerdict } from './core/robots.js';
import { boardKey, boardUrlFor } from './core/transform.js';
import { createDeadline } from './lib/deadline.js';
import {
  UA, LIMITS, HOST_GAP_MS, PAGE_MAX_BYTES, CAREERS_PATHS, parseCompanyInput, siteOf, robotsPath, boardFromUrl,
  unsupportedPlatformOf, detectPlatforms, careersLinks, postingLinks, careersScore, missRow, jobRow,
} from './transform.js';

export const COMPANY_CONCURRENCY = 3;
export const COMPANY_RESERVE_MS = 60000; // do not start a company with less than this left before the run deadline
export const DEFAULT_MAX_JOBS = 200;

// ------------------------------------------------------------------ default I/O
/**
 * GET one page WITHOUT following redirects (each hop is checked against its host's robots.txt first):
 * -> { status, location, contentType, text }. The body is cut at PAGE_MAX_BYTES. Network errors throw.
 */
export async function defaultFetchPage(url, { timeoutMs = 15000 } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'en-US,en;q=0.8' },
    redirect: 'manual', signal: AbortSignal.timeout(timeoutMs),
  });
  const out = { status: res.status, location: res.headers.get('location'), contentType: res.headers.get('content-type') || '', text: '' };
  if (res.status >= 300 && res.status < 400) { await res.body?.cancel().catch(() => {}); return out; }
  if (!res.body) return out;
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= PAGE_MAX_BYTES) { await reader.cancel().catch(() => {}); break; }
  }
  out.text = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
  return out;
}

/** Per-host pacing: at most one request start per `gap` ms on each host. */
export function perHostPacer(gap = HOST_GAP_MS) {
  const next = new Map();
  return async (host) => {
    const now = Date.now();
    const at = Math.max(now, next.get(host) || 0);
    next.set(host, at + gap);
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

/** robots.txt of the host of `url` (cached per host, Accept: text/plain) -> verdict for that URL's path. */
async function robotsFor(url, ctx) {
  const u = new URL(url);
  if (!ctx.robotsCache.has(u.hostname)) {
    ctx.robotsCache.set(u.hostname, (async () => {
      await ctx.pace(u.hostname);
      try {
        const r = await ctx.fetchText(`${u.protocol}//${u.host}/robots.txt`, { accept: 'text/plain', meta: true, retries: 1, timeoutMs: 15000 });
        return typeof r === 'string' ? { status: 200, text: r } : { status: r.status ?? 200, text: r.text ?? '', contentType: r.contentType ?? null };
      } catch (e) {
        return e?.status ? { status: e.status, text: '' } : { error: e?.message || 'unreachable' };
      }
    })());
  }
  return robotsVerdict(await ctx.robotsCache.get(u.hostname), ROBOTS_AGENT, [robotsPath(url)]);
}

// ------------------------------------------------------------------ discovery
/**
 * Find the job board(s) of one company input.
 * -> { boards, careersPageUrl, sourceUrl, pages } or { miss: { reason, detail, careersPageUrl, platform, sourceUrl }, pages }
 */
export async function discoverCompany(query, ctx) {
  const parsed = parseCompanyInput(query);
  if (parsed.error) return { miss: { reason: 'invalid_url', detail: `"${String(query).slice(0, 200)}" is not a website URL (${parsed.error}).` }, pages: 0 };
  if (parsed.board) return { boards: [parsed.board], careersPageUrl: boardUrlFor(parsed.board), sourceUrl: boardUrlFor(parsed.board), pages: 0 };
  const start = parsed.url;
  const direct = boardFromUrl(start);
  if (direct) return { boards: [direct], careersPageUrl: start, sourceUrl: start, pages: 0 };
  const startPlatform = unsupportedPlatformOf(start);
  if (startPlatform) {
    return { miss: { reason: 'unsupported_platform', platform: startPlatform, careersPageUrl: start, sourceUrl: start, detail: `${start} is a ${startPlatform} job board; this Actor does not read ${startPlatform} yet.` }, pages: 0 };
  }

  const companySite = siteOf(new URL(start).hostname);
  const origin = `${new URL(start).origin}/`;
  const seen = new Set();
  const perHost = new Map();
  const queue = [{ url: start, depth: 0, prio: 100 }];
  if (start !== origin) queue.push({ url: origin, depth: 0, prio: 2 });
  let pages = 0;
  let read = 0;
  let probed = false;
  let postingQueued = false;
  let firstFailure = null; // the input URL's own failure
  let unsupported = null;
  let careersPage = null;
  const robotsBlocked = [];
  const errors = [];

  /** GET with manual redirects; robots.txt of every hop's host first. */
  async function visit(url) {
    let cur = url;
    for (let hop = 0; hop <= LIMITS.redirects; hop += 1) {
      const host = new URL(cur).hostname;
      if (pages >= LIMITS.pagesPerCompany || (perHost.get(host) || 0) >= LIMITS.pagesPerHost) return { budget: true, url: cur };
      const verdict = await robotsFor(cur, ctx);
      if (!verdict.allowed) return { robots: verdict.reason, url: cur };
      pages += 1;
      perHost.set(host, (perHost.get(host) || 0) + 1);
      seen.add(cur);
      await ctx.pace(host);
      let r;
      try {
        r = await ctx.fetchPage(cur);
      } catch (e) {
        return { error: e?.name === 'TimeoutError' ? 'timeout' : (e?.cause?.code || e?.message || 'unreachable'), url: cur };
      }
      if (r.status >= 300 && r.status < 400 && r.location) {
        let next;
        try { next = new URL(r.location, cur).href; } catch { return { error: `bad redirect ${r.location}`, url: cur }; }
        const b = boardFromUrl(next);
        if (b) return { boards: [b], url: next, redirected: true };
        const p = unsupportedPlatformOf(next);
        if (p) return { unsupported: p, url: next };
        if (seen.has(next) && next !== cur) return { error: 'redirect loop', url: cur };
        cur = next;
        continue;
      }
      if (r.status >= 400 || r.status < 200) return { error: `HTTP ${r.status}`, status: r.status, url: cur };
      if (r.contentType && !/html|xml|text\/plain/i.test(r.contentType)) return { error: `not a web page (${r.contentType})`, url: cur };
      return { html: r.text || '', url: cur };
    }
    return { error: 'too many redirects', url: cur };
  }

  while (queue.length) {
    queue.sort((a, b) => b.prio - a.prio);
    const item = queue.shift();
    if (seen.has(item.url)) continue;
    const isStart = item.url === start;
    const res = await visit(item.url);
    if (res.budget) break;
    if (res.boards) return { boards: res.boards, careersPageUrl: item.url, sourceUrl: item.url, pages };
    if (res.unsupported) { unsupported ||= { platform: res.unsupported, page: item.url }; continue; }
    if (res.robots) {
      robotsBlocked.push({ url: res.url, reason: res.robots, careers: careersScore(res.url, '') >= 3 || item.depth > 0 });
      if (isStart) firstFailure ||= { robots: res.robots };
    } else if (res.error) {
      errors.push(`${res.url}: ${res.error}`);
      if (isStart) firstFailure ||= { error: res.error, status: res.status ?? null };
    } else {
      read += 1;
      const det = detectPlatforms(res.html, res.url);
      if (det.boards.length) {
        return { boards: det.boards.map(({ refs, ...b }) => b), careersPageUrl: res.url, sourceUrl: res.url, pages };
      }
      if (det.unsupported) unsupported ||= { platform: det.unsupported, page: res.url };
      if (item.depth > 0 || careersScore(res.url, '') >= 3) careersPage ||= res.url;
      if (item.depth < LIMITS.maxDepth && !item.posting) {
        for (const l of careersLinks(res.html, res.url, { companySite, seen })) {
          if (!queue.some((q) => q.url === l.url)) queue.push({ url: l.url, depth: item.depth + 1, prio: 10 + l.score - item.depth });
        }
      }
      // A careers page listing jobs on the company's own front end: one posting may name the ATS.
      if (!postingQueued && !item.posting && (item.depth > 0 || careersScore(res.url, '') >= 3)) {
        const [p] = postingLinks(res.html, res.url, { companySite, seen });
        if (p) { postingQueued = true; queue.push({ url: p, depth: LIMITS.maxDepth, prio: 3, posting: true }); }
      }
    }
    // Nothing left to follow: try the common careers paths once (unless the site itself is unreachable).
    if (!queue.length && !probed && !unsupported && !(firstFailure && !firstFailure.status && read === 0)) {
      probed = true;
      for (const p of CAREERS_PATHS) {
        const url = new URL(p, origin).href;
        if (!seen.has(url) && !seen.has(`${url}/`)) queue.push({ url, depth: 1, prio: 1 });
      }
    }
  }

  const sourceUrl = careersPage || start;
  if (unsupported) {
    return { miss: {
      reason: 'unsupported_platform', platform: unsupported.platform, careersPageUrl: unsupported.page, sourceUrl: unsupported.page,
      detail: `The careers page ${unsupported.page} uses ${unsupported.platform}, a job platform this Actor does not read yet.`,
    }, pages };
  }
  const careersBlocked = robotsBlocked.find((b) => b.careers);
  if ((read === 0 && robotsBlocked.length) || careersBlocked) {
    const b = careersBlocked || robotsBlocked[0];
    return { miss: { reason: 'robots_disallowed', careersPageUrl: careersPage, sourceUrl: b.url, detail: `Not read: ${b.url} (${b.reason}).` }, pages };
  }
  if (read === 0) {
    return { miss: { reason: 'site_unreachable', sourceUrl: start, detail: `The website did not answer (${errors.slice(0, 2).join('; ') || 'no page could be read'}).` }, pages };
  }
  return { miss: {
    reason: 'no_supported_ats_detected', careersPageUrl: careersPage, sourceUrl,
    detail: `Read ${read} page(s)${careersPage ? ` incl. ${careersPage}` : ''}: no link to a supported job board (Greenhouse, Lever, Ashby, Workable, Recruitee, Workday, Personio, Teamtailor). The company may use an in-house careers system or load its jobs with JavaScript only.`,
  }, pages };
}

// ------------------------------------------------------------------ the run
/**
 * @param input raw Actor input { companyUrls, maxJobsPerCompany }
 * @param deps { pushData, charge, log?, fetchPage?, fetchText?, fetchJson?, now?, deadline?, pace?, atsPacer?, robotsCache? }
 */
export async function runCompanies(input, deps) {
  const log = deps.log || (() => {});
  const nowMs = deps.now ? deps.now() : Date.now();
  const raw = Array.isArray(input.companyUrls) ? input.companyUrls : typeof input.companyUrls === 'string' ? input.companyUrls.split(/[\n,]/) : [];
  const queries = [];
  const seenQueries = new Set();
  for (const q of raw.map((x) => String(x ?? '').trim()).filter(Boolean)) {
    const key = q.toLowerCase().replace(/\/+$/, '');
    if (!seenQueries.has(key)) { seenQueries.add(key); queries.push(q); }
  }
  const m = Number(input.maxJobsPerCompany);
  const maxJobs = input.maxJobsPerCompany === undefined || input.maxJobsPerCompany === null || !Number.isInteger(m) || m < 1 ? DEFAULT_MAX_JOBS : m;
  const deadline = deps.deadline || createDeadline();
  const ctx = {
    fetchPage: deps.fetchPage || defaultFetchPage,
    fetchText: deps.fetchText || defaultFetchText,
    pace: deps.pace || perHostPacer(),
    robotsCache: deps.robotsCache || new Map(),
  };
  const atsPacer = deps.atsPacer || hostPacer();
  const claimed = new Map(); // boardKey -> query that read it (inputs naming the same board are read once)
  const summary = {
    companies: queries.length, companies_with_jobs: 0, rows: 0, charged_events: 0, info_rows: 0, reasons: {}, platforms: {},
    pages_fetched: 0, boards_failed: 0, stop_reason: 'done', results: [],
  };
  let stopped = false;

  const pushMiss = async (query, miss) => {
    await deps.pushData(missRow({ query, ...miss, fetchedAt: new Date(nowMs) }));
    summary.info_rows += 1;
    summary.reasons[miss.reason] = (summary.reasons[miss.reason] || 0) + 1;
    summary.results.push({ query, jobs: 0, reason: miss.reason, platform: miss.platform ?? null });
  };

  // Inputs claim their boards in input order (the first input naming a board reads it), while discovery runs in parallel.
  const gates = queries.map(() => { let open; const promise = new Promise((r) => { open = r; }); return { promise, open }; });
  async function one(query, i) {
    try {
      await company(query, i);
    } finally {
      gates[i].open();
    }
  }

  async function company(query, i) {
    if (stopped) return;
    if (!deadline.hasTimeFor(COMPANY_RESERVE_MS)) {
      summary.stop_reason = 'time_limit';
      await pushMiss(query, { reason: 'not_processed', detail: 'The run\'s time limit was reached before this company; run it again or raise the timeout.' });
      return;
    }
    let d;
    try {
      d = await discoverCompany(query, ctx);
    } catch (e) {
      log(`${query}: discovery failed: ${e.message}`);
      d = { miss: { reason: 'site_unreachable', detail: `Discovery failed: ${e.message}` }, pages: 0 };
    }
    summary.pages_fetched += d.pages || 0;
    if (d.miss) { log(`${query}: ${d.miss.reason}${d.miss.platform ? ` (${d.miss.platform})` : ''}`); await pushMiss(query, d.miss); return; }

    if (i > 0) await gates[i - 1].promise;
    const boards = [];
    const dupOf = [];
    for (const b of d.boards) {
      const k = boardKey(b);
      if (claimed.has(k)) { dupOf.push(claimed.get(k)); continue; }
      claimed.set(k, query);
      boards.push(b);
    }
    gates[i].open();
    if (!boards.length) {
      await pushMiss(query, { reason: 'duplicate_input', careersPageUrl: d.careersPageUrl, platform: d.boards[0].ats, sourceUrl: d.sourceUrl, detail: `Same job board as the input "${dupOf[0]}"; its jobs are delivered (and charged) once.` });
      return;
    }
    log(`${query}: ${boards.map(boardKey).join(', ')} (careers page ${d.careersPageUrl})`);
    let rows = 0;
    let s;
    try {
      const opts = { ...normalizeInput({ maxResults: maxJobs, includeDescription: true }), mode: 'live', boards };
      s = await runFeed(opts, {
        pushData: async (row) => {
          if (stopped) return;
          await deps.pushData(jobRow(row, { query, careersPageUrl: d.careersPageUrl }));
          rows += 1;
        },
        charge: async (ev) => {
          if (stopped) return { eventChargeLimitReached: true };
          const r = await deps.charge(ev);
          summary.charged_events += 1;
          if (r?.eventChargeLimitReached) { stopped = true; summary.stop_reason = 'charge_limit'; }
          return r;
        },
        fetchJson: deps.fetchJson, fetchText: deps.fetchText, pacer: atsPacer, robotsCache: ctx.robotsCache, deadline,
        now: () => nowMs, maxJobsPerBoard: maxJobs, log: (msg) => log(`${query}: ${msg}`),
      });
    } catch (e) {
      log(`${query}: job board read failed: ${e.message}`);
      s = { boards_ok: 0, failed_boards: [{ board: boards.map(boardKey).join(', '), status: null, failure_class: e.failureClass || 'unknown' }] };
    }
    summary.boards_failed += s.failed_boards?.length || 0;
    if (rows > 0) {
      summary.rows += rows;
      summary.companies_with_jobs += 1;
      for (const b of boards) summary.platforms[b.ats] = (summary.platforms[b.ats] || 0) + 1;
      summary.results.push({ query, jobs: rows, reason: null, platform: boards[0].ats });
      return;
    }
    if (stopped) return;
    const failed = s.failed_boards || [];
    const names = boards.map(boardKey).join(', ');
    let miss;
    if (s.boards_ok > 0) miss = { reason: 'ats_board_empty', detail: `The ${boards[0].ats} job board (${names}) lists no open job right now.` };
    else if (failed.length && failed.every((f) => f.robots)) miss = { reason: 'ats_board_disallowed', detail: `The job board's robots.txt does not allow reading it (${names}).` };
    else if (failed.length && failed.every((f) => f.status === 404 || f.status === 410)) miss = { reason: 'ats_board_not_found', detail: `The job-board link on the careers page is dead (HTTP 404: ${names}).` };
    else miss = { reason: 'ats_board_failed', detail: `The job board did not answer (${failed.map((f) => `${f.board}: ${f.status || f.failure_class}`).join('; ') || names}).` };
    await pushMiss(query, { ...miss, careersPageUrl: d.careersPageUrl, platform: boards[0].ats, sourceUrl: d.sourceUrl });
  }

  await mapLimit(queries, deps.concurrency || COMPANY_CONCURRENCY, (q, i) => one(q, i));
  return summary;
}
