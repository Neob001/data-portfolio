// Companies Hiring: aggregates the jobs index into ONE ROW PER COMPANY that is hiring for the requested
// roles. Company-level facts only: no person data (recruiters, hiring managers) at all.
//
// Boards with the same normalized name (lowercase, no punctuation, no legal suffix such as Inc, Ltd,
// GmbH) are one company only with proof: an identical board token, or shared openings (clusterBoards).
// A shared name alone never merges: a duplicate row is better than two companies in one sales lead. The same opening listed on both boards (same normalized title + location, where
// location = country codes, else the normalized location text) is counted once.
//
// Memory stays bounded by the number of companies, not jobs: each shard is streamed into a compact
// per-shard buffer, which is folded into per-company aggregates once the shard has been read
// completely (so a retried shard never double-counts). Only the ~1% of companies with several boards
// keep per-job keys, for the cross-board dedupe.
import { normalizeInput, compileSearch, companyMatches } from './core/filters.js';
import {
  openIndex, readDirectory, scanShard, mapLimit, fetchBoard, hostPacer, SHARD_CONCURRENCY, FALLBACK_BOARDS,
} from './core/feed.js';
import { fetchJson as libFetchJson } from './lib/http.js';
import { selectShards } from './core/index_format.js';
import { apiUrlFor, boardUrlFor, boardKey, dedupeJobs, atsOfUrl } from './core/transform.js';
import { companyKey, normKey } from './core/text.js';
import { compileKeyword } from './core/keywords.js';

export const SORT_BY = ['matching_jobs', 'hiring_velocity', 'newest'];
export const RECENT_DAYS = 30;
export const MAX_TITLES = 10;
export const TOP_N = 5;
export const MAX_SAMPLES = 3;

export const OUTPUT_FIELDS = [
  'company_name', 'company_board', 'ats', 'careers_url', 'boards', 'ats_list', 'careers_site_domain', 'open_jobs_total',
  'matching_jobs', 'matching_job_titles', 'departments_hiring', 'locations_hiring', 'remote_share', 'newest_posting_at',
  'jobs_posted_last_30d', 'hiring_velocity', 'sample_job_urls', 'source_url', 'fetched_at',
];

const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : [])
  .map((x) => String(x ?? '').trim())
  .filter(Boolean);

/** Raw Actor input -> { opts (core filter options), exclude, minMatchingJobs, sortBy, maxResults }. */
export function normalizeCompaniesInput(input = {}) {
  const sortBy = input.sortBy ?? 'matching_jobs';
  if (!SORT_BY.includes(sortBy)) throw new Error(`"sortBy" must be one of ${SORT_BY.join(', ')} (got ${sortBy})`);
  const minMatchingJobs = input.minMatchingJobs === undefined || input.minMatchingJobs === null ? 1 : Number(input.minMatchingJobs);
  if (!Number.isInteger(minMatchingJobs) || minMatchingJobs < 1) throw new Error('"minMatchingJobs" must be a positive integer');
  const opts = normalizeInput({
    keywords: input.keywords,
    keywordMatch: input.keywordMatch ?? 'any',
    keywordScope: input.keywordScope ?? 'title_and_department',
    locations: input.locations,
    remote: input.remote,
    departments: input.departments,
    postedWithinDays: input.postedWithinDays,
    maxResults: input.maxResults,
    includeDescription: false,
  });
  return { opts, exclude: strList(input.excludeCompanies), minMatchingJobs, sortBy, maxResults: opts.maxResults };
}

// ------------------------------------------------------------------ careers-site domain (never guessed)
// Hosts of ATSs, job boards, form tools and link shorteners: a job link there says nothing about the
// company's own (careers) site.
const THIRD_PARTY = ['greenhouse.io', 'grnh.se', 'lever.co', 'ashbyhq.com', 'workable.com', 'recruitee.com', 'myworkdayjobs.com',
  'workday.com', 'myworkdaysite.com', 'icims.com', 'smartrecruiters.com', 'bamboohr.com', 'jobvite.com', 'taleo.net',
  'successfactors.com', 'successfactors.eu', 'oraclecloud.com', 'linkedin.com', 'indeed.com', 'google.com', 'forms.gle',
  'goo.gl', 'typeform.com', 'notion.site', 'notion.so', 'airtable.com', 'dover.com', 'gem.com', 'wellfound.com', 'angel.co',
  'ycombinator.com', 'workatastartup.com', 'breezy.hr', 'jazzhr.com', 'applytojob.com', 'teamtailor.com', 'personio.de',
  'personio.com', 'join.com', 'rippling.com', 'rippling-ats.com', 'paylocity.com', 'adp.com', 'ultipro.com', 'ukg.com',
  'bit.ly', 'tinyurl.com', 'hibob.com', 'pinpointhq.com', 'comeet.com', 'comeet.co', 'eightfold.ai', 'avature.net',
  'phenompeople.com', 'welcometothejungle.com', 'glassdoor.com', 'ziprecruiter.com', 'careers-page.com', 'zohorecruit.com',
  'zohorecruit.eu', 'freshteam.com', 'homerun.co', 'recruiterbox.com', 'jobscore.com', 'trinethire.com', 'hrmdirect.com',
  'applicantpro.com', 'paycomonline.net', 'paycor.com', 'gusto.com', 'deel.com', 'remote.com', 'github.com', 'github.io',
  'gitlab.io', 'hire.withgoogle.com', 'jobs.personio.de', 'softgarden.io', 'softgarden.de', 'dvinci.de', 'recruitcrm.io',
  'manatal.com', 'kula.ai', 'polymer.co', 'trakstar.com', 'clearcompany.com', 'isolvedhire.com', 'paradox.ai', 'fountain.com',
  'jotform.com', 'hubspot.com', 'hsforms.com', 'calendly.com', 'wufoo.com', 'surveymonkey.com', 'microsoft.com', 'office.com',
  'sharepoint.com', 'bullhornstaffing.com', 'crelate.com', 'workstream.us', 'jobylon.com', 'reachmee.com', 'varbi.com',
  'recman.no', 'webcruiter.no', 'talentlyft.com', 'occupop.com', 'eploy.net', 'cezanneondemand.com', 'peoplehr.net',
  'tal.net', 'oleeo.com', 'jobtrain.co.uk', 'ciphr.com', 'hireful.co.uk', 'otta.com', 'builtin.com', 'monster.com',
  'stepstone.de', 'xing.com', 'jobs.ch', 'careerpuck.com', 'firststage.co', 'comparably.com', 'alle-stellenanzeigen.de', 'instagram.com', 'facebook.com', 'twitter.com', 'x.com', 'youtube.com', 'medium.com'];
const CAREERS_LABELS = new Set(['www', 'careers', 'career', 'jobs', 'job', 'apply', 'boards', 'join', 'work', 'hiring', 'talent',
  'recruiting', 'recruitment', 'karriere', 'emploi', 'empleo', 'werkenbij', 'vacatures', 'team', 'about', 'en', 'de', 'fr']);

/**
 * Domain a job/apply URL points to when it is not an ATS or third-party host (often a dedicated
 * careers site such as careers.acme.com -> acme.com, or withwaymo.com), else null. It is NOT
 * necessarily the company's main website, and no corporate domain is ever guessed.
 */
export function careersSiteDomain(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
  if (!host || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
  if (THIRD_PARTY.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  const labels = host.split('.');
  while (labels.length > 2 && CAREERS_LABELS.has(labels[0])) labels.shift();
  return labels.join('.');
}

// ------------------------------------------------------------------ company keys and job dedupe
// Legal-form words dropped from company names (on top of core companyKey's list).
const LEGAL_SUFFIX_RX = /\b(inc|incorporated|llc|llp|lp|ltd|limited|gmbh|mbh|ag|kg|se|sa|sas|sarl|sl|bv|nv|plc|corp|corporation|co|company|oy|oyj|ab|as|aps|srl|spa|pty|pte|kk|sro|zoo)\b/g;

/**
 * Company merge key: lowercase, no accents/punctuation, dotted initials joined ("S.A." -> "sa"),
 * legal suffixes removed ("Acme Inc", "ACME, Ltd.", "Acme GmbH" -> "acme"); the board key when the
 * name is empty or only a legal form.
 */
export function mergeKey(name, ats, token) {
  const joined = normKey(name).replace(/\b([a-z])(?: ([a-z])\b)+/g, (m) => m.replace(/ /g, ''));
  const key = companyKey(joined.replace(LEGAL_SUFFIX_RX, ' ')).replace(/ /g, '');
  return key || `${ats}:${String(token).toLowerCase()}`;
}

/** Board token for comparison: lowercase alphanumerics without a trailing number ("Lago-1" -> "lago"). */
export function normToken(token) {
  const t = String(token).toLowerCase().replace(/[^a-z0-9]/g, '');
  return t.replace(/[0-9]+$/, '') || t;
}

export const MIN_SHARED_JOBS = 3;
export const MIN_SHARED_SHARE = 0.3;

/**
 * Which boards of one company name really are one company. Two boards merge when (a) their tokens
 * are identical after normToken ("wayve" on Greenhouse and Ashby, "lago-1" / "lago"), or (b) they
 * provably list the same openings: >= 3 shared job keys, or >= 30% of the smaller board's jobs.
 * A shared generic name alone never merges ("Zip" on zip and zipcolimited are two companies).
 * @param boards [{ token, keys: Set(jobKey), jobs: number }]  @returns cluster id per board
 */
export function clusterBoards(boards) {
  const parent = boards.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < boards.length; i += 1) {
    for (let j = i + 1; j < boards.length; j += 1) {
      const [a, b] = [boards[i], boards[j]];
      let same = normToken(a.token) === normToken(b.token);
      if (!same) {
        const [small, big] = a.keys.size <= b.keys.size ? [a.keys, b.keys] : [b.keys, a.keys];
        let shared = 0;
        for (const k of small) if (big.has(k)) shared += 1;
        same = shared >= MIN_SHARED_JOBS || (shared > 0 && shared >= MIN_SHARED_SHARE * Math.min(a.jobs, b.jobs));
      }
      if (same) parent[find(i)] = find(j);
    }
  }
  return boards.map((_, i) => find(i));
}

/** Same opening on two boards: normalized title + country codes (else normalized location text). */
export function jobKey(job) {
  const loc = job.country_codes?.length ? [...job.country_codes].sort().join(',') : (job.locations || []).map(normKey).sort().join(';');
  return `${normKey(job.title)}|${loc}`;
}

// Board identity ignores the Lever EU region: directory.json.gz rows carry no region, index jobs do.
const plainKey = (ats, token) => `${ats}:${String(token).toLowerCase()}`;
const bkOf = (job) => plainKey(job.ats, job.company_board);
const bkOfBoard = (b) => plainKey(b.ats, b.token);

/**
 * Distinct openings of one company across its boards. An opening key seen on several boards counts
 * max(copies on any single board): copies on other boards are the same openings, while repeats within
 * one board (same title and country, different cities) are distinct jobs.
 */
export class CrossBoardCounter {
  constructor() { this.byKey = new Map(); this.size = 0; }

  /** Adds one job; true when the distinct total grew (i.e. it is not a copy from another board). */
  add(key, bk) {
    let per = this.byKey.get(key);
    if (!per) { per = new Map(); this.byKey.set(key, per); }
    const before = Math.max(0, ...per.values());
    per.set(bk, (per.get(bk) || 0) + 1);
    const grew = per.get(bk) > before;
    if (grew) this.size += 1;
    return grew;
  }
}

// ------------------------------------------------------------------ aggregation
const round2 = (x) => Math.round(x * 100) / 100;
const isRemote = (job) => job.workplace_type === 'remote' || job.remote === true;
const inc = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);
const push = (map, k, v) => { if (!map.has(k)) map.set(k, []); map.get(k).push(v); };
const topCounts = (map, n, key) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
  .map(([name, jobs]) => ({ [key]: name, jobs }));
const byRelevance = (a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.posted || '').localeCompare(a.posted || '') || a.url.localeCompare(b.url);

/** Compact view of one matching job (what a company row needs). */
function matchTuple(job, r, mk) {
  return {
    mk,
    bk: bkOf(job),
    key: jobKey(job),
    board: job._board || { ats: job.ats, token: job.company_board },
    name: job.company_name,
    fetched_at: job.fetched_at,
    title: job.title,
    score: r.score,
    title_hit: r.matched_in === 'title',
    dept: job.department || job.team || null,
    locations: job.locations || [],
    remote: isRemote(job),
    posted: job.posted_at || null,
    url: job.job_url,
    domains: [...new Set([job.job_url, job.apply_url].map(careersSiteDomain).filter(Boolean))],
  };
}

export class CompanyAggregator {
  /**
   * @param boardInfo Map(boardKey -> { board, name, open_jobs, mk }) from the directory (may grow in fallback mode)
   * @param multi company names with more than one board (merge candidates): their jobs keep per-job keys
   */
  constructor({ nowMs = Date.now(), boardInfo = new Map(), multi = new Set() } = {}) {
    this.nowMs = nowMs;
    this.boardInfo = boardInfo;
    this.candidates = multi;
    this.multi = new Set(); // final merged companies (set by finalize())
    this.allEntries = new Map(); // candidate name -> [[jobKey, board key], ...] of every open job
    this.recentEntries = new Map(); // candidate name -> the same for jobs posted in the last RECENT_DAYS
    this.companies = new Map(); // mk -> aggregate
    this.recent = new Map(); // mk -> jobs posted in the last RECENT_DAYS (single-board companies)
    this.recentKeys = new Map(); // mk -> CrossBoardCounter of recent jobs (multi-board companies)
    this.allKeys = new Map(); // mk -> CrossBoardCounter of every open job (multi-board companies)
    this.regions = new Map(); // plain board key -> region ("eu" Lever boards)
    this.pending = []; // multi-board matches, folded in a deterministic order by rows()
    this.jobsMatched = 0;
  }

  mkOf(job) {
    const info = this.boardInfo.get(bkOf(job));
    return info ? info.mk : mergeKey(job.company_name, job.ats, job.company_board);
  }

  isRecent(job) {
    const t = job.posted_at ? Date.parse(job.posted_at) : NaN;
    return Number.isFinite(t) && this.nowMs - t <= RECENT_DAYS * 86400000;
  }

  /** Per-shard buffer; `search(job)` -> rank result or null. */
  buffer(search, excluded) {
    const buf = { recent: new Map(), recentKeys: new Map(), allKeys: new Map(), regions: new Map(), matches: [] };
    buf.add = (job) => {
      if (excluded(job)) return;
      if (job._board?.region) buf.regions.set(bkOf(job), job._board.region);
      const mk = this.mkOf(job);
      const multi = this.candidates.has(mk);
      if (multi) push(buf.allKeys, mk, [jobKey(job), bkOf(job)]);
      if (this.isRecent(job)) {
        if (multi) push(buf.recentKeys, mk, [jobKey(job), bkOf(job)]); else inc(buf.recent, mk);
      }
      const r = search(job);
      if (r) buf.matches.push(matchTuple(job, r, mk));
    };
    return buf;
  }

  /** Fold one fully read shard buffer. */
  commit(buf) {
    for (const [mk, n] of buf.recent) inc(this.recent, mk, n);
    for (const [target, src] of [[this.recentEntries, buf.recentKeys], [this.allEntries, buf.allKeys]]) {
      for (const [mk, list] of src) for (const e of list) push(target, mk, e);
    }
    for (const [bk, r] of buf.regions) this.regions.set(bk, r);
    for (const m of buf.matches) {
      if (this.candidates.has(m.mk)) this.pending.push(m); else this.addMatch(m);
    }
  }

  company(m) {
    let c = this.companies.get(m.mk);
    if (!c) {
      c = {
        boards: new Map(), matching: 0, titleMatching: 0, remote: 0, newest: null, fetched_at: null, keys: null,
        titles: new Map(), depts: new Map(), locs: new Map(), domains: new Map(), samples: [],
      };
      this.companies.set(m.mk, c);
    }
    if (!c.boards.has(m.bk)) c.boards.set(m.bk, { board: m.board, name: m.name, matching: 0 });
    return c;
  }

  addMatch(m) {
    const c = this.company(m);
    c.boards.get(m.bk).matching += 1; // per board, duplicates included (picks the primary board)
    if (this.multi.has(m.mk)) {
      c.keys ||= new CrossBoardCounter();
      if (!c.keys.add(m.key, m.bk)) return; // the same opening on another board of this company
    }
    this.jobsMatched += 1;
    c.matching += 1;
    if (m.title_hit) c.titleMatching += 1;
    if (m.remote) c.remote += 1;
    if (m.posted && (!c.newest || m.posted > c.newest)) c.newest = m.posted;
    if (m.fetched_at && (!c.fetched_at || m.fetched_at > c.fetched_at)) c.fetched_at = m.fetched_at;
    if (m.dept) inc(c.depts, m.dept);
    for (const l of new Set(m.locations)) inc(c.locs, l);
    for (const d of m.domains) inc(c.domains, d);
    // Distinct titles, best relevance first; pruned so a company with thousands of jobs stays small.
    const t = c.titles.get(m.title);
    if (!t || byRelevance(m, t) < 0) c.titles.set(m.title, { score: m.score, posted: m.posted, url: m.url });
    if (c.titles.size > MAX_TITLES * 4) {
      c.titles = new Map([...c.titles].sort((a, b) => byRelevance(a[1], b[1])).slice(0, MAX_TITLES * 2));
    }
    if (m.url && !c.samples.some((x) => x.url === m.url)) c.samples.push({ score: m.score, posted: m.posted, url: m.url });
    c.samples.sort(byRelevance);
    if (c.samples.length > MAX_SAMPLES) c.samples.length = MAX_SAMPLES;
  }

  /** Split each candidate name into real companies (clusterBoards) and count their jobs across boards. */
  finalize() {
    const byName = new Map();
    for (const [bk, info] of this.boardInfo) if (this.candidates.has(info.mk)) push(byName, info.mk, bk);
    const counts = new Map();
    for (const nk of this.candidates) {
      const bks = byName.get(nk) || [];
      const keys = new Map(bks.map((bk) => [bk, new Set()]));
      for (const [k, bk] of this.allEntries.get(nk) || []) { keys.get(bk)?.add(k); inc(counts, bk); }
      const cluster = clusterBoards(bks.map((bk) => ({ token: this.boardInfo.get(bk).board.token, keys: keys.get(bk), jobs: counts.get(bk) || 0 })));
      const split = new Set(cluster).size > 1;
      bks.forEach((bk, i) => { this.boardInfo.get(bk).mk = split ? `${nk}#${cluster[i]}` : nk; });
    }
    const perCompany = new Map();
    for (const info of this.boardInfo.values()) inc(perCompany, info.mk);
    this.multi = new Set([...perCompany].filter(([, n]) => n > 1).map(([mk]) => mk));
    for (const [target, src] of [[this.allKeys, this.allEntries], [this.recentKeys, this.recentEntries]]) {
      for (const list of src.values()) {
        for (const [k, bk] of list) {
          const mk = this.boardInfo.get(bk)?.mk;
          if (!mk) continue;
          if (!target.has(mk)) target.set(mk, new CrossBoardCounter());
          target.get(mk).add(k, bk);
        }
      }
    }
    this.allEntries = new Map();
    this.recentEntries = new Map();
    for (const m of this.pending) m.mk = this.boardInfo.get(m.bk)?.mk ?? m.mk;
  }

  /** Company rows (unsorted, before minMatchingJobs). */
  rows() {
    this.finalize();
    // Multi-board matches: fixed order (board, then URL), so which copy of a duplicate counts is deterministic.
    this.pending.sort((a, b) => a.bk.localeCompare(b.bk) || String(a.url).localeCompare(String(b.url)));
    for (const m of this.pending) this.addMatch(m);
    this.pending = [];
    const byCompany = new Map();
    for (const b of this.boardInfo.values()) {
      if (!byCompany.has(b.mk)) byCompany.set(b.mk, []);
      byCompany.get(b.mk).push(b);
    }
    const out = [];
    for (const [mk, c] of this.companies) {
      const multi = this.multi.has(mk);
      // Every board of the company (also those without a match), primary = most matching jobs.
      const withRegion = (b) => { const r = this.regions.get(bkOfBoard(b)); return r && !b.region ? { ...b, region: r } : b; };
      const boards = (byCompany.get(mk) || []).map((b) => ({ ...b, board: withRegion(b.board), matching: c.boards.get(bkOfBoard(b.board))?.matching || 0 }));
      for (const [bk, b] of c.boards) if (!this.boardInfo.has(bk)) boards.push({ board: b.board, name: b.name, open_jobs: 0, matching: b.matching });
      boards.sort((a, b) => b.matching - a.matching || b.open_jobs - a.open_jobs || bkOfBoard(a.board).localeCompare(bkOfBoard(b.board)));
      const primary = boards[0];
      const openSum = multi ? (this.allKeys.get(mk)?.size || 0) : boards.reduce((n, b) => n + (b.open_jobs || 0), 0);
      const open = Math.max(openSum, c.matching);
      // Boards of a candidate name (merged or not) were counted per job during the scan.
      const recent = this.recentKeys.has(mk) || this.allKeys.has(mk) ? (this.recentKeys.get(mk)?.size || 0) : (this.recent.get(mk) || 0);
      out.push({
        company_name: String(primary.name || c.boards.get(bkOfBoard(primary.board))?.name || primary.board.token).trim(),
        company_board: primary.board.token,
        ats: primary.board.ats,
        careers_url: boardUrlFor(primary.board),
        boards: boards.map((b) => ({ ats: b.board.ats, token: b.board.token, careers_url: boardUrlFor(b.board), open_jobs: b.open_jobs || 0 })),
        ats_list: [...new Set(boards.map((b) => b.board.ats))],
        careers_site_domain: topCounts(c.domains, 1, 'd')[0]?.d ?? null,
        open_jobs_total: open,
        matching_jobs: c.matching,
        matching_job_titles: [...c.titles].sort((a, b) => byRelevance(a[1], b[1])).slice(0, MAX_TITLES).map(([title]) => title),
        departments_hiring: topCounts(c.depts, TOP_N, 'department'),
        locations_hiring: topCounts(c.locs, TOP_N, 'location'),
        remote_share: round2(c.remote / c.matching),
        newest_posting_at: c.newest,
        jobs_posted_last_30d: recent,
        hiring_velocity: open ? round2(recent / open) : 0,
        sample_job_urls: c.samples.map((x) => x.url),
        source_url: apiUrlFor(primary.board),
        fetched_at: c.fetched_at || new Date(this.nowMs).toISOString(),
        _title_matching: c.titleMatching,
      });
    }
    return out;
  }
}

const SORTERS = {
  matching_jobs: (a, b) => b.matching_jobs - a.matching_jobs || b._title_matching - a._title_matching
    || (b.newest_posting_at || '').localeCompare(a.newest_posting_at || ''),
  hiring_velocity: (a, b) => b.hiring_velocity - a.hiring_velocity || b.matching_jobs - a.matching_jobs
    || (b.newest_posting_at || '').localeCompare(a.newest_posting_at || ''),
  newest: (a, b) => (b.newest_posting_at || '').localeCompare(a.newest_posting_at || '') || b.matching_jobs - a.matching_jobs,
};

/** Filter by minMatchingJobs, sort, and strip internal fields. */
export function rankCompanies(rows, { minMatchingJobs = 1, sortBy = 'matching_jobs' } = {}) {
  return rows
    .filter((r) => r.matching_jobs >= minMatchingJobs)
    .sort((a, b) => SORTERS[sortBy](a, b) || a.ats.localeCompare(b.ats) || a.company_board.localeCompare(b.company_board))
    .map(({ _title_matching, ...r }) => r);
}

/**
 * Directory rows -> { boardInfo, multi }. Boards start grouped by company name (mergeKey); `multi` holds
 * the names with several boards, whose jobs are keyed during the scan so CompanyAggregator can decide
 * which of them are really one company (clusterBoards) before building rows.
 */
export function groupBoards(entries) {
  const boardInfo = new Map();
  const count = new Map();
  for (const e of entries) {
    const mk = mergeKey(e.name, e.board.ats, e.board.token);
    boardInfo.set(bkOfBoard(e.board), { board: e.board, name: e.name, open_jobs: e.open_jobs, mk });
    inc(count, mk);
  }
  return { boardInfo, multi: new Set([...count].filter(([, n]) => n > 1).map(([mk]) => mk)) };
}

// ------------------------------------------------------------------ the run
/**
 * @param input normalizeCompaniesInput() result
 * @param deps { pushData, charge, log?, now?, indexBaseUrl?, readIndexFile?, streamShardLines?, fetchJson?,
 *               fetchText?, fallbackBoards?, hostGaps? }
 */
export async function runCompanies(input, deps) {
  const { opts, exclude, minMatchingJobs, sortBy, maxResults } = input;
  const log = deps.log || (() => {});
  const nowMs = deps.now ? deps.now() : Date.now();
  const compiled = compileSearch(opts);
  const search = (job) => compiled(job, nowMs);
  const excluded = (job) => exclude.length > 0 && exclude.some((c) => companyMatches(c, job));
  const summary = {
    mode: 'search', rows: 0, charged_events: 0, stop_reason: 'exhausted', companies_matched: 0, companies_qualified: 0,
    multi_board_companies: 0, jobs_matched: 0, shards_total: 0, shards_read: 0, shards_failed: 0, index_built_at: null,
    used_fallback: false, boards_requested: 0, boards_ok: 0, boards_failed: 0, failed_boards: [],
    ranking: opts.keywords.some((k) => compileKeyword(k).phrase) ? 'relevance' : 'none',
  };

  let agg;
  let index = null;
  try {
    index = await openIndex(deps);
  } catch (e) {
    log(`Jobs index unreachable (${e.message}); falling back to live fetch of ${(deps.fallbackBoards || FALLBACK_BOARDS).length} built-in boards.`);
  }

  if (index) {
    const { manifest } = index;
    summary.index_built_at = manifest.built_at;
    const directory = await readDirectory(index);
    const { boardInfo, multi } = groupBoards(directory.map(([ats, token, name, jobs]) => ({ board: { ats, token }, name, open_jobs: jobs })));
    agg = new CompanyAggregator({ nowMs, boardInfo, multi });
    // Shards the filters need, every shard that can hold a job posted in the last 30 days
    // (jobs_posted_last_30d counts all of a company's recent jobs), and every shard of a multi-board
    // company (its open_jobs_total is the de-duplicated count over all of its boards).
    const multiShards = directory.filter(([ats, token]) => multi.has(boardInfo.get(plainKey(ats, token))?.mk)).flatMap((r) => r[4] || []);
    const need = new Set([
      ...selectShards(manifest, opts, { now: nowMs }),
      ...selectShards(manifest, { ats: [], postedWithinDays: RECENT_DAYS }, { now: nowMs }),
      ...multiShards.filter((i) => manifest.shards[i]),
    ]);
    const order = [...need].sort((a, b) => a - b);
    summary.shards_total = order.length;
    await mapLimit(order, SHARD_CONCURRENCY, async (i) => {
      try {
        agg.commit(await scanShard(index, manifest.shards[i], () => agg.buffer(search, excluded), { log }));
        summary.shards_read += 1;
      } catch (e) {
        summary.shards_failed += 1;
        log(`Skipping shard ${manifest.shards[i].file}: ${e.message}`);
      }
    });
    if (order.length && summary.shards_failed === order.length) {
      throw Object.assign(new Error('No index shard could be read'), { failureClass: 'site_down' });
    }
  } else {
    summary.mode = 'fallback_live';
    summary.used_fallback = true;
    const boards = deps.fallbackBoards || FALLBACK_BOARDS;
    summary.boards_requested = boards.length;
    const pace = hostPacer(deps.hostGaps);
    const fetchJson = async (url, o) => {
      await pace(atsOfUrl(url));
      return (deps.fetchJson || libFetchJson)(url, o);
    };
    const results = await mapLimit(boards, 6, async (b) => {
      try {
        const r = await fetchBoard(b, { fetchJson, fetchText: deps.fetchText, now: () => new Date(nowMs) });
        summary.boards_ok += 1;
        return { board: b, name: r.company_name || r.jobs[0]?.company_name || b.token, jobs: r.jobs.map((j) => ({ ...j, _board: b })) };
      } catch (e) {
        summary.boards_failed += 1;
        summary.failed_boards.push({ board: boardKey(b), status: e.status ?? null, failure_class: e.failureClass || 'unknown' });
        log(`Board ${boardKey(b)} failed: ${e.message}`);
        return null;
      }
    });
    const ok = results.filter(Boolean);
    const jobs = dedupeJobs(ok.flatMap((r) => r.jobs));
    const perBoard = new Map();
    for (const j of jobs) inc(perBoard, bkOf(j));
    const { boardInfo, multi } = groupBoards(ok.map((r) => ({ board: r.board, name: r.name, open_jobs: perBoard.get(bkOfBoard(r.board)) || 0 })));
    agg = new CompanyAggregator({ nowMs, boardInfo, multi });
    const buf = agg.buffer(search, excluded);
    for (const job of jobs) buf.add(job);
    agg.commit(buf);
  }

  const all = agg.rows();
  summary.jobs_matched = agg.jobsMatched;
  summary.companies_matched = all.length;
  summary.multi_board_companies = all.filter((r) => r.boards.length > 1).length;
  const rows = rankCompanies(all, { minMatchingJobs, sortBy });
  summary.companies_qualified = rows.length;
  for (const row of rows.slice(0, maxResults)) {
    await deps.pushData(row);
    summary.rows += 1;
    // PPE: one company-result per delivered company row; nothing else is charged.
    const res = await deps.charge({ eventName: 'company-result' });
    summary.charged_events += 1;
    if (res?.eventChargeLimitReached) { summary.stop_reason = 'charge_limit'; break; }
  }
  if (summary.stop_reason === 'exhausted' && rows.length > maxResults) summary.stop_reason = 'max_results';
  return summary;
}
