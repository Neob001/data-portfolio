#!/usr/bin/env node
// Build the sharded jobs index from boards.json using the Actor's own parsers.
//
//   node scripts/jobs_index/build_index.mjs                     # all boards -> scripts/jobs_index/index/
//   node scripts/jobs_index/build_index.mjs --limit 500         # first 500 boards (spread across ATSs)
//   node scripts/jobs_index/build_index.mjs --ats greenhouse,ashby --out /tmp/idx
//
// Polite per-host limits (same as validate_boards.py): Greenhouse 8 parallel, Ashby 6,
// Recruitee 8, Workable 1 @ >=3s spacing, Lever <=8 in flight @ >=1s between request starts (robots.txt Crawl-delay).
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
  },
});

const UA = 'factpipe-jobs-index/1.0 (+https://apify.com/factpipe; job-board syndication)';

/** fetchJson-compatible GET via curl, with the same retry/failure-class semantics as lib/http.js. */
async function curlJson(url, { retries = 3, timeoutMs = 180000, minDelayMs = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt) await new Promise((r) => setTimeout(r, minDelayMs * 2 ** (attempt - 1)));
    let out;
    try {
      ({ stdout: out } = await execFileP('curl', ['-sS', '-L', '--compressed', '--max-time', String(Math.ceil(timeoutMs / 1000)),
        '-A', UA, '-H', 'accept: application/json', '-w', '\n%{http_code}', url], { maxBuffer: 512 * 1024 * 1024 }));
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
  const writer = await new IndexWriter(resolve(args.out), { builtAt: new Date() }).open();
  const stats = { ok: 0, failed: 0, empty: 0, by_ats: {} };
  const failures = [];
  const queues = new Map();
  for (const b of boards) (queues.get(b.ats) || queues.set(b.ats, []).get(b.ats)).push(b);
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
        if (blocked429 >= 5) {
          stats.skipped_rate_limited = (stats.skipped_rate_limited || 0) + (list.length - next);
          console.error(`  ${ats}: 5 consecutive HTTP 429 - skipping its remaining ${list.length - next} boards this build`);
          next = list.length;
          break;
        }
        const b = list[next];
        next += 1;
        const board = { ats: b.ats, token: b.token, ...(b.region ? { region: b.region } : {}) };
        const s = stats.by_ats[ats] || (stats.by_ats[ats] = { boards: 0, jobs: 0, failed: 0 });
        try {
          const r = await fetchBoard(board, { fetchJson: politeFetchJson, fetchText: politeFetchText });
          const name = r.company_name || b.name || b.token;
          const jobs = r.jobs.map((j) => ({ ...j, company_name: r.company_name ? j.company_name : name }));
          addLock = addLock.then(() => writer.addBoard(board, name, jobs));
          await addLock;
          if (jobs.length) { stats.ok += 1; s.boards += 1; s.jobs += jobs.length; } else { stats.empty += 1; }
          blocked429 = 0;
        } catch (e) {
          blocked429 = e.status === 429 ? blocked429 + 1 : 0;
          stats.failed += 1;
          s.failed += 1;
          failures.push({ ats, token: b.token, status: e.status ?? null, failure_class: e.failureClass || 'unknown' });
        }
        done += 1;
        if (done % 200 === 0) console.error(`  ${done}/${boards.length} boards, ${writer.rawJobs} jobs, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      }
    }));
  }));

  const fetchSec = (Date.now() - t0) / 1000;
  const manifest = await writer.finish();
  const totalSec = (Date.now() - t0) / 1000;
  const report = {
    built_at: manifest.built_at,
    boards_in_input: boards.length,
    boards_with_jobs: stats.ok,
    boards_empty: stats.empty,
    boards_failed: stats.failed,
    boards_skipped_rate_limited: stats.skipped_rate_limited || 0,
    by_ats: stats.by_ats,
    jobs_before_dedupe: manifest.jobs_before_dedupe,
    jobs: manifest.jobs,
    shards: manifest.shards.length,
    gz_bytes: manifest.bytes,
    largest_shard_bytes: Math.max(0, ...manifest.shards.map((s) => s.bytes)),
    fetch_seconds: Math.round(fetchSec),
    total_seconds: Math.round(totalSec),
    failures_sample: failures.slice(0, 30),
  };
  await writeFile(join(resolve(args.out), 'build_report.json'), `${JSON.stringify(report, null, 1)}\n`);
  console.log(JSON.stringify(report, null, 1));
}

await main();
