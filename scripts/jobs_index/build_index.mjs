#!/usr/bin/env node
// Build the sharded jobs index from boards.json using the Actor's own parsers.
//
//   node scripts/jobs_index/build_index.mjs                     # all boards -> scripts/jobs_index/index/
//   node scripts/jobs_index/build_index.mjs --limit 500         # first 500 boards (spread across ATSs)
//   node scripts/jobs_index/build_index.mjs --ats greenhouse,ashby --out /tmp/idx
//   node scripts/jobs_index/build_index.mjs --skip-ats workable --transport curl --codec br
//   node scripts/jobs_index/build_index.mjs --ats workday --limit 60 --workday-max-jobs 200 --out /tmp/wd
//
// Polite per-host limits (same as validate_boards.py): Greenhouse 8 parallel, Ashby 6,
// Recruitee 8, Workable 1 @ >=3s spacing, Lever <=8 in flight @ >=1s between request starts (robots.txt Crawl-delay),
// Workday 8 sites in parallel (one per host) @ >=150 ms between request starts across all Workday hosts, robots.txt
// checked per host.
//
// Workday budget: a site's jobs come 20 per request, so a 2,000-job site costs 100 requests. Each site keeps
// its newest --workday-max-jobs jobs, stops paging after --workday-site-budget-s, and the whole Workday queue
// stops starting sites after --workday-budget-min (it runs in parallel with the other ATSs, so it must end
// before the slowest of them, Workable at ~3 s per board). The site order rotates daily, so a budget cut
// skips different sites on different nights.
// Zero-token, deterministic. Needs node >= 22; imports only node builtins and the Actor's src/.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { execFile } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../../actors/ats-jobs-feed/src');
const { fetchBoard } = await import(join(SRC, 'feed.js'));
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
  // <= 6.7 request starts/s across all Workday hosts (8 sites in flight, ~1.2 s per request measured).
  workday: { workers: 8, gapMs: 150 },
};

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

/** robots.txt fetch for Workday hosts (fetchText-compatible: throws with .status on HTTP errors). */
async function robotsText(url) {
  if (!url.endsWith('/robots.txt')) throw new Error(`name from boards.json, not ${url}`);
  if (args.transport === 'curl') {
    const { stdout } = await execFileP('curl', ['-sS', '-L', '--max-time', '30', '-A', UA, '-w', '\n%{http_code}', url], { maxBuffer: 8 * 1024 * 1024 });
    const nl = stdout.lastIndexOf('\n');
    const status = Number(stdout.slice(nl + 1));
    if (status !== 200) throw new FetchError(`HTTP ${status} at ${url}`, 'http_error', status);
    return stdout.slice(0, nl);
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new FetchError(`HTTP ${res.status} at ${url}`, 'http_error', res.status);
  return res.text();
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
  return async () => {
    if (!gapMs) return;
    const now = Date.now();
    const wait = Math.max(0, next - now);
    next = Math.max(now, next) + gapMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
  };
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
  console.error(`building index from ${boards.length} boards -> ${args.out}`);
  const writer = await new IndexWriter(resolve(args.out), { builtAt: new Date(), codec: args.codec }).open();
  const stats = { ok: 0, failed: 0, empty: 0, by_ats: {} };
  const failures = [];
  const queues = new Map();
  for (const b of boards) (queues.get(b.ats) || queues.set(b.ats, []).get(b.ats)).push(b);
  if (queues.has('workday')) queues.set('workday', rotateDaily(queues.get('workday')));
  const wdCfg = {
    maxJobs: Number(args['workday-max-jobs']) || 300,
    siteBudgetMs: (Number(args['workday-site-budget-s']) || 90) * 1000,
    endsAt: t0 + (Number(args['workday-budget-min']) || 85) * 60000,
  };
  const wdDeadline = { hasTimeFor: () => Date.now() < wdCfg.endsAt };
  const robotsCache = new Map();
  const busyHosts = new Set();
  const hostOf = (b) => String(b.token).split('/')[0].toLowerCase();
  let addLock = Promise.resolve();
  let done = 0;

  await Promise.all([...queues.entries()].map(async ([ats, list]) => {
    const pol = POLICY[ats] || { workers: 2, gapMs: 500 };
    const wait = pacer(pol.gapMs);
    let next = 0;
    const getJson = args.transport === 'curl' ? curlJson : fetchJson;
    const politeFetchJson = async (url, opts) => { await wait(); return getJson(url, { ...opts, retries: 3, timeoutMs: 180000, minDelayMs: 2000 }); };
    const politeFetchText = async (url) => { throw new Error(`name from boards.json, not ${url}`); };
    let blocked429 = 0; // circuit breaker: consecutive rate-limit failures on this ATS
    await Promise.all(Array.from({ length: pol.workers }, async () => {
      while (next < list.length) {
        if (ats === 'workday' && Date.now() >= wdCfg.endsAt) {
          stats.skipped_budget = (stats.skipped_budget || 0) + (list.length - next);
          console.error(`  workday: time budget spent - skipping its remaining ${list.length - next} sites this build`);
          next = list.length;
          break;
        }
        if (blocked429 >= 5) {
          stats.skipped_rate_limited = (stats.skipped_rate_limited || 0) + (list.length - next);
          console.error(`  ${ats}: 5 consecutive HTTP 429 - skipping its remaining ${list.length - next} boards this build`);
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
          const r = await fetchBoard(board, ats === 'workday'
            ? { fetchJson: politeFetchJson, fetchText: robotsText, skipName: true, maxJobs: wdCfg.maxJobs, budgetMs: wdCfg.siteBudgetMs,
              deadline: wdDeadline, robotsCache, robotsAgent: ROBOTS_AGENT }
            : { fetchJson: politeFetchJson, fetchText: politeFetchText });
          if (ats === 'workday') {
            s.requests = (s.requests || 0) + r.pages;
            s.seconds = Math.round(((s.seconds || 0) + (Date.now() - bt0) / 1000) * 10) / 10;
            s.listed_total = (s.listed_total || 0) + (r.total || 0);
            if (r.truncated) s.truncated = (s.truncated || 0) + 1;
          }
          const name = r.company_name || b.name || b.token;
          const jobs = r.jobs.map((j) => ({ ...j, company_name: r.company_name ? j.company_name : name }));
          addLock = addLock.then(() => writer.addBoard(board, name, jobs));
          await addLock;
          if (jobs.length) { stats.ok += 1; s.boards += 1; s.jobs += jobs.length; } else { stats.empty += 1; }
          blocked429 = 0;
        } catch (e) {
          blocked429 = e.status === 429 ? blocked429 + 1 : 0;
          if (e.robots) s.skipped_robots = (s.skipped_robots || 0) + 1; // robots.txt disallows: never called
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
  }));

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
    by_ats: stats.by_ats,
    jobs_before_dedupe: manifest.jobs_before_dedupe,
    jobs: manifest.jobs,
    shards: manifest.shards.length,
    codec: manifest.codec,
    total_bytes: manifest.bytes,
    raw_bytes: manifest.shards.reduce((a, s) => a + s.raw_bytes, 0),
    largest_shard_bytes: Math.max(0, ...manifest.shards.map((s) => s.bytes)),
    fetch_seconds: Math.round(fetchSec),
    shard_seconds: Math.round(totalSec - fetchSec),
    total_seconds: Math.round(totalSec),
    failures_sample: failures.slice(0, 30),
  };
  await writeFile(join(resolve(args.out), 'build_report.json'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify(report, null, 1));
}

await main();
