#!/usr/bin/env node
// Build the sharded jobs index from boards.json using the Actor's own parsers.
//
//   node scripts/jobs_index/build_index.mjs                     # all boards -> scripts/jobs_index/index/
//   node scripts/jobs_index/build_index.mjs --limit 500         # first 500 boards (spread across ATSs)
//   node scripts/jobs_index/build_index.mjs --ats greenhouse,ashby --out /tmp/idx
//   node scripts/jobs_index/build_index.mjs --skip-ats workable --transport curl --codec br
//   node scripts/jobs_index/build_index.mjs --ats workday --limit 60 --workday-max-jobs 200 --out /tmp/wd
//   node scripts/jobs_index/build_index.mjs --ats personio,teamtailor --limit 200 --out /tmp/feeds
//
// Polite per-host limits (same as validate_boards.py): Greenhouse 8 parallel, Ashby 6,
// Recruitee 8, Workable 1 @ >=3s spacing, Lever <=8 in flight @ >=1s between request starts (robots.txt Crawl-delay),
// Workday 8 sites in parallel (one per host) @ >=150 ms between request starts across all Workday hosts, robots.txt
// checked per host. Personio / Teamtailor (career-site feeds, one host per company): 6 boards in parallel @ >=200 ms
// between request starts per platform, robots.txt of each host read (Accept: text/plain) before its feed.
// JazzHR / Pinpoint (career page / postings.json + job pages, one host per company): 4 resp. 3 boards in parallel @
// >=250 / 500 ms between request starts per platform, robots.txt of each host first, then each job page's path too.
//
// Workday budget: a site's jobs come 20 per request, so a 2,000-job site costs 100 requests. Each site keeps
// its newest --workday-max-jobs jobs, stops paging after --workday-site-budget-s, and the whole Workday queue
// stops starting sites after --workday-budget-min (it runs in parallel with the other ATSs, so it must end
// before the slowest of them, Workable at ~3 s per board). The site order rotates daily, so a budget cut
// skips different sites on different nights.
//
// Personio / Teamtailor budget: one feed request per board (+ robots.txt; Personio + one English feed when a position
// has no default-language description). Each platform's queue runs in parallel with the others, rotates daily
// and stops starting boards after --personio-budget-min / --teamtailor-budget-min, with its own 429 breaker.
//
// JazzHR / Pinpoint budget (career page / postings.json + job pages for the JSON-LD details; robots.txt per host
// first, one request in flight per host): each runs in its own parallel queue inside --jazzhr-budget-min /
// --pinpoint-budget-min, in two passes. Pass 1 reads the lists (robots.txt + one request per board); pass 2 reads job
// pages, only for jobs not read on an earlier night, at most --jazzhr-max-details / --pinpoint-max-details per board,
// while the budget lasts. State between nights: state/hosted/<ats>.json.gz (restored with the rest of state/): each
// board's last list and the trimmed job-page data.
//   - JazzHR: pass 1 only reads boards whose job set in JazzHR's public sitemaps changed since their last read (or that
//     are older than --jazzhr-refresh-days, or never read: those first); unchanged boards are carried over with their
//     original fetched_at. Without the sitemaps, all boards in daily-rotated order.
//   - A board not reached in pass 1 (budget) or failing transiently keeps its last list for <= --hosted-carry-days,
//     minus jobs that left the sitemaps.
// Technographics: with every board's jobs still holding their full description text, IndexWriter (option tech) also
// writes companies_tech.json.gz: per board, the technologies (src/core/tech.js) named in each kept job's title and
// description. No extra request; measured cost in build_report.json (companies_tech.extract_ms).
// Zero-token, deterministic. Needs node >= 22; imports only node builtins and the Actor's src/.
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { gzipSync, gunzipSync, createGzip } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../actors/ats-jobs-feed/src');
const { fetchBoard, compactDetail, readJobPages } = await import(join(SRC, 'feed.js'));
const { boardHost, mergeJobDetail } = await import(join(SRC, 'core/transform.js'));
const { robotsVerdict } = await import(join(SRC, 'core/robots.js'));
const { IndexWriter } = await import(join(SRC, 'index_writer.js'));
const { fetchJson, FetchError } = await import(join(SRC, 'lib/http.js'));
const execFileP = promisify(execFile);

const POLICY = {
  greenhouse: { workers: 8, gapMs: 0 },
  lever: { workers: 8, gapMs: 1000 }, // robots.txt Crawl-delay: 1 -> at most one request start per second
  ashby: { workers: 6, gapMs: 0 },
  workable: { workers: 1, gapMs: 3000 }, // ~3,650 requests at 1-2 req/s earned a 429 with Retry-After ~23h
  recruitee: { workers: 8, gapMs: 0 },
  // Career-site JSON (not a documented API): robots.txt checked per host, one site at a time per host,
  // <= 8.3 request starts/s across ~3,000 Workday tenant hosts (10 sites in flight). At 8/150 ms the
  // 85-min budget covered only 3,676 of 4,796 sites on GitHub runners (2026-10-20 build).
  workday: { workers: 10, gapMs: 120 },
  // Career-site feeds (Personio /xml, Teamtailor /jobs.rss): one host per company, robots.txt per host first.
  personio: { workers: 6, gapMs: 200 },
  teamtailor: { workers: 6, gapMs: 200 },
  // HTML career pages + job pages (JazzHR) / postings feed + job pages (Pinpoint): one request in flight per host
  // (a board's requests run one after another), <= 4 resp. 2 request starts/s across the platform. Pinpoint job pages
  // answer slowly (~2.3 s each, smoke run 2026-11-16), so 3 boards are in flight to use its 2/s.
  jazzhr: { workers: 4, gapMs: 250 },
  pinpoint: { workers: 3, gapMs: 500 },
};
const FEED_ATS = new Set(['personio', 'teamtailor']);
const HOSTED_ATS = new Set(['jazzhr', 'pinpoint']);
const ROBOTS_ATS = new Set(['workday', 'personio', 'teamtailor', 'jazzhr', 'pinpoint']);
const HOSTED_STATE = join(HERE, 'state', 'hosted');
// JazzHR's public job sitemaps (listed in every applytojob.com robots.txt): which jobs are live, per company.
const JAZZ_SITEMAP = (n) => `http://app.jazz.co/feeds/google/xml/${n}`;
const JAZZ_SITEMAP_ROBOTS = 'https://app.jazz.co/robots.txt';

const { values: args } = parseArgs({
  options: {
    boards: { type: 'string', default: join(HERE, 'boards.json') },
    out: { type: 'string', default: join(HERE, 'index') },
    limit: { type: 'string', default: '0' },
    ats: { type: 'string', default: '' },
    // "curl" routes requests through the curl binary, which honours HTTP(S)_PROXY (Node 22's fetch
    // does not); useful in sandboxes that only have a proxied route out.
    transport: { type: 'string', default: 'fetch' },
    codec: { type: 'string', default: 'br' }, // br (brotli q11, 16 MB window) or gz
    'skip-ats': { type: 'string', default: '' }, // e.g. workable while it is rate-limit banned
    'workday-max-jobs': { type: 'string', default: '300' }, // newest N jobs per Workday site (20 per request)
    'workday-site-budget-s': { type: 'string', default: '90' }, // stop paging one site after this long
    'workday-budget-min': { type: 'string', default: '85' }, // stop starting Workday sites after this long
    'personio-budget-min': { type: 'string', default: '45' }, // stop starting Personio boards after this long
    'teamtailor-budget-min': { type: 'string', default: '45' }, // stop starting Teamtailor boards after this long
    'teamtailor-max-jobs': { type: 'string', default: '1000' }, // newest-first pages of 100 per Teamtailor site
    'jazzhr-budget-min': { type: 'string', default: '80' }, // stop starting JazzHR boards after this long
    'pinpoint-budget-min': { type: 'string', default: '30' }, // stop starting Pinpoint boards after this long
    'jazzhr-max-details': { type: 'string', default: '15' }, // new job pages read per JazzHR board per night
    'pinpoint-max-details': { type: 'string', default: '10' }, // new job pages read per Pinpoint board per night
    'jazzhr-refresh-days': { type: 'string', default: '7' }, // re-read an unchanged JazzHR board after this long
    'hosted-carry-days': { type: 'string', default: '3' }, // carry a board not read tonight for at most this long
    'jazzhr-sitemaps': { type: 'string', default: '5' }, // sitemap files to read (0 = none)
    // companies_tech.json.gz: technologies named in each job's title + full description (companies-by-technology).
    // Pure CPU on text already in memory (no extra request); --no-tech skips it.
    'no-tech': { type: 'boolean', default: false },
    // Boards fetched elsewhere (scripts/jobs_index/workday_local.sh on the owner's Mac: Workday answers robots.txt 429 to
    // cloud IPs since 2026-11-16). --emit-boards writes every board this run adds (board, name, jobs) as gzipped JSON lines
    // + a final {"_end": ...} line; --boards-from reads such a file and adds its boards instead of fetching their ATSs,
    // when it is complete, <= --boards-from-max-age-h old and has >= --boards-from-min-boards boards (else: fetch as usual).
    'emit-boards': { type: 'string', default: '' },
    'boards-from': { type: 'string', default: '' },
    'boards-from-max-age-h': { type: 'string', default: '36' },
    'boards-from-min-boards': { type: 'string', default: '500' },
  },
});

const UA = 'factpipe-jobs-index/1.0 (+https://apify.com/factpipe; job-board syndication)';
const ROBOTS_AGENT = 'factpipe-jobs-index';

/** fetchJson-compatible GET/POST via curl, with the same retry/failure-class semantics as lib/http.js. */
async function curlJson(url, { retries = 3, timeoutMs = 180000, minDelayMs = 2000, method = 'GET', body } = {}) {
  let lastErr;
  const post = method === 'POST' ? ['-X', 'POST', '-H', 'content-type: application/json', '--data-binary', JSON.stringify(body ?? {})] : [];
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt) await new Promise((r) => setTimeout(r, minDelayMs * 2 ** (attempt - 1)));
    let out;
    try {
      ({ stdout: out } = await execFileP('curl', ['-sS', '-L', '--compressed', '--max-time', String(Math.ceil(timeoutMs / 1000)),
        '-A', UA, '-H', 'accept: application/json', '-H', 'accept-language: en-US', ...post, '-w', '\n%{http_code}', url], { maxBuffer: 512 * 1024 * 1024 }));
    } catch (e) {
      lastErr = new FetchError(`curl failed at ${url}: ${String(e.stderr || e.message).trim().slice(0, 200)}`, e.code === 28 ? 'timeout' : 'site_down');
      continue;
    }
    const nl = out.lastIndexOf('\n');
    const status = Number(out.slice(nl + 1));
    const body = out.slice(0, nl);
    if (status === 403 || status === 429) { lastErr = new FetchError(`HTTP ${status} at ${url}`, 'blocked', status); continue; }
    if (status >= 500) { lastErr = new FetchError(`HTTP ${status} at ${url}`, 'site_down', status); continue; }
    if (status < 200 || status >= 300) throw new FetchError(`HTTP ${status} at ${url}`, 'http_error', status);
    try { return JSON.parse(body); } catch { throw new FetchError(`Non-JSON response at ${url}`, 'schema_change', status); }
  }
  throw lastErr;
}

/**
 * fetchText-compatible GET for robots.txt (Workday, Personio, Teamtailor hosts) and the Personio / Teamtailor feeds:
 * opts { accept, meta, retries, timeoutMs } like defaultFetchText in core/feed.js. 429 / 5xx / network errors are
 * retried with backoff; other HTTP errors throw a FetchError with .status. Company pages are never fetched here
 * (names come from boards.json).
 */
async function getText(url, { accept = null, meta = false, retries = 2, timeoutMs = 60000 } = {}) {
  if (!url.endsWith('/robots.txt') && !/\/xml(?:\?language=en)?$|\/jobs\.rss(?:\?offset=\d+)?$/.test(url)
    && !/^https:\/\/[a-z0-9-]+\.applytojob\.com\/apply(?:\/[A-Za-z0-9]{6,80}\/[^/?#]*)?$/.test(url)
    && !/^https:\/\/[a-z0-9-]+\.pinpointhq\.com\/(?:postings\.json|(?:[a-z]{2}(?:-[A-Za-z]{2})?\/)?postings\/[0-9a-f-]{8,})$/.test(url)
    && !/^http:\/\/app\.jazz\.co\/feeds\/google\/xml\/\d$/.test(url)) throw new Error(`name from boards.json, not ${url}`);
  let last;
  for (let a = 0; a <= retries; a += 1) {
    if (a) await new Promise((r) => setTimeout(r, 2000 * 2 ** (a - 1)));
    let status;
    let text;
    let contentType;
    try {
      if (args.transport === 'curl') {
        const { stdout } = await execFileP('curl', ['-sS', '-L', '--compressed', '--max-time', String(Math.ceil(timeoutMs / 1000)), '-A', UA,
          ...(accept ? ['-H', `accept: ${accept}`] : []), '-w', '\n%{http_code} %{content_type}', url], { maxBuffer: 256 * 1024 * 1024 });
        const nl = stdout.lastIndexOf('\n');
        const tail = stdout.slice(nl + 1);
        status = Number(tail.split(' ')[0]);
        contentType = tail.slice(tail.indexOf(' ') + 1);
        text = stdout.slice(0, nl);
      } else {
        const res = await fetch(url, { headers: { 'User-Agent': UA, ...(accept ? { accept } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        status = res.status;
        contentType = res.headers.get('content-type') || '';
        text = await res.text();
      }
    } catch (e) {
      last = new FetchError(`GET failed at ${url}: ${String(e.stderr || e.message).trim().slice(0, 200)}`, e.code === 28 || e.name === 'TimeoutError' ? 'timeout' : 'site_down');
      continue;
    }
    if (status === 429 || status >= 500) { last = new FetchError(`HTTP ${status} at ${url}`, status === 429 ? 'blocked' : 'site_down', status); continue; }
    if (status < 200 || status >= 300) throw new FetchError(`HTTP ${status} at ${url}`, status === 403 ? 'blocked' : 'http_error', status);
    return meta ? { status, text, contentType } : text;
  }
  throw last;
}

/** Rotate a list by the day of the year, so a budget cut skips different items on different days. */
function rotateDaily(list, now = new Date()) {
  if (!list.length) return list;
  const day = Math.floor(now.getTime() / 86400000);
  const k = (day * 997) % list.length;
  return [...list.slice(k), ...list.slice(0, k)];
}

function pacer(gapMs) {
  let next = 0;
  let gap = gapMs;
  const wait = async () => {
    if (!gap) return;
    const now = Date.now();
    const ms = Math.max(0, next - now);
    next = Math.max(now, next) + gap;
    if (ms) await new Promise((r) => setTimeout(r, ms));
  };
  // After a rate limit: double the spacing between request starts (at most RATE_LIMIT.maxGapMs), for the rest of the build.
  wait.slow = () => { gap = Math.min(RATE_LIMIT.maxGapMs, Math.max(gap * 2, 250)); return gap; };
  // After RATE_LIMIT.speedUpAfter successful boards in a row: halve it again, never below the platform's own spacing.
  wait.fast = () => { gap = Math.max(gapMs, Math.floor(gap / 2)); return gap; };
  wait.gap = () => gap;
  return wait;
}

// Rate limits (HTTP 429 on any request of a platform, robots.txt included): the platform's queue pauses (30 s, doubling,
// at most 5 min), its pacing slows down, and the boards that got the 429 go back to the end of the queue (at most 2
// retries each); after `speedUpAfter` successful boards in a row the spacing halves again, down to the platform's own.
// robots.txt rule R1 is unchanged: a board is never read until its host's robots.txt was read with a 2xx.
// The queue stops for the night after `maxCooldowns` pauses in a row without one successful board, or at once when a host
// asks for more than `stopRetryAfterMs` via Retry-After.
const RATE_LIMIT = { firstCooldownMs: 30000, maxCooldownMs: 300000, maxCooldowns: 16, maxGapMs: 2000, retriesPerBoard: 2,
  speedUpAfter: 50, stopRetryAfterMs: 600000 };
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

// ------------------------------------------------------------------ JazzHR / Pinpoint state between nights
/** state/hosted/<ats>.json.gz -> { boards: {token: {name, fetched_at, jobs}}, details: {job_id: detail} } */
async function loadHosted(ats) {
  try {
    const d = JSON.parse(gunzipSync(await readFile(join(HOSTED_STATE, `${ats}.json.gz`))).toString('utf8'));
    return { boards: d.boards || {}, details: d.details || {} };
  } catch { return { boards: {}, details: {} }; }
}

async function saveHosted(ats, state) {
  // Keep details only for jobs still listed on a kept board.
  const live = new Set();
  for (const b of Object.values(state.boards)) for (const j of b.jobs) live.add(j.job_id);
  const details = Object.fromEntries(Object.entries(state.details).filter(([id]) => live.has(id)));
  await mkdir(HOSTED_STATE, { recursive: true });
  const tmp = join(HOSTED_STATE, `${ats}.json.gz.tmp`);
  await writeFile(tmp, gzipSync(Buffer.from(JSON.stringify({ version: 1, saved_at: new Date().toISOString(), boards: state.boards, details })), { level: 6 }));
  await rename(tmp, join(HOSTED_STATE, `${ats}.json.gz`));
  return { boards: Object.keys(state.boards).length, jobs: live.size, details: Object.keys(details).length };
}

/**
 * JazzHR's public sitemaps -> Map(token -> Set(job id)) of live jobs, or null (robots.txt of app.jazz.co does not
 * allow them, or a file failed: then every board is read in rotated order instead).
 */
async function jazzSitemaps(n) {
  if (!n) return null;
  const robots = await getText(JAZZ_SITEMAP_ROBOTS, { accept: 'text/plain', meta: true, retries: 1, timeoutMs: 30000 })
    .catch((e) => (e?.status ? { status: e.status, text: '' } : { error: e?.message || 'unreachable' }));
  const v = robotsVerdict(robots, ROBOTS_AGENT, ['/feeds/google/xml/0']);
  if (!v.allowed) { console.error(`  jazzhr sitemaps not read: ${v.reason}`); return null; }
  const live = new Map();
  for (let i = 0; i < n; i += 1) {
    let xml;
    try { xml = await getText(JAZZ_SITEMAP(i), { accept: 'application/xml, text/xml;q=0.9, */*;q=0.1', retries: 2, timeoutMs: 300000 }); } catch (e) {
      if (e?.status === 404) break;
      console.error(`  jazzhr sitemap ${i} failed (${e.message}): boards are read in rotated order tonight`);
      return null;
    }
    let found = 0;
    for (const m of xml.matchAll(/<loc>\s*https?:\/\/([a-z0-9][a-z0-9-]*)\.applytojob\.com\/apply\/([A-Za-z0-9]{6,80})[/?<]/gi)) {
      const tok = m[1].toLowerCase();
      (live.get(tok) || live.set(tok, new Set()).get(tok)).add(m[2]);
      found += 1;
    }
    if (!found) break;
  }
  return live.size ? live : null;
}

/** JazzHR job id of a job record ("jazzhr:<token>:<id>"). */
const jazzId = (job) => String(job.job_id).split(':').pop();

/**
 * Order tonight's JazzHR / Pinpoint boards and pick the ones carried over without a request:
 * -> { order: boards to read, carry: boards reused from the cache, unchanged: Set(token) }.
 * JazzHR: boards whose sitemap jobs changed (or never read) are read, never-read first, in daily-rotated order;
 * unchanged boards are carried from the cache (pass 2 still reads their missing job pages).
 */
function planHosted(ats, list, state, live, { refreshDays, carryDays, now = Date.now() }) {
  const ageDays = (b) => (now - Date.parse(b?.fetched_at || 0)) / 86400000;
  if (ats !== 'jazzhr' || !live) return { order: rotateDaily(list), carry: [], unchanged: new Set() };
  const order = [];
  const carry = [];
  const unchanged = new Set();
  for (const b of list) {
    const tok = String(b.token).toLowerCase();
    const cached = state.boards[tok];
    const ids = live.get(tok);
    if (!ids) { order.push({ b, fresh: 1 }); continue; } // no live job in the sitemaps tonight: read it to confirm
    // Compare with the board's sitemap entries when it was last read (a career page can list jobs the sitemaps
    // leave out, so its own job list is only the fallback for caches written before `sm` existed).
    const known = new Set(cached?.sm || (cached?.jobs || []).map(jazzId));
    const fresh = [...ids].filter((id) => !known.has(id)).length;
    const gone = [...known].filter((id) => !ids.has(id)).length;
    if (cached && !fresh && !gone && ageDays(cached) < refreshDays) {
      unchanged.add(tok);
      carry.push(b); // no list request; pass 2 still reads its missing job pages
    } else order.push({ b, fresh: cached ? fresh + gone : ids.size + 1e6 }); // never-read boards first
  }
  const rotated = rotateDaily(order);
  rotated.sort((x, y) => (y.fresh >= 1e6) - (x.fresh >= 1e6)); // stable: never-read boards first, each group in rotated order
  return { order: rotated.map((x) => x.b), carry, unchanged };
}

/** Read a --emit-boards file -> { ok, reason, end, items }. Never throws (a bad file means: fetch as usual). */
export async function readBoardsFile(path, { maxAgeH = 36, minBoards = 500, now = Date.now() } = {}) {
  let text;
  try { text = gunzipSync(await readFile(path)).toString('utf8'); } catch (e) { return { ok: false, reason: `unreadable: ${e.message}`.slice(0, 200), items: [] }; }
  const lines = text.split('\n').filter(Boolean);
  let end = null;
  const items = [];
  for (const l of lines) {
    let o;
    try { o = JSON.parse(l); } catch { return { ok: false, reason: 'corrupt line', items: [] }; }
    if (o._end) { end = o; break; }
    if (o?.board?.ats && o.board.token && Array.isArray(o.jobs)) items.push(o);
  }
  if (!end) return { ok: false, reason: 'incomplete (no _end line)', items: [] };
  const ageH = (now - Date.parse(end.built_at)) / 3600000;
  if (!(ageH <= maxAgeH)) return { ok: false, reason: `stale: built ${end.built_at} (${ageH.toFixed(1)} h > ${maxAgeH} h)`, end, items: [] };
  if (items.length < minBoards) return { ok: false, reason: `too few boards: ${items.length} < ${minBoards}`, end, items: [] };
  return { ok: true, reason: null, end, items };
}

async function main() {
  const t0 = Date.now();
  let boards = JSON.parse(await readFile(args.boards, 'utf8'));
  const only = new Set(args.ats.split(',').filter(Boolean));
  if (only.size) boards = boards.filter((b) => only.has(b.ats));
  const skip = new Set(args['skip-ats'].split(',').filter(Boolean));
  // Honour rate-limit bans recorded by validate_boards.py (state/bans.json).
  try {
    const bans = JSON.parse(await readFile(join(HERE, 'state', 'bans.json'), 'utf8'));
    for (const [ats, until] of Object.entries(bans)) if (until * 1000 > Date.now()) { skip.add(ats); console.error(`${ats}: skipped, banned until ${new Date(until * 1000).toISOString()}`); }
  } catch { /* no bans */ }
  if (skip.size) boards = boards.filter((b) => !skip.has(b.ats));
  const limit = Number(args.limit) || 0;
  if (limit && boards.length > limit) {
    // Round-robin across ATSs so a subset build is representative.
    const byAts = new Map();
    for (const b of boards) (byAts.get(b.ats) || byAts.set(b.ats, []).get(b.ats)).push(b);
    const picked = [];
    const lists = [...byAts.values()];
    for (let i = 0; picked.length < limit; i += 1) {
      let any = false;
      for (const l of lists) if (i < l.length && picked.length < limit) { picked.push(l[i]); any = true; }
      if (!any) break;
    }
    boards = picked;
  }
  let fromFile = null;
  if (args['boards-from']) {
    fromFile = await readBoardsFile(args['boards-from'], { maxAgeH: Number(args['boards-from-max-age-h']) || 36,
      minBoards: Number(args['boards-from-min-boards']) || 0 });
    fromFile.ats = [...new Set(fromFile.items.map((it) => it.board.ats))];
    if (fromFile.ok) {
      boards = boards.filter((b) => !fromFile.ats.includes(b.ats));
      console.error(`boards from ${args['boards-from']}: ${fromFile.items.length} boards (${fromFile.ats.join(', ')}, built ${fromFile.end.built_at}) - not fetched tonight`);
    } else {
      console.error(`boards from ${args['boards-from']} NOT used (${fromFile.reason}) - fetching as usual`);
    }
  }
  console.error(`building index from ${boards.length} boards -> ${args.out}`);
  const writer = await new IndexWriter(resolve(args.out), { builtAt: new Date(), codec: args.codec, tech: !args['no-tech'] }).open();
  const stats = { ok: 0, failed: 0, empty: 0, by_ats: {} };
  // --emit-boards: every board added to the index is also written out (lines in add order, addBoard calls are serialized).
  let emit = null;
  if (args['emit-boards']) {
    const gz = createGzip();
    const done = new Promise((res, rej) => { gz.pipe(createWriteStream(args['emit-boards'])).on('finish', res).on('error', rej); });
    emit = { gz, done, boards: 0, jobs: 0 };
    const add = writer.addBoard.bind(writer);
    writer.addBoard = async (board, name, jobs) => {
      if (jobs?.length) {
        if (!emit.gz.write(`${JSON.stringify({ board, name, jobs })}\n`)) await new Promise((r) => emit.gz.once('drain', r));
        emit.boards += 1;
        emit.jobs += jobs.length;
      }
      return add(board, name, jobs);
    };
  }
  if (fromFile?.ok) {
    for (const it of fromFile.items) {
      await writer.addBoard(it.board, it.name, it.jobs);
      const s = stats.by_ats[it.board.ats] || (stats.by_ats[it.board.ats] = { boards: 0, jobs: 0, failed: 0, source: 'boards-from', fetched: fromFile.end.built_at });
      s.boards += 1;
      s.jobs += it.jobs.length;
      stats.ok += 1;
    }
    fromFile.items = []; // free the memory
  }
  const failures = [];
  const queues = new Map();
  for (const b of boards) (queues.get(b.ats) || queues.set(b.ats, []).get(b.ats)).push(b);
  for (const a of ['workday', ...FEED_ATS]) if (queues.has(a)) queues.set(a, rotateDaily(queues.get(a)));
  // JazzHR / Pinpoint: cached state from earlier nights, tonight's JazzHR sitemaps, read order + carry-over.
  const hosted = {};
  const hostedCfg = {
    refreshDays: Number(args['jazzhr-refresh-days']) || 7,
    carryDays: Number(args['hosted-carry-days']) || 3,
    maxDetails: { jazzhr: Number(args['jazzhr-max-details']) || 0, pinpoint: Number(args['pinpoint-max-details']) || 0 },
  };
  /** Load a JazzHR / Pinpoint queue's state + (JazzHR) tonight's sitemaps -> its read order. Runs inside that queue, so the
   * sitemap download never delays the other platforms. */
  async function prepareHosted(a, list) {
    const state = await loadHosted(a);
    const ts = Date.now();
    const live = a === 'jazzhr' ? await jazzSitemaps(Number(args['jazzhr-sitemaps'])) : null;
    if (a === 'jazzhr') console.error(`  jazzhr sitemaps read in ${((Date.now() - ts) / 1000).toFixed(0)}s`);
    const { order, carry, unchanged } = planHosted(a, list, state, live, hostedCfg);
    hosted[a] = { state, live, carry, unchanged, pass2: [], carried_unchanged: carry.length, carried_boards: 0, carried_jobs: 0, sitemap_boards: live ? live.size : null };
    console.error(`  ${a}: ${order.length} boards to read, ${carry.length} unchanged boards carried over${live ? ` (sitemaps: ${live.size} companies)` : ''}`);
    return order;
  }
  /** Cached jobs of a board (with cached job-page details), for a board not read tonight; [] when too old. */
  const carriedJobs = (a, b, { requireFresh = true } = {}) => {
    const h = hosted[a];
    const cached = h?.state.boards[String(b.token).toLowerCase()];
    if (!cached || (requireFresh && (Date.now() - Date.parse(cached.fetched_at || 0)) / 86400000 > hostedCfg.carryDays)) return null;
    // Drop jobs that left the sitemaps since the board was read (closed); jobs the sitemaps never listed stay.
    const ids = h.live?.get(String(b.token).toLowerCase()) || new Set();
    const listedThen = new Set(cached.sm || []);
    const jobs = cached.jobs.filter((j) => !h.live || ids.has(jazzId(j)) || !listedThen.has(jazzId(j)))
      .map((j) => mergeJobDetail(j, h.state.details[j.job_id]));
    return { name: cached.name, jobs };
  };
  // Per-queue time budgets: no new board of that platform after this point (each runs in parallel with the others).
  const queueEndsAt = {
    workday: t0 + (Number(args['workday-budget-min']) || 85) * 60000,
    jazzhr: t0 + (Number(args['jazzhr-budget-min']) || 80) * 60000,
    pinpoint: t0 + (Number(args['pinpoint-budget-min']) || 30) * 60000,
    personio: t0 + (Number(args['personio-budget-min']) || 45) * 60000,
    teamtailor: t0 + (Number(args['teamtailor-budget-min']) || 45) * 60000,
  };
  const wdCfg = {
    maxJobs: Number(args['workday-max-jobs']) || 300,
    siteBudgetMs: (Number(args['workday-site-budget-s']) || 90) * 1000,
    endsAt: queueEndsAt.workday,
  };
  const wdDeadline = { hasTimeFor: () => Date.now() < wdCfg.endsAt };
  const robotsCache = new Map();
  const busyHosts = new Set();
  const hostOf = (b) => String(b.token).split('/')[0].toLowerCase();
  let addLock = Promise.resolve();
  let done = 0;

  await Promise.all([...queues.entries()].map(async ([ats, queued]) => {
    const list = HOSTED_ATS.has(ats) ? await prepareHosted(ats, queued) : queued;
    const pol = POLICY[ats] || { workers: 2, gapMs: 500 };
    const wait = pacer(pol.gapMs);
    let next = 0;
    const getJson = args.transport === 'curl' ? curlJson : fetchJson;
    const politeFetchJson = async (url, opts) => { await wait(); return getJson(url, { ...opts, retries: 3, timeoutMs: 180000, minDelayMs: 2000 }); };
    const politeFetchText = async (url) => { throw new Error(`name from boards.json, not ${url}`); };
    // robots.txt and feeds of the career-site platforms, paced with the platform's other requests.
    const politeGetText = async (url, opts) => { await wait(); return getText(url, opts); };
    let pauseUntil = 0; // rate-limit cooldown of this ATS's queue (all workers wait)
    let cooldowns = 0; // pauses in a row without a successful board in between
    let stopped = false; // circuit breaker tripped: no more boards of this ATS tonight
    const tries = new Map(); // board -> rate-limited attempts
    let okStreak = 0; // successful boards since the last 429 (or the last speed-up)
    const ok429 = () => {
      cooldowns = 0;
      okStreak += 1;
      if (okStreak >= RATE_LIMIT.speedUpAfter && wait.gap() > pol.gapMs) { okStreak = 0; wait.fast(); }
    };
    await Promise.all(Array.from({ length: pol.workers }, async () => {
      while (next < list.length) {
        if (!stopped && pauseUntil > Date.now() && !(queueEndsAt[ats] && Date.now() >= queueEndsAt[ats])) {
          await sleep(Math.min(pauseUntil, queueEndsAt[ats] || Infinity) - Date.now());
          continue;
        }
        if (queueEndsAt[ats] && Date.now() >= queueEndsAt[ats]) {
          const rest = list.slice(next);
          next = list.length; // claim the rest before any await (the other workers stop here)
          stats.skipped_budget = (stats.skipped_budget || 0) + rest.length;
          (stats.skipped_budget_by_ats ||= {})[ats] = (stats.skipped_budget_by_ats[ats] || 0) + rest.length;
          console.error(`  ${ats}: time budget spent - skipping its remaining ${rest.length} boards this build`);
          if (HOSTED_ATS.has(ats)) {
            // Boards not reached tonight keep their last read (<= --hosted-carry-days old, JazzHR jobs filtered by tonight's sitemaps).
            for (const b of rest) {
              const c = carriedJobs(ats, b, { requireFresh: !hosted[ats].unchanged.has(String(b.token).toLowerCase()) });
              if (!c?.jobs.length) continue;
              addLock = addLock.then(() => writer.addBoard({ ats: b.ats, token: b.token }, c.name || b.name || b.token, c.jobs));
              await addLock;
              hosted[ats].carried_boards += 1;
              hosted[ats].carried_jobs += c.jobs.length;
            }
          }
          break;
        }
        if (stopped || cooldowns > RATE_LIMIT.maxCooldowns) {
          if (next < list.length) {
            stats.skipped_rate_limited = (stats.skipped_rate_limited || 0) + (list.length - next);
            (stats.skipped_rate_limited_by_ats ||= {})[ats] = (stats.skipped_rate_limited_by_ats[ats] || 0) + (list.length - next);
            console.error(`  ${ats}: still rate-limited after ${RATE_LIMIT.maxCooldowns} pauses - skipping its remaining ${list.length - next} boards this build`);
          }
          stopped = true;
          next = list.length;
          break;
        }
        if (ats === 'workday') {
          // One site at a time per Workday host (tenant): take the next site whose host is idle.
          let i = next;
          while (i < list.length && busyHosts.has(hostOf(list[i]))) i += 1;
          if (i === list.length) { await new Promise((r) => setTimeout(r, 200)); continue; }
          [list[next], list[i]] = [list[i], list[next]];
        }
        const b = list[next];
        next += 1;
        const host = ats === 'workday' ? hostOf(b) : null;
        if (host) busyHosts.add(host);
        const board = { ats: b.ats, token: b.token, ...(b.region ? { region: b.region } : {}) };
        const s = stats.by_ats[ats] || (stats.by_ats[ats] = { boards: 0, jobs: 0, failed: 0 });
        const bt0 = Date.now();
        try {
          // robots.txt is fetched once per host (shared cache across workers): count it for the board that needed it.
          const newHost = ROBOTS_ATS.has(ats) && !robotsCache.has(boardHost(board));
          const hs = hosted[ats]?.state;
          const known = hs ? { get: (id) => hs.details[id] } : null;
          const r = await fetchBoard(board, HOSTED_ATS.has(ats)
            ? { fetchText: politeGetText, skipName: true, robotsCache, robotsAgent: ROBOTS_AGENT, feedTimeoutMs: 90000,
              maxDetails: 0, knownDetails: known } // job pages in pass 2, after every board's list
            : ats === 'workday'
            ? { fetchJson: politeFetchJson, fetchText: politeGetText, skipName: true, maxJobs: wdCfg.maxJobs, budgetMs: wdCfg.siteBudgetMs,
              deadline: wdDeadline, robotsCache, robotsAgent: ROBOTS_AGENT }
            : FEED_ATS.has(ats)
              ? { fetchText: politeGetText, skipName: true, robotsCache, robotsAgent: ROBOTS_AGENT, feedTimeoutMs: 90000,
                maxJobs: Number(args['teamtailor-max-jobs']) || 1000 }
              : { fetchJson: politeFetchJson, fetchText: politeFetchText });
          if (ROBOTS_ATS.has(ats)) {
            // Per-board cost: requests (feed / list pages + robots.txt fetches of new hosts) and wall time.
            s.requests = (s.requests || 0) + (r.pages ?? r.requests ?? 0) + (newHost ? 1 : 0);
            s.seconds = Math.round(((s.seconds || 0) + (Date.now() - bt0) / 1000) * 10) / 10;
            if (ats === 'workday') s.listed_total = (s.listed_total || 0) + (r.total || 0);
            if (r.truncated) s.truncated = (s.truncated || 0) + 1;
          }
          if (hs) {
            s.jobs_robots_dropped = (s.jobs_robots_dropped || 0) + r.robots_dropped;
            const tok = String(b.token).toLowerCase();
            if (r.jobs.length) {
              // The list result, without the description when the job page holds it (JazzHR: kept in details).
              hs.boards[tok] = { name: r.company_name || b.name || b.token, fetched_at: r.jobs[0].fetched_at,
                ...(hosted[ats].live ? { sm: [...(hosted[ats].live.get(tok) || [])] } : {}),
                jobs: r.jobs.map((j) => ({ ...j, description_text: ats === 'jazzhr' ? null : (j.description_text || '').slice(0, 1500) || null })) };
              hosted[ats].pass2.push({ board, name: r.company_name || b.name || b.token, jobs: r.jobs, read: true });
            } else { delete hs.boards[tok]; stats.empty += 1; }
            ok429();
            continue;
          }
          const name = r.company_name || b.name || b.token;
          // Personio: a position's own <subcompany> stays; otherwise the directory name replaces the token.
          const own = (j) => ats === 'personio' && j.company_name && j.company_name !== String(b.token);
          const jobs = r.jobs.map((j) => ({ ...j, company_name: r.company_name || own(j) ? j.company_name : name }));
          addLock = addLock.then(() => writer.addBoard(board, name, jobs));
          await addLock;
          if (jobs.length) { stats.ok += 1; s.boards += 1; s.jobs += jobs.length; } else { stats.empty += 1; }
          ok429();
        } catch (e) {
          if (e.status === 429) {
            okStreak = 0;
            s.rate_limited = (s.rate_limited || 0) + 1;
            if (e.retryAfterMs > RATE_LIMIT.stopRetryAfterMs) {
              stopped = true;
              console.error(`  ${ats}: HTTP 429 with Retry-After ${Math.round(e.retryAfterMs / 1000)} s - stopping this ATS for tonight`);
            } else if (pauseUntil <= Date.now()) {
              cooldowns += 1;
              const base = Math.min(RATE_LIMIT.maxCooldownMs, RATE_LIMIT.firstCooldownMs * 2 ** (cooldowns - 1));
              pauseUntil = Date.now() + Math.max(base, e.retryAfterMs || 0);
              const gap = wait.slow();
              s.cooldowns = (s.cooldowns || 0) + 1;
              s.gap_ms = gap;
              console.error(`  ${ats}: HTTP 429 (${e.robots ? 'robots.txt' : 'data'}) - pause ${Math.round((pauseUntil - Date.now()) / 1000)} s, then ${gap} ms between requests`);
            }
            const n = (tries.get(b) || 0) + 1;
            tries.set(b, n);
            if (!stopped && n <= RATE_LIMIT.retriesPerBoard) {
              list.push(b); // read it again after the pause
              s.requeued = (s.requeued || 0) + 1;
              continue;
            }
          }
          if (hosted[ats]) {
            // Gone (404/410) or disallowed: forget it. A transient failure keeps last night's jobs (carry-over rules).
            const tok = String(b.token).toLowerCase();
            if ((e.robots && !e.transient) || e.status === 404 || e.status === 410) delete hosted[ats].state.boards[tok];
            else {
              const c = carriedJobs(ats, b);
              if (c?.jobs.length) {
                addLock = addLock.then(() => writer.addBoard(board, c.name || b.name || b.token, c.jobs));
                await addLock;
                hosted[ats].carried_boards += 1;
                hosted[ats].carried_jobs += c.jobs.length;
              }
            }
          }
          if (e.robots) {
            // robots.txt disallows (or could not be read: 429 / 5xx / unreachable): the feed / site was never called
            s.skipped_robots = (s.skipped_robots || 0) + 1;
            const why = e.message.replace(/^.*skipped: /, '').replace(/disallows \/.*$/, 'disallows a path we read');
            s.robots_reasons ||= {};
            s.robots_reasons[why] = (s.robots_reasons[why] || 0) + 1;
          }
          stats.failed += 1;
          s.failed += 1;
          failures.push({ ats, token: b.token, status: e.status ?? null, failure_class: e.failureClass || 'unknown' });
        } finally {
          if (host) busyHosts.delete(host);
        }
        done += 1;
        if (done % 200 === 0) console.error(`  ${done}/${boards.length} boards, ${writer.rawJobs} jobs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    }));
    if (!HOSTED_ATS.has(ats)) return;
    // Pass 2 (JazzHR / Pinpoint): job pages of jobs not read on an earlier night, while the queue's budget lasts:
    // first the boards read tonight, then unchanged boards (sitemaps) that still have jobs without page data. Every
    // board is then added to the index, with or without new page data.
    const h = hosted[ats];
    const s = stats.by_ats[ats] || (stats.by_ats[ats] = { boards: 0, jobs: 0, failed: 0 });
    const known = { get: (id) => h.state.details[id] };
    const items = [...h.pass2];
    for (const b of h.carry) {
      const c = carriedJobs(ats, b, { requireFresh: false });
      if (c?.jobs.length) items.push({ board: { ats: b.ats, token: b.token }, name: c.name || b.name || b.token, jobs: c.jobs, read: false });
    }
    h.carry = [];
    const deadline = { hasTimeFor: (ms) => Date.now() + ms < queueEndsAt[ats] + 60000 };
    let k = 0;
    await Promise.all(Array.from({ length: pol.workers }, async () => {
      while (k < items.length) {
        const it = items[k];
        k += 1;
        let jobs = it.jobs;
        if (Date.now() < queueEndsAt[ats] && hostedCfg.maxDetails[ats] > 0 && jobs.some((j) => !(j.job_id in h.state.details))) {
          try {
            const p = await readJobPages(it.board, jobs, { fetchText: politeGetText, robotsCache, robotsAgent: ROBOTS_AGENT,
              maxDetails: hostedCfg.maxDetails[ats], knownDetails: known, deadline });
            s.requests = (s.requests || 0) + p.requests;
            s.job_pages_read = (s.job_pages_read || 0) + p.details.size;
            s.job_pages_failed = (s.job_pages_failed || 0) + p.details_failed;
            s.jobs_closed_on_page = (s.jobs_closed_on_page || 0) + p.closed;
            for (const [id, d] of p.details) h.state.details[id] = compactDetail(d, ats === 'jazzhr');
            for (const id of p.no_data) h.state.details[id] = {}; // page without JobPosting data: not read again
            if (p.closed) {
              const open = new Set(p.jobs.map((j) => j.job_id));
              const cb = h.state.boards[String(it.board.token).toLowerCase()];
              if (cb) cb.jobs = cb.jobs.filter((j) => open.has(j.job_id));
            }
            jobs = p.jobs;
          } catch (e) { /* job pages are an extra: the list stands */ }
        }
        if (!jobs.length) continue;
        addLock = addLock.then(() => writer.addBoard(it.board, it.name, jobs));
        await addLock;
        if (it.read) { stats.ok += 1; s.boards += 1; s.jobs += jobs.length; } else { h.carried_boards += 1; h.carried_jobs += jobs.length; }
      }
    }));
  }));

  // Unchanged JazzHR boards (same live jobs in tonight's sitemaps, read < --jazzhr-refresh-days ago).
  const hostedReport = {};
  for (const [a, h] of Object.entries(hosted)) {
    for (const b of h.carry) {
      const c = carriedJobs(a, b, { requireFresh: false });
      if (!c?.jobs.length) continue;
      await writer.addBoard({ ats: b.ats, token: b.token }, c.name || b.name || b.token, c.jobs);
      h.carried_boards += 1;
      h.carried_jobs += c.jobs.length;
    }
    hostedReport[a] = { sitemap_companies: h.sitemap_boards, carried_unchanged: h.carried_unchanged, carried_boards: h.carried_boards,
      carried_jobs: h.carried_jobs, cache: await saveHosted(a, h.state) };
  }
  if (emit) {
    emit.gz.end(`${JSON.stringify({ _end: true, built_at: new Date().toISOString(), ats: Object.keys(stats.by_ats), boards: emit.boards, jobs: emit.jobs, by_ats: stats.by_ats })}\n`);
    await emit.done;
    console.error(`emitted ${emit.boards} boards / ${emit.jobs} jobs -> ${args['emit-boards']}`);
  }
  const fetchSec = (Date.now() - t0) / 1000;
  console.error(`fetched in ${fetchSec.toFixed(0)}s; deduping, sharding and compressing...`);
  const manifest = await writer.finish();
  const totalSec = (Date.now() - t0) / 1000;
  const report = {
    built_at: manifest.built_at,
    boards_in_input: boards.length,
    boards_with_jobs: stats.ok,
    boards_empty: stats.empty,
    boards_failed: stats.failed,
    boards_skipped_rate_limited: stats.skipped_rate_limited || 0,
    boards_skipped_budget: stats.skipped_budget || 0,
    workday_limits: { max_jobs_per_site: wdCfg.maxJobs, site_budget_s: wdCfg.siteBudgetMs / 1000, queue_budget_min: (wdCfg.endsAt - t0) / 60000 },
    queue_budget_min: Object.fromEntries(Object.entries(queueEndsAt).map(([a, at]) => [a, (at - t0) / 60000])),
    boards_skipped_budget_by_ats: stats.skipped_budget_by_ats || {},
    by_ats: stats.by_ats,
    hosted: hostedReport,
    boards_from: fromFile ? { file: args['boards-from'], used: fromFile.ok, reason: fromFile.reason, built_at: fromFile.end?.built_at || null,
      ats: fromFile.ats, boards: fromFile.end?.boards ?? null, jobs: fromFile.end?.jobs ?? null } : null,
    jobs_before_dedupe: manifest.jobs_before_dedupe,
    jobs: manifest.jobs,
    shards: manifest.shards.length,
    codec: manifest.codec,
    total_bytes: manifest.bytes,
    raw_bytes: manifest.shards.reduce((a, s) => a + s.raw_bytes, 0),
    largest_shard_bytes: Math.max(0, ...manifest.shards.map((s) => s.bytes)),
    // Technology detection (companies_tech.json.gz): CPU ms inside addBoard + per-ATS share of jobs with a description.
    companies_tech: manifest.companies_tech_stats || null,
    fetch_seconds: Math.round(fetchSec),
    shard_seconds: Math.round(totalSec - fetchSec),
    total_seconds: Math.round(totalSec),
    failures_sample: failures.slice(0, 30),
  };
  await writeFile(join(resolve(args.out), 'build_report.json'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify(report, null, 1));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
