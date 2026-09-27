// Companies Hiring: aggregates the jobs index into ONE ROW PER COMPANY job board that is hiring for
// the requested roles. Company-level facts only: no person data (recruiters, hiring managers) at all.
//
// Memory stays bounded by the number of companies, not jobs: each shard is streamed into a compact
// per-shard buffer, which is folded into per-company aggregates once the shard has been read
// completely (so a retried shard never double-counts).
import { normalizeInput, compileSearch, companyMatches } from './core/filters.js';
import {
  openIndex, readDirectory, scanShard, mapLimit, fetchBoard, hostPacer, SHARD_CONCURRENCY, FALLBACK_BOARDS,
} from './core/feed.js';
import { fetchJson as libFetchJson } from './lib/http.js';
import { selectShards } from './core/index_format.js';
import { apiUrlFor, boardUrlFor, boardKey, dedupeJobs } from './core/transform.js';
import { compileKeyword } from './core/keywords.js';

export const SORT_BY = ['matching_jobs', 'hiring_velocity', 'newest'];
export const RECENT_DAYS = 30;
export const MAX_TITLES = 10;
export const TOP_N = 5;
export const MAX_SAMPLES = 3;

export const OUTPUT_FIELDS = [
  'company_name', 'company_board', 'ats', 'careers_url', 'website_domain', 'open_jobs_total', 'matching_jobs',
  'matching_job_titles', 'departments_hiring', 'locations_hiring', 'remote_share', 'newest_posting_at',
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

// ------------------------------------------------------------------ website domain (never guessed)
// Hosts of ATSs, job boards, form tools and link shorteners: a job link there says nothing about the
// employer's own website.
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

/** Employer's own domain from a job/apply URL, or null for ATS/third-party hosts and unusable URLs. */
export function employerDomain(url) {
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
  if (!host || !host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) return null;
  if (THIRD_PARTY.some((d) => host === d || host.endsWith(`.${d}`))) return null;
  const labels = host.split('.');
  while (labels.length > 2 && CAREERS_LABELS.has(labels[0])) labels.shift();
  return labels.join('.');
}

// ------------------------------------------------------------------ aggregation
const round2 = (x) => Math.round(x * 100) / 100;
const isRemote = (job) => job.workplace_type === 'remote' || job.remote === true;
const inc = (map, k, n = 1) => map.set(k, (map.get(k) || 0) + n);
const topCounts = (map, n, key) => [...map].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n)
  .map(([name, jobs]) => ({ [key]: name, jobs }));
const byRelevance = (a, b) => (b.score ?? -1) - (a.score ?? -1) || (b.posted || '').localeCompare(a.posted || '') || a.url.localeCompare(b.url);

/** Compact view of one matching job (what a company row needs). */
function matchTuple(job, r) {
  return {
    ck: `${job.ats}:${String(job.company_board).toLowerCase()}`,
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
    domains: [...new Set([job.job_url, job.apply_url].map(employerDomain).filter(Boolean))],
  };
}

export class CompanyAggregator {
  constructor({ nowMs = Date.now() } = {}) {
    this.nowMs = nowMs;
    this.companies = new Map(); // ck -> aggregate
    this.recent = new Map(); // ck -> jobs posted in the last RECENT_DAYS (all jobs, matching or not)
    this.jobsMatched = 0;
  }

  isRecent(job) {
    const t = job.posted_at ? Date.parse(job.posted_at) : NaN;
    return Number.isFinite(t) && this.nowMs - t <= RECENT_DAYS * 86400000;
  }

  /** Fold one shard's buffer: { recent: Map(ck -> n), matches: tuple[] }. */
  commit({ recent, matches }) {
    for (const [ck, n] of recent) inc(this.recent, ck, n);
    for (const m of matches) this.addMatch(m);
  }

  addMatch(m) {
    this.jobsMatched += 1;
    let c = this.companies.get(m.ck);
    if (!c) {
      c = {
        board: m.board, name: m.name, fetched_at: m.fetched_at, matching: 0, titleMatching: 0, remote: 0, newest: null,
        titles: new Map(), depts: new Map(), locs: new Map(), domains: new Map(), samples: [],
      };
      this.companies.set(m.ck, c);
    }
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

  /**
   * Company rows (unsorted, before minMatchingJobs). `openJobs(ck)` gives all open jobs of the board.
   */
  rows(openJobs) {
    const out = [];
    for (const [ck, c] of this.companies) {
      const open = Math.max(openJobs(ck) || 0, c.matching);
      const recent = this.recent.get(ck) || 0;
      const domain = topCounts(c.domains, 1, 'd')[0]?.d ?? null;
      out.push({
        company_name: String(c.name || c.board.token).trim(),
        company_board: c.board.token,
        ats: c.board.ats,
        careers_url: boardUrlFor(c.board),
        website_domain: domain,
        open_jobs_total: open,
        matching_jobs: c.matching,
        matching_job_titles: [...c.titles].sort((a, b) => byRelevance(a[1], b[1])).slice(0, MAX_TITLES).map(([title]) => title),
        departments_hiring: topCounts(c.depts, TOP_N, 'department'),
        locations_hiring: topCounts(c.locs, TOP_N, 'location'),
        remote_share: round2(c.remote / c.matching),
        newest_posting_at: c.newest,
        jobs_posted_last_30d: recent,
        hiring_velocity: open ? round2(recent / open) : 0,
        sample_job_urls: c.samples.map((s) => s.url),
        source_url: apiUrlFor(c.board),
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
  const search = compileSearch(opts);
  const excluded = (job) => exclude.length > 0 && exclude.some((c) => companyMatches(c, job));
  const agg = new CompanyAggregator({ nowMs });
  const summary = {
    mode: 'search', rows: 0, charged_events: 0, stop_reason: 'exhausted', companies_matched: 0, companies_qualified: 0,
    jobs_matched: 0, shards_total: 0, shards_read: 0, shards_failed: 0, index_built_at: null, used_fallback: false,
    boards_requested: 0, boards_ok: 0, boards_failed: 0, failed_boards: [],
    ranking: opts.keywords.some((k) => compileKeyword(k).phrase) ? 'relevance' : 'none',
  };

  const newBuffer = () => {
    const buf = { recent: new Map(), matches: [] };
    buf.add = (job) => {
      if (excluded(job)) return;
      const ck = `${job.ats}:${String(job.company_board).toLowerCase()}`;
      if (agg.isRecent(job)) inc(buf.recent, ck);
      const r = search(job, nowMs);
      if (r) buf.matches.push(matchTuple(job, r));
    };
    return buf;
  };

  let openJobs;
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
    const totals = new Map(directory.map(([ats, token, , jobs]) => [`${ats}:${String(token).toLowerCase()}`, jobs]));
    openJobs = (ck) => totals.get(ck) || 0;
    // Shards the filters need, plus every shard that can hold a job posted in the last 30 days
    // (jobs_posted_last_30d counts all of a company's recent jobs, not only the matching ones).
    const need = new Set([
      ...selectShards(manifest, opts, { now: nowMs }),
      ...selectShards(manifest, { ats: [], postedWithinDays: RECENT_DAYS }, { now: nowMs }),
    ]);
    const order = [...need];
    summary.shards_total = order.length;
    await mapLimit(order, SHARD_CONCURRENCY, async (i) => {
      try {
        agg.commit(await scanShard(index, manifest.shards[i], newBuffer, { log }));
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
      const ats = /greenhouse/.test(url) ? 'greenhouse' : /lever\.co/.test(url) ? 'lever' : /ashbyhq/.test(url) ? 'ashby' : /workable/.test(url) ? 'workable' : 'recruitee';
      await pace(ats);
      return (deps.fetchJson || libFetchJson)(url, o);
    };
    const results = await mapLimit(boards, 6, async (b) => {
      try {
        const r = await fetchBoard(b, { fetchJson, fetchText: deps.fetchText, now: () => new Date(nowMs) });
        summary.boards_ok += 1;
        return r.jobs.map((j) => ({ ...j, _board: b }));
      } catch (e) {
        summary.boards_failed += 1;
        summary.failed_boards.push({ board: boardKey(b), status: e.status ?? null, failure_class: e.failureClass || 'unknown' });
        log(`Board ${boardKey(b)} failed: ${e.message}`);
        return [];
      }
    });
    const jobs = dedupeJobs(results.flat());
    const totals = new Map();
    const buf = newBuffer();
    for (const job of jobs) {
      inc(totals, `${job.ats}:${String(job.company_board).toLowerCase()}`);
      buf.add(job);
    }
    agg.commit(buf);
    openJobs = (ck) => totals.get(ck) || 0;
  }

  summary.jobs_matched = agg.jobsMatched;
  summary.companies_matched = agg.companies.size;
  const rows = rankCompanies(agg.rows(openJobs), { minMatchingJobs, sortBy });
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
