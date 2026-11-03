// Open / closed check of job postings against the published jobs index (GitHub release assets): no live board
// requests. A job is "open" when today's index lists it (directly or as a collapsed duplicate of another
// listing), "closed" when the index read its board but the job is gone, "unknown" when the index cannot tell
// (board not in the index, board only partly indexed, input not recognised).
// Pure orchestration with injected I/O so tests drive it without Apify.
import { openIndex, readDirectory, scanShard, mapLimit, INDEX_BASE_URL, SHARD_CONCURRENCY } from './core/feed.js';
import { parseBoardRef, apiUrlFor, workdayJobId, ATS_LIST } from './core/transform.js';
import { createDeadline } from './lib/deadline.js';

export const EVENT = 'job-checked';
export const STATUSES = ['open', 'closed', 'unknown'];
export const STATUS_REASONS = [
  'in_index', // the job is listed in today's index
  'duplicate_in_index', // the same opening is listed under another job_id (collapsed duplicate)
  'not_in_index', // its board was read by today's build and the job is not there
  'board_partially_indexed', // the board has more jobs than the build keeps per site (Workday 500, Teamtailor 1,000)
  'board_not_in_index', // the board is not in today's index (not in our directory, failed, or no open jobs)
  'unrecognized_input', // neither a factpipe job_id nor a job URL of a supported platform
  'not_checked', // the run stopped (time limit) before this input could be decided
];
export const OUTPUT_FIELDS = [
  'input', 'job_id', 'status', 'status_reason', 'last_seen_index_built_at', 'company_name', 'title', 'ats', 'job_url',
  'checked_at', 'source_url', 'fetched_at',
];
export const MAX_INPUTS = 200000;
export const BATCH_SIZE = 1000;
// Jobs kept per board by the nightly build (.github/workflows/jobs-index.yml: --workday-max-jobs, --teamtailor-max-jobs).
// A board that listed this many jobs may have older jobs that are open but not in the index.
export const BUILD_CAPS = { workday: 500, teamtailor: 1000 };
const RESERVE_MS = 30000;

const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(/[\n,]/) : [])
  .map((x) => String(x ?? '').trim())
  .filter(Boolean);

/** Raw input -> { items: [{ input, kind }] } (exact duplicates collapsed, input order kept). */
export function normalizeCheckInput(input = {}) {
  const ids = strList(input.jobIds);
  const urls = strList(input.jobUrls);
  if (!ids.length && !urls.length) throw new Error('Give at least one job in "jobIds" (e.g. "greenhouse:gitlab:8178133002") or "jobUrls"');
  const items = [];
  const seen = new Set();
  for (const [kind, list] of [['job_id', ids], ['url', urls]]) {
    for (const v of list) {
      const k = `${kind}\u0000${v}`;
      if (seen.has(k)) continue;
      seen.add(k);
      items.push({ input: v, kind });
    }
  }
  if (items.length > MAX_INPUTS) throw new Error(`At most ${MAX_INPUTS} jobs per run (got ${items.length}); split the list into several runs`);
  return { items, duplicates: ids.length + urls.length - items.length };
}

const JOB_ID = new RegExp(`^(${ATS_LIST.join('|')}):(.+):([^:]+)$`, 'i');

/** "ats:token:posting" -> { ats, token (lowercase), jobId } or null. */
export function parseJobId(s) {
  const m = String(s).trim().match(JOB_ID);
  if (!m || !m[2] || !m[3]) return null;
  const ats = m[1].toLowerCase();
  // An EU Lever board reference ("lever:eu:acme") is not part of a job_id: job_ids carry the bare token.
  const token = (ats === 'lever' ? m[2].replace(/^eu:/i, '') : m[2]).toLowerCase();
  return { ats, token, jobId: `${ats}:${token}:${m[3]}` };
}

/** Posting id inside a job URL of a known board (the last part of the index job_id), or null. */
export function postingIdFromUrl(ats, url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const path = decodeURIComponent(u.pathname);
  const q = (k) => u.searchParams.get(k);
  if (ats === 'greenhouse') return q('gh_jid')?.match(/^\d+$/)?.[0] || path.match(/\/jobs\/(\d+)/)?.[1] || null;
  if (ats === 'lever' || ats === 'ashby') return path.match(/\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i)?.[1]?.toLowerCase() || null;
  if (ats === 'workable') return path.match(/\/j\/([A-Za-z0-9]+)/)?.[1]?.toUpperCase() || null;
  if (ats === 'personio') return path.match(/\/job\/(\d+)/)?.[1] || null;
  if (ats === 'teamtailor') return path.match(/\/jobs\/(\d+)/)?.[1] || null;
  if (ats === 'workday') {
    const i = path.indexOf('/job/');
    return i < 0 ? null : workdayJobId(path.slice(i)) || null;
  }
  return null; // recruitee: offer ids are not in the URL (matched by URL instead)
}

/** URL -> comparison key: lowercase host without www., path without trailing slash, gh_jid kept, rest of query dropped. */
export function urlKey(url) {
  let u;
  try { u = new URL(String(url).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const gh = u.searchParams.get('gh_jid');
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  let path = u.pathname.replace(/\/+$/, '');
  try { path = decodeURIComponent(path); } catch { /* keep encoded */ }
  // Workday serves the same job with and without a locale prefix (/en-US/<site>/job/...).
  if (/\.myworkday(?:jobs|site)\.com$/.test(host)) path = path.replace(/^\/[a-z]{2}(?:-[a-z]{2,4})?(?=\/)/i, '').toLowerCase();
  return `${host}${path}${gh ? `?gh_jid=${gh}` : ''}`;
}

const NONE = { ats: null, boardKey: null, jobId: null, urlKey: null, jobShaped: false };

/**
 * One input -> { ats, boardKey, jobId, urlKey, jobShaped } (null when not derivable). jobShaped: the input
 * names one job (a job_id, or a job URL with a posting id / Recruitee offer path), not just a board.
 */
export function parseItem(item) {
  if (item.kind === 'job_id') {
    const p = parseJobId(item.input);
    return p ? { ats: p.ats, boardKey: `${p.ats}:${p.token}`, jobId: p.jobId, urlKey: null, jobShaped: true } : NONE;
  }
  const key = urlKey(item.input);
  if (!key) return NONE;
  const b = parseBoardRef(item.input);
  if (!b) return { ...NONE, urlKey: key };
  const token = String(b.token).toLowerCase();
  const posting = postingIdFromUrl(b.ats, item.input);
  const recruiteeOffer = b.ats === 'recruitee' && /\/o\/[^/]+/.test(new URL(item.input).pathname);
  return {
    ats: b.ats, boardKey: `${b.ats}:${token}`, jobId: posting ? `${b.ats}:${token}:${posting}` : null, urlKey: key, jobShaped: Boolean(posting) || recruiteeOffer,
  };
}

/** The fields a row needs from a matched index record (kept instead of the whole record: 100k+ hits). */
const slimHit = (job) => ({
  job_id: job.job_id, company_name: job.company_name, title: job.title, ats: job.ats, job_url: job.job_url, source_url: job.source_url, fetched_at: job.fetched_at,
});

const boardOfJobId = (id) => id.slice(0, id.lastIndexOf(':'));

/**
 * @param input normalizeCheckInput() result
 * @param deps { indexBaseUrl?, readIndexFile?, streamShardLines?, room(): number, deliver(rows, chargeCount): Promise,
 *               deadline?, log?, now?, batchSize? }
 */
export async function runCheck(input, deps) {
  const log = deps.log || (() => {});
  const deadline = deps.deadline || createDeadline();
  const batchSize = deps.batchSize || BATCH_SIZE;
  const checkedAt = new Date(deps.now ? deps.now() : Date.now()).toISOString();
  const summary = {
    inputs: input.items.length, duplicates_collapsed: input.duplicates || 0, rows: 0, charged_events: 0, open: 0, closed: 0, unknown: 0,
    stop_reason: 'exhausted', shards_total: 0, shards_read_pass1: 0, shards_read_pass2: 0, shards_failed: 0,
    index_built_at: null, scan_ms: 0, deliver_ms: 0,
  };

  const index = await openIndex(deps);
  const { manifest } = index;
  summary.index_built_at = manifest.built_at;
  summary.shards_total = manifest.shards.length;
  const base = String(deps.indexBaseUrl || INDEX_BASE_URL);
  const manifestUrl = `${/^https?:\/\//.test(base) ? base.replace(/\/$/, '') : INDEX_BASE_URL}/manifest.json`;

  const directory = new Map(); // boardKey -> { ats, token, name, jobs, shards }
  for (const [ats, token, name, jobs, shards] of await readDirectory(index)) {
    directory.set(`${ats}:${String(token).toLowerCase()}`, { ats, token, name, jobs, shards });
  }

  // ---- what to look for
  const items = input.items.map((it) => ({ ...it, ...parseItem(it), hit: null, via: null }));
  const byJobId = new Map();
  const byUrl = new Map();
  const add = (map, k, it) => { if (!k) return; const l = map.get(k); if (l) l.push(it); else map.set(k, [it]); };
  for (const it of items) { add(byJobId, it.jobId, it); add(byUrl, it.urlKey, it); }
  const unresolved = () => items.filter((it) => !it.hit && (it.jobId || it.urlKey));

  // ---- scanning: one pass over a set of shards; records matched by job_id, job/apply URL or duplicate_sources
  const wantedBoards = new Set(items.map((it) => it.boardKey).filter(Boolean));
  const headers = new Map(); // boardKey -> shard header of that board ({ t, r?, f }), for the inputs' boards
  const dupCount = new Map(); // boardKey -> job_ids of that board collapsed into another listing
  const read = new Set();
  const failedAts = new Set(); // platforms with a shard that could not be read
  // A direct listing beats a duplicate listing (shards are read in parallel, so either can come first).
  const hit = (list, job, via) => {
    for (const it of list || []) {
      if (!it.hit || (via === 'in_index' && it.via !== 'in_index')) { it.hit = slimHit(job); it.via = via; }
    }
  };
  async function scan(shardIdxs, pass) {
    const t0 = Date.now();
    await mapLimit(shardIdxs, SHARD_CONCURRENCY, async (i) => {
      read.add(i);
      try {
        // Duplicate counts per attempt: a shard re-read after a network error must not count twice.
        const acc = await scanShard(index, manifest.shards[i], () => {
          const dups = new Map();
          return {
            dups,
            add(job, boards) {
              const bk = `${job.ats}:${String(job.company_board).toLowerCase()}`;
              if (wantedBoards.has(bk) && !headers.has(bk)) headers.set(bk, boards[bk] || boards[`${job.ats}:eu:${bk.slice(job.ats.length + 1)}`] || null);
              if (byJobId.size) hit(byJobId.get(job.job_id), job, 'in_index');
              if (byUrl.size) {
                hit(byUrl.get(urlKey(job.job_url)), job, 'in_index');
                if (job.apply_url && job.apply_url !== job.job_url) hit(byUrl.get(urlKey(job.apply_url)), job, 'in_index');
              }
              for (const d of job.duplicate_sources || []) {
                const db = boardOfJobId(d);
                dups.set(db, (dups.get(db) || 0) + 1);
                if (byJobId.size) hit(byJobId.get(d), job, 'duplicate_in_index');
              }
            },
          };
        }, { log });
        for (const [k, n] of acc.dups) dupCount.set(k, (dupCount.get(k) || 0) + n);
        summary[`shards_read_pass${pass}`] += 1;
      } catch (e) {
        summary.shards_failed += 1;
        failedAts.add(manifest.shards[i].ats);
        log(`Shard ${manifest.shards[i].file} unreadable: ${e.message}`);
      }
    });
    summary.scan_ms += Date.now() - t0;
  }

  // Pass 1: the shards holding the inputs' boards (from the directory).
  const pass1 = new Set();
  for (const it of items) for (const s of directory.get(it.boardKey)?.shards || []) pass1.add(s);
  await scan([...pass1].sort((a, b) => a - b), 1);

  // Pass 2, only for what pass 1 left open: a job missing from its board may be listed as a duplicate of another
  // board's job (always the same platform in practice), and a board's duplicates decide whether it hit the build
  // cap. So: the remaining shards of each platform with unresolved inputs; every remaining shard when a URL of an
  // unrecognised host is unresolved (company career pages appear as job_url of embedded boards).
  let timedOut = false;
  const left = unresolved();
  if (left.length) {
    const atsNeeded = new Set(left.map((it) => it.ats).filter(Boolean));
    const any = left.some((it) => !it.ats);
    const pass2 = manifest.shards.map((s, i) => [s, i]).filter(([s, i]) => !read.has(i) && (any || atsNeeded.has(s.ats))).map(([, i]) => i);
    if (pass2.length && !deadline.hasTimeFor(RESERVE_MS + 60000)) {
      timedOut = true;
      log(`Not enough run time left for the second index pass (${pass2.length} shards): undecided inputs are reported as not_checked.`);
    } else {
      await scan(pass2, 2);
    }
  }
  if (summary.shards_failed && summary.shards_failed === read.size) {
    throw Object.assign(new Error(`all ${read.size} index shards needed failed to load`), { failureClass: 'site_down' });
  }
  // A missing job is only "closed" when every shard that could list it (its platform: board and duplicates) was read.
  const incomplete = (it) => failedAts.has(it.ats);

  // ---- classification
  function classify(it) {
    if (it.hit) return { status: 'open', reason: it.via };
    // Not a recognisable single job (bad string, a board URL, a URL on an unknown host that no indexed job uses).
    if (!it.jobShaped) return { status: 'unknown', reason: 'unrecognized_input' };
    if (timedOut || incomplete(it)) return { status: 'unknown', reason: 'not_checked' };
    const b = directory.get(it.boardKey);
    if (!b) return { status: 'unknown', reason: 'board_not_in_index' };
    const cap = BUILD_CAPS[b.ats];
    if (cap && b.jobs + (dupCount.get(it.boardKey) || 0) >= cap) return { status: 'unknown', reason: 'board_partially_indexed' };
    return { status: 'closed', reason: 'not_in_index' };
  }

  function rowOf(it) {
    const { status, reason } = classify(it);
    const b = it.boardKey ? directory.get(it.boardKey) : null;
    const h = it.boardKey ? headers.get(it.boardKey) : null;
    const row = {
      input: it.input,
      job_id: it.jobId,
      status,
      status_reason: reason,
      last_seen_index_built_at: null,
      company_name: b?.name ?? null,
      title: null,
      ats: it.ats,
      job_url: it.kind === 'url' ? it.input : null,
      checked_at: checkedAt,
      source_url: manifestUrl,
      fetched_at: manifest.built_at,
    };
    if (status === 'open') {
      const r = it.hit;
      Object.assign(row, {
        job_id: it.jobId || r.job_id,
        last_seen_index_built_at: manifest.built_at,
        company_name: r.company_name,
        title: r.title,
        ats: r.ats,
        job_url: r.job_url,
        source_url: r.source_url,
        fetched_at: r.fetched_at || manifest.built_at,
      });
    } else if (status === 'closed') {
      // The board was read by the build (at its fetched_at) and the job was not on it.
      const board = { ats: b.ats, token: h?.t ?? b.token, ...(h?.r ? { region: h.r } : {}) };
      row.source_url = apiUrlFor(board);
      row.fetched_at = h?.f || manifest.built_at;
    }
    return row;
  }

  // ---- delivery in input order: one job-checked per open/closed row; unknown rows are free
  let stopped = false;
  for (let s = 0; s < items.length && !stopped; s += batchSize) {
    if (!deadline.hasTimeFor(RESERVE_MS)) { summary.stop_reason = 'deadline'; break; }
    let rows = items.slice(s, s + batchSize).map(rowOf);
    const room = deps.room ? deps.room() : Infinity;
    let charged = 0;
    let cut = rows.length;
    for (let k = 0; k < rows.length; k += 1) {
      if (rows[k].status === 'unknown') continue;
      if (charged >= room) { cut = k; break; }
      charged += 1;
    }
    if (cut < rows.length) { rows = rows.slice(0, cut); stopped = true; summary.stop_reason = 'charge_limit'; }
    if (!rows.length) break;
    const t0 = Date.now();
    const res = await deps.deliver(rows, charged);
    summary.deliver_ms += Date.now() - t0;
    summary.rows += rows.length;
    summary.charged_events += charged;
    for (const r of rows) summary[r.status] += 1;
    if (res?.eventChargeLimitReached && s + batchSize < items.length) { stopped = true; summary.stop_reason = 'charge_limit'; }
  }
  return summary;
}
