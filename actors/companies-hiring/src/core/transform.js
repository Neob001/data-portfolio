// Pure logic: ATS board detection, API URLs, per-ATS job normalization and cross-ATS dedupe.
// Shared by the Actor (live mode) and scripts/jobs_index/build_index.mjs (the jobs index).
import { clean, cleanDescription, snippetOf, normKey, companyKey } from './text.js';
import { countryCodes } from './geo.js';
import { parseXml, child, childrenOf, textOf } from './xml.js';

export const ATS_LIST = ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee', 'workday', 'personio', 'teamtailor'];
// Platforms whose boards are career-site feeds rather than documented JSON APIs: robots.txt of the board's
// host is read (Accept: text/plain) and must allow the paths we read BEFORE any other request to that host.
export const ROBOTS_CHECKED_ATS = ['workday', 'personio', 'teamtailor'];
export const WORKPLACE_TYPES = ['remote', 'hybrid', 'onsite', 'unknown'];
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'temporary', 'internship', 'other'];
export const SALARY_PERIODS = ['year', 'month', 'week', 'day', 'hour'];

// ------------------------------------------------------------------ board detection
// Teamtailor hosts that are not company career sites (first label).
const TT_RESERVED = ['www', 'app', 'api', 'cdn', 'assets', 'scripts', 'static', 'support', 'help', 'status', 'docs', 'blog',
  'partner', 'partners', 'marketplace', 'jobs', 'mail', 'go', 'demo', 'staging', 'test', 'sandbox', 'developer', 'developers'];
const TOKEN = '([A-Za-z0-9][A-Za-z0-9_.%-]*)';
export const BOARD_PATTERNS = [
  { ats: 'greenhouse', rx: new RegExp(`(?:boards|job-boards)\\.greenhouse\\.io/embed/job_board\\?for=${TOKEN}`, 'i') },
  { ats: 'greenhouse', rx: new RegExp(`(?:boards|job-boards)\\.greenhouse\\.io/${TOKEN}`, 'i') },
  { ats: 'greenhouse', rx: new RegExp(`boards-api\\.greenhouse\\.io/v1/boards/${TOKEN}`, 'i') },
  { ats: 'lever', rx: new RegExp(`jobs\\.eu\\.lever\\.co/${TOKEN}`, 'i'), region: 'eu' },
  { ats: 'lever', rx: new RegExp(`api\\.eu\\.lever\\.co/v0/postings/${TOKEN}`, 'i'), region: 'eu' },
  { ats: 'lever', rx: new RegExp(`jobs\\.lever\\.co/${TOKEN}`, 'i') },
  { ats: 'lever', rx: new RegExp(`api\\.lever\\.co/v0/postings/${TOKEN}`, 'i') },
  { ats: 'ashby', rx: new RegExp(`jobs\\.ashbyhq\\.com/${TOKEN}`, 'i') },
  { ats: 'ashby', rx: new RegExp(`api\\.ashbyhq\\.com/posting-api/job-board/${TOKEN}`, 'i') },
  { ats: 'workable', rx: new RegExp(`apply\\.workable\\.com/(?:api/v\\d/widget/accounts/)?${TOKEN}`, 'i') },
  { ats: 'workable', rx: /(?:https?:\/\/)?([a-z0-9][a-z0-9-]*)\.workable\.com(?:\/|$)/i, skip: ['www', 'apply', 'help', 'resources'] },
  { ats: 'recruitee', rx: /(?:https?:\/\/)?([a-z0-9][a-z0-9-]*)\.recruitee\.com(?:\/|$)/i, skip: ['www', 'app', 'api', 'blog', 'support'] },
  { ats: 'personio', rx: /^(?:https?:\/\/)?([a-z0-9][a-z0-9-]*)\.jobs\.personio\.(?:de|com)(?:[/?#]|$)/i, skip: ['www', 'api', 'app'] },
  { ats: 'teamtailor', rx: /^(?:https?:\/\/)?([a-z0-9][a-z0-9-]*(?:\.[a-z]{2})?)\.teamtailor\.com(?:[/?#]|$)/i, skip: TT_RESERVED },
];
const RESERVED_FIRST_SEGMENT = new Set(['embed', 'v1', 'j', 'api', 'jobs', 'static', 'assets']);

/**
 * One board reference -> { ats, token, region? } or null. Accepts board URLs (any page of the board)
 * and explicit "ats:token" strings such as "greenhouse:gitlab" or "lever:eu:acme".
 */
export function parseBoardRef(ref) {
  const s = String(ref ?? '').trim();
  if (!s) return null;
  const explicit = s.match(/^(greenhouse|lever|ashby|workable|recruitee|personio|teamtailor):(?:(eu):)?([^\s/?#]+)$/i);
  if (explicit) {
    const ats = explicit[1].toLowerCase();
    return withRegion({ ats, token: fixCase(ats, decodeURIComponent(explicit[3])) }, explicit[2] && ats === 'lever' ? 'eu' : null);
  }
  if (/myworkday(?:jobs|site)\.com|^workday:|^[a-z0-9][a-z0-9-]*\.wd\d{1,3}\//i.test(s)) return parseWorkdayRef(s);
  for (const p of BOARD_PATTERNS) {
    const m = s.match(p.rx);
    if (!m) continue;
    const token = decodeURIComponent(m[1]);
    if (p.skip?.includes(token.toLowerCase().split('.')[0])) continue;
    if (RESERVED_FIRST_SEGMENT.has(token.toLowerCase())) continue;
    return withRegion({ ats: p.ats, token: fixCase(p.ats, token) }, p.region);
  }
  return null;
}
const withRegion = (b, region) => (region ? { ...b, region } : b);
const fixCase = (ats, t) => (['greenhouse', 'recruitee', 'personio', 'teamtailor'].includes(ats) ? t.toLowerCase() : t);

export function boardKey({ ats, token, region }) {
  return `${ats}${region ? `:${region}` : ''}:${String(token).toLowerCase()}`;
}

// ------------------------------------------------------------------ Workday career sites
// A Workday "board" is one public career site: https://<tenant>.<wdN>.myworkdayjobs.com/<site>.
// Its token is "<tenant>.<wdN>/<site>" (tenant and data-center lowercase, site as published; Workday
// treats site names case-insensitively). The site's own page loads its jobs from the CXS JSON endpoint
// POST /wday/cxs/<tenant>/<site>/jobs and one job from GET /wday/cxs/<tenant>/<site>/job/<path>.
const WD_LOCALE = /^[a-z]{2}(?:-[a-z]{2,4})?$/i;
const WD_SITE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const WD_TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/i;
const WD_RESERVED = new Set(['wday', 'robots.txt', 'favicon.ico', 'refreshfacet', 'sitemap.xml', 'llms.txt', 'assets', 'static',
  'api', 'talentcommunity', 'recruiting', 'job', 'jobs.xml', 'login', 'apply', 'cxs']);

function workdayBoard(tenant, wd, site) {
  let s;
  try { s = decodeURIComponent(site); } catch { return null; }
  if (!WD_TENANT.test(tenant) || !WD_SITE.test(s) || WD_LOCALE.test(s) || WD_RESERVED.has(s.toLowerCase())
    || /\.(txt|xml|json|html?|ico|png|jpe?g|svg|js|css)$/i.test(s)) return null;
  return { ats: 'workday', token: `${tenant.toLowerCase()}.${wd.toLowerCase()}/${s}` };
}

const pathSegments = (p) => String(p || '').split(/[?#]/)[0].split('/').filter(Boolean);

/**
 * Workday reference -> { ats: 'workday', token } or null. Accepts career-site URLs (any page of the
 * site, with or without a locale prefix such as /en-US/), job URLs, CXS API URLs, the
 * <wdN>.myworkdaysite.com/recruiting/<tenant>/<site> host form, "workday:<tenant>.<wdN>/<site>"
 * and the bare token "<tenant>.<wdN>/<site>".
 */
export function parseWorkdayRef(ref) {
  const s = String(ref ?? '').trim();
  let m = s.match(/^(?:workday:)?([a-z0-9][a-z0-9-]*)\.(wd\d{1,3})\/([^\s/?#]+)\/?$/i);
  if (m) return workdayBoard(m[1], m[2], m[3]);
  m = s.match(/^(?:https?:\/\/)?([a-z0-9][a-z0-9-]*)\.(wd\d{1,3})\.myworkdayjobs\.com(\/[^\s]*)?$/i);
  if (m) {
    let segs = pathSegments(m[3]);
    if (segs[0]?.toLowerCase() === 'wday') return segs[1]?.toLowerCase() === 'cxs' && segs[3] ? workdayBoard(m[1], m[2], segs[3]) : null;
    if (segs.length > 1 && WD_LOCALE.test(segs[0])) segs = segs.slice(1);
    return segs[0] ? workdayBoard(m[1], m[2], segs[0]) : null;
  }
  m = s.match(/^(?:https?:\/\/)?(wd\d{1,3})\.myworkdaysite\.com(\/[^\s]*)?$/i);
  if (m) {
    let segs = pathSegments(m[2]);
    if (segs[0]?.toLowerCase() === 'wday') return segs[1]?.toLowerCase() === 'cxs' && segs[3] ? workdayBoard(segs[2], m[1], segs[3]) : null;
    if (segs.length > 1 && WD_LOCALE.test(segs[0])) segs = segs.slice(1);
    return segs[0]?.toLowerCase() === 'recruiting' && segs[2] ? workdayBoard(segs[1], m[1], segs[2]) : null;
  }
  return null;
}

/** "<tenant>.<wdN>/<site>" -> { tenant, wd, site, host } */
export function workdayParts(token) {
  const [tw, ...rest] = String(token).split('/');
  const [tenant, wd] = tw.split('.');
  return { tenant: tenant.toLowerCase(), wd: (wd || '').toLowerCase(), site: rest.join('/'), host: `${tenant.toLowerCase()}.${(wd || '').toLowerCase()}.myworkdayjobs.com` };
}

/** CXS detail URL of one Workday job, from its public job_url (…/<site>/job/<location>/<slug>). */
export function workdayDetailUrl(board, jobUrl) {
  const { host, tenant, site } = workdayParts(board.token);
  let path;
  try { path = new URL(jobUrl).pathname; } catch { return null; }
  const i = path.indexOf('/job/');
  return i < 0 ? null : `https://${host}/wday/cxs/${tenant}/${encodeURIComponent(site)}${path.slice(i)}`;
}

/** Paths a robots.txt must allow before we read a Workday site (list, detail, the site's own pages). */
export function workdayRobotsPaths(board) {
  const { tenant, site } = workdayParts(board.token);
  return [`/wday/cxs/${tenant}/${site}/jobs`, `/wday/cxs/${tenant}/${site}/job/`, `/${site}/`];
}

/**
 * Workday's relative "postedOn" label -> ISO date (UTC midnight) relative to the fetch time, or null.
 * "Posted Today" = fetch day, "Posted Yesterday" = -1 day, "Posted 5 Days Ago" = -5 days and
 * "Posted 30+ Days Ago" = -30 days (meaning: 30 or more days ago; Workday gives no exact date in lists).
 */
export function workdayPostedAt(postedOn, fetchedAt) {
  const s = String(postedOn || '').toLowerCase();
  let days = null;
  if (/\btoday\b|\bjust posted\b/.test(s)) days = 0;
  else if (/\byesterday\b/.test(s)) days = 1;
  else {
    const m = s.match(/(\d{1,4})\s*\+?\s*days?\s+ago/);
    if (m) days = Number(m[1]);
  }
  const base = new Date(fetchedAt ?? Date.now());
  if (days === null || Number.isNaN(base.getTime())) return null;
  base.setUTCHours(0, 0, 0, 0);
  return new Date(base.getTime() - days * 86400000).toISOString();
}

/** Workday remoteType ("Remote", "Hybrid", "On-site", "Primarily On-Site / Occasionally from Home"...). */
export function workdayWorkplace(v) {
  const s = normKey(v);
  if (!s) return null;
  if (/hybrid|\bflex|occasional|partially remote|partly remote/.test(s)) return 'hybrid';
  if (/remote|home based|work from home|virtual|telecommut/.test(s)) return 'remote';
  if (/on ?site|in office|office based/.test(s)) return 'onsite';
  return null;
}

/** Stable per-site job id: the requisition id after the last "_" of the posting path, else the slug. */
export function workdayJobId(externalPath) {
  const slug = decodeURIComponent(pathSegments(externalPath).pop() || '');
  const tail = slug.includes('_') ? slug.slice(slug.lastIndexOf('_') + 1) : '';
  return /^[A-Za-z0-9][A-Za-z0-9-]*$/.test(tail) && /\d/.test(tail) ? tail : slug;
}

function workdayPathLocation(externalPath) {
  const segs = pathSegments(externalPath);
  if (segs[0] !== 'job' || segs.length < 3) return null;
  let loc;
  try { loc = decodeURIComponent(segs[1]); } catch { return null; }
  return clean(loc.replace(/-+/g, ' '));
}

/** Prettified tenant ("ibm" -> "IBM", "capitalone" -> "Capitalone"): last-resort company name. */
export function workdayTenantName(token) {
  const t = workdayParts(token).tenant;
  if (!t) return String(token);
  return t.length <= 3 ? t.toUpperCase() : t.charAt(0).toUpperCase() + t.slice(1);
}

// ------------------------------------------------------------------ Personio / Teamtailor career-site feeds
// Personio: every career page <company>.jobs.personio.de (the same accounts answer on .jobs.personio.com)
// publishes its open positions as XML at /xml, documented by Personio for job portals
// (developer.personio.de "Retrieving open positions"). Without a parameter it answers in the account's
// default language; ?language=en returns English texts, and an EMPTY description for a position that has no
// English version (measured: 290 of 322 positions on one German board), so the core reads the default feed
// and only asks for ?language=en when a position came without description (personioEnglishUrl). Token: the
// company subdomain.
// Teamtailor: every career site publishes an RSS 2.0 feed of its open jobs at /jobs.rss (linked from its
// /jobs page as rel=alternate), with descriptions, structured locations, department and remote status. A page
// holds at most 100 items; ?offset=100, 200... returns the next ones (measured: 639 distinct jobs in 7 pages).
// A group site may list jobs whose links point to its sister sites / custom domains: job_url is the item link.
// Token: the host labels before .teamtailor.com ("acme", regional "acme.na"), or the full host of a
// Teamtailor-hosted custom domain ("careers.acme.com").
const TT_REGIONAL = /^[a-z0-9][a-z0-9-]*\.[a-z]{2}$/;

/** Host of a board read through a career-site feed (Personio, Teamtailor) or a Workday site; else null. */
export function boardHost(board) {
  const t = String(board.token).toLowerCase();
  if (board.ats === 'workday') return workdayParts(board.token).host;
  if (board.ats === 'personio') return `${t}.jobs.personio.de`;
  if (board.ats === 'teamtailor') return !t.includes('.') || TT_REGIONAL.test(t) ? `${t}.teamtailor.com` : t;
  return null;
}

/** Teamtailor feed page: offset 0 is the plain /jobs.rss. */
export const teamtailorPageUrl = (board, offset) => `${apiUrlFor(board)}${offset ? `?offset=${offset}` : ''}`;

/** Personio feed in English: fills descriptions of positions whose default-language text is empty. */
export const personioEnglishUrl = (board) => `https://${boardHost(board)}/xml?language=en`;

/** Paths a robots.txt must allow before we read a board of a robots-checked platform. */
export function robotsPathsFor(board) {
  if (board.ats === 'workday') return workdayRobotsPaths(board);
  if (board.ats === 'personio') return ['/xml', '/job/'];
  if (board.ats === 'teamtailor') return ['/jobs.rss', '/jobs.rss?offset=100', '/jobs/'];
  return [];
}

export function apiUrlFor({ ats, token, region }) {
  if (ats === 'personio') return `https://${boardHost({ ats, token })}/xml`;
  if (ats === 'teamtailor') return `https://${boardHost({ ats, token })}/jobs.rss`;
  if (ats === 'workday') {
    const { host, tenant, site } = workdayParts(token);
    return `https://${host}/wday/cxs/${tenant}/${encodeURIComponent(site)}/jobs`;
  }
  const t = encodeURIComponent(token);
  if (ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`;
  if (ats === 'lever') return `https://api${region === 'eu' ? '.eu' : ''}.lever.co/v0/postings/${t}?mode=json`;
  if (ats === 'ashby') return `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`;
  if (ats === 'workable') return `https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`;
  if (ats === 'recruitee') return `https://${t}.recruitee.com/api/offers/`;
  return null;
}

export function boardUrlFor({ ats, token, region }) {
  if (ats === 'personio') return `https://${boardHost({ ats, token })}/`;
  if (ats === 'teamtailor') return `https://${boardHost({ ats, token })}/jobs`;
  if (ats === 'greenhouse') return `https://job-boards.greenhouse.io/${token}`;
  if (ats === 'lever') return `https://jobs${region === 'eu' ? '.eu' : ''}.lever.co/${token}`;
  if (ats === 'ashby') return `https://jobs.ashbyhq.com/${encodeURIComponent(token)}`;
  if (ats === 'workable') return `https://apply.workable.com/${token}/`;
  if (ats === 'recruitee') return `https://${token}.recruitee.com/`;
  if (ats === 'workday') {
    const { host, site } = workdayParts(token);
    return `https://${host}/${site}`;
  }
  return null;
}

/** ATS of an API URL (for per-host pacing). Hosted career sites first: a tenant may be called "greenhouse…". */
export function atsOfUrl(url) {
  const u = String(url);
  if (/\.myworkday(?:jobs|site)\.com\//.test(u)) return 'workday';
  if (/\.jobs\.personio\.(?:de|com)\//.test(u)) return 'personio';
  // Teamtailor custom domains are recognised by the feed path.
  if (/\.teamtailor\.com\/|\/jobs\.rss(?:[?#]|$)/.test(u)) return 'teamtailor';
  if (/greenhouse/.test(u)) return 'greenhouse';
  if (/lever\.co/.test(u)) return 'lever';
  if (/ashbyhq/.test(u)) return 'ashby';
  if (/workable/.test(u)) return 'workable';
  return 'recruitee';
}

// ------------------------------------------------------------------ field helpers
export function isoDateTime(v) {
  if (v === undefined || v === null || v === '') return null;
  let x = v;
  // Recruitee: "2026-09-15 08:11:57 UTC"
  if (typeof x === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/.test(x)) x = x.replace(' ', 'T').replace(' UTC', 'Z');
  const d = new Date(x);
  return Number.isNaN(d.getTime()) || d.getUTCFullYear() < 1995 ? null : d.toISOString();
}

export function employmentType(v) {
  const s = normKey(v);
  if (!s) return null;
  if (/\bintern(ship)?s?\b|trainee|apprentice|werkstudent|working student|\bstage\b|stagiaire/.test(s)) return 'internship';
  if (/part ?time|parttime|teilzeit/.test(s)) return 'part_time';
  if (/contract|freelance|contractor|consultant|interim/.test(s)) return 'contract';
  if (/full ?time|fulltime|permanent|regular|vollzeit|salaried|employee/.test(s)) return 'full_time';
  if (/temp|fixed term|seasonal|casual/.test(s)) return 'temporary';
  return 'other';
}

function workplaceFrom(value) {
  const s = normKey(value).replace(/ /g, '');
  if (!s) return null;
  if (s.includes('remote')) return 'remote';
  if (s.includes('hybrid')) return 'hybrid';
  if (s === 'onsite' || s === 'inoffice' || s === 'office' || s === 'onpremise') return 'onsite';
  return null;
}

/** Workplace type from location text when the ATS has no explicit field. Never guesses on-site. */
function workplaceFromText(locations) {
  const t = (locations || []).join(' | ');
  if (/\bhybrid\b/i.test(t)) return 'hybrid';
  if (/\bremote\b|\bwork from home\b|\bwfh\b|\banywhere\b/i.test(t)) return 'remote';
  return 'unknown';
}

const remoteFlag = (wt) => (wt === 'remote' ? true : wt === 'onsite' || wt === 'hybrid' ? false : null);

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function salaryPeriod(v) {
  const s = normKey(v);
  if (!s) return null;
  if (/year|annual|annum|yearly/.test(s)) return 'year';
  if (/month/.test(s)) return 'month';
  if (/week/.test(s)) return 'week';
  if (/day|daily/.test(s)) return 'day';
  if (/hour/.test(s)) return 'hour';
  return null;
}

function salary(min, max, currency, period) {
  const lo = num(min);
  const hi = num(max);
  const per = salaryPeriod(period);
  const cur = clean(currency);
  if ((lo === null && hi === null) || !per || !cur || !/^[A-Za-z]{3}$/.test(cur)) {
    return { salary_min: null, salary_max: null, salary_currency: null, salary_period: null };
  }
  return { salary_min: lo, salary_max: hi, salary_currency: cur.toUpperCase(), salary_period: per };
}

const uniq = (arr) => [...new Set(arr.map(clean).filter(Boolean))];

function splitLocations(s) {
  const t = clean(s);
  if (!t) return [];
  return t.split(/\s*(?:;|\||\n)\s*/).map(clean).filter(Boolean);
}

function finish(board, raw) {
  const locations = uniq(raw.locations || []);
  const workplace = raw.workplace_type || workplaceFromText(locations);
  const text = raw.description_text ?? null;
  return {
    job_id: `${board.ats}:${String(board.token).toLowerCase()}:${raw.id}`,
    title: clean(raw.title),
    company_name: clean(raw.company_name) || String(board.token),
    company_board: String(board.token),
    ats: board.ats,
    department: clean(raw.department),
    team: clean(raw.team),
    employment_type: employmentType(raw.employment_type),
    workplace_type: workplace,
    locations,
    country_codes: countryCodes(locations, raw.country_hints || []),
    remote: raw.remote !== undefined ? raw.remote : remoteFlag(workplace),
    ...salary(raw.salary_min, raw.salary_max, raw.salary_currency, raw.salary_period),
    posted_at: isoDateTime(raw.posted_at),
    updated_at: isoDateTime(raw.updated_at),
    apply_url: clean(raw.apply_url) || clean(raw.job_url),
    job_url: clean(raw.job_url),
    description_text: text,
    description_snippet: snippetOf(text),
    duplicate_sources: [],
    // Structured level / experience the ATS publishes (Personio), used by enrich.js when the title or the
    // description gives none. Only set when present, so other platforms' records and the index are unchanged.
    ...(raw.seniority_hint ? { seniority_hint: raw.seniority_hint } : {}),
    ...(Number.isInteger(raw.years_experience_hint) ? { years_experience_hint: raw.years_experience_hint } : {}),
  };
}

// ------------------------------------------------------------------ per-ATS normalizers
function greenhouse(board, j, companyName) {
  if (!j || !j.absolute_url || j.id === undefined || !j.title) return null;
  let locations = splitLocations(j.location?.name);
  if (locations.length === 0) locations = (j.offices || []).map((o) => o?.name);
  return finish(board, {
    id: j.id,
    title: j.title,
    company_name: j.company_name || companyName,
    department: (j.departments || []).map((d) => d?.name).filter(Boolean).join(' / ') || null,
    team: null,
    employment_type: null,
    locations,
    posted_at: j.first_published || j.updated_at,
    updated_at: j.updated_at,
    job_url: j.absolute_url,
    apply_url: j.absolute_url,
    description_text: cleanDescription(j.content),
  });
}

const LEVER_WORKPLACE = { remote: 'remote', hybrid: 'hybrid', onsite: 'onsite', 'on-site': 'onsite' };
function lever(board, j) {
  if (!j || !j.hostedUrl || !j.id || !j.text) return null;
  const c = j.categories || {};
  const locations = Array.isArray(c.allLocations) && c.allLocations.length ? c.allLocations : [c.location];
  const listText = (j.lists || []).map((l) => `${l.text || ''}\n${l.content || ''}`).join('\n');
  const html = [j.description || j.descriptionBody || '', listText, j.additional || ''].join('\n');
  const sr = j.salaryRange || {};
  return finish(board, {
    id: j.id,
    title: j.text,
    company_name: null,
    department: c.department || null,
    team: c.team || null,
    employment_type: c.commitment,
    workplace_type: LEVER_WORKPLACE[String(j.workplaceType || '').toLowerCase()] || null,
    locations,
    country_hints: j.country ? [j.country] : [],
    salary_min: sr.min, salary_max: sr.max, salary_currency: sr.currency, salary_period: sr.interval,
    posted_at: typeof j.createdAt === 'number' ? j.createdAt : null,
    updated_at: null,
    job_url: j.hostedUrl,
    apply_url: j.applyUrl || j.hostedUrl,
    description_text: cleanDescription(html),
  });
}

const ASHBY_EMPLOYMENT = { FullTime: 'full_time', PartTime: 'part_time', Intern: 'intern', Contract: 'contract', Temporary: 'temporary' };
function ashby(board, j, companyName) {
  if (!j || !j.jobUrl || !j.id || !j.title || j.isListed === false) return null;
  const locations = [j.location, ...(j.secondaryLocations || []).map((l) => l?.location)];
  const hints = [j.address?.postalAddress?.addressCountry, ...(j.secondaryLocations || []).map((l) => l?.address?.postalAddress?.addressCountry)];
  const comp = (j.compensation?.summaryComponents || []).find((x) => x?.compensationType === 'Salary')
    || (j.compensation?.summaryComponents || []).find((x) => x?.compensationType === 'Hourly');
  const wt = workplaceFrom(j.workplaceType);
  return finish(board, {
    id: j.id,
    title: j.title,
    company_name: companyName,
    department: j.department || null,
    team: j.team || null,
    employment_type: ASHBY_EMPLOYMENT[j.employmentType] || j.employmentType,
    workplace_type: wt || (j.isRemote === true ? 'remote' : null),
    // Ashby's own isRemote flag (a hybrid role can also be open to remote candidates).
    remote: typeof j.isRemote === 'boolean' ? j.isRemote : undefined,
    locations,
    country_hints: hints.filter(Boolean),
    salary_min: comp?.minValue, salary_max: comp?.maxValue, salary_currency: comp?.currencyCode,
    salary_period: comp?.interval ? String(comp.interval).replace(/^1\s+/, '') : null,
    posted_at: j.publishedAt,
    updated_at: null,
    job_url: j.jobUrl,
    apply_url: j.applyUrl || j.jobUrl,
    description_text: cleanDescription(j.descriptionHtml, j.descriptionPlain),
  });
}

function workable(board, j, companyName) {
  if (!j || !j.shortcode || !j.title) return null;
  const locs = Array.isArray(j.locations) && j.locations.length
    ? j.locations.filter((l) => !l?.hidden).map((l) => [l.city, l.region, l.country].filter(Boolean).join(', '))
    : [[j.city, j.state, j.country].filter(Boolean).join(', ')];
  const hints = Array.isArray(j.locations) ? j.locations.map((l) => l?.countryCode) : [];
  const url = j.url || j.shortlink || `https://apply.workable.com/j/${j.shortcode}`;
  const tele = j.telecommuting === true || j.telecommuting === 'true';
  return finish(board, {
    id: j.shortcode,
    title: j.title,
    company_name: companyName,
    department: j.department || null,
    team: j.function || null,
    employment_type: j.employment_type,
    workplace_type: tele ? 'remote' : null,
    remote: tele ? true : (j.telecommuting === false || j.telecommuting === 'false') ? false : null,
    locations: locs,
    country_hints: [...hints, j.country].filter(Boolean),
    posted_at: j.published_on || j.created_at,
    updated_at: null,
    job_url: url,
    apply_url: j.application_url || url,
    description_text: cleanDescription(j.description),
  });
}

function recruitee(board, o) {
  if (!o || o.id === undefined || !o.title || !(o.careers_url || o.url)) return null;
  if (o.status && o.status !== 'published') return null;
  const locs = Array.isArray(o.locations) && o.locations.length
    ? o.locations.map((l) => [l.city, l.state, l.country].filter(Boolean).join(', ') || l.name)
    : [o.location];
  const hints = [...(o.locations || []).map((l) => l?.country_code), o.country_code].filter(Boolean);
  const wt = o.remote ? 'remote' : o.hybrid ? 'hybrid' : o.on_site ? 'onsite' : null;
  const s = o.salary || {};
  return finish(board, {
    id: o.id,
    title: o.title,
    company_name: o.company_name,
    department: o.department || null,
    team: null,
    employment_type: o.employment_type_code,
    workplace_type: wt,
    locations: locs,
    country_hints: hints,
    salary_min: s.min, salary_max: s.max, salary_currency: s.currency, salary_period: s.period,
    posted_at: o.published_at || o.created_at,
    updated_at: o.updated_at,
    job_url: o.careers_url || o.url,
    apply_url: o.careers_apply_url || o.careers_url,
    description_text: cleanDescription([o.description, o.requirements].filter(Boolean).join('\n')),
  });
}

// Workday list entries carry title, path, a location label, a relative posted label and (on some
// tenants) remoteType / timeType. No description, department or salary: descriptions come from the
// detail endpoint, only for delivered jobs (parseWorkdayDetail).
function workday(board, j, companyName, ctx) {
  if (!j || !j.title || !j.externalPath || !/^\/job\//.test(j.externalPath)) return null;
  const { host, site } = workdayParts(board.token);
  const locText = clean(j.locationsText);
  // "3 Locations": the list only names the primary one, in the posting path (/job/<location>/<slug>).
  const multi = !locText || /^\d+\s+(locations?|standorte|emplacements|ubicaciones|sedi|locais)$/i.test(locText);
  const jobUrl = `https://${host}/${site}${j.externalPath}`;
  return finish(board, {
    id: ctx.id,
    title: j.title,
    company_name: companyName || workdayTenantName(board.token),
    department: null,
    team: null,
    employment_type: j.timeType || null,
    workplace_type: workdayWorkplace(j.remoteType),
    locations: multi ? [workdayPathLocation(j.externalPath)] : [locText],
    posted_at: workdayPostedAt(j.postedOn, ctx.fetchedAt),
    updated_at: null,
    job_url: jobUrl,
    apply_url: `${jobUrl}/apply`,
    description_text: null,
  });
}

/**
 * Workday job detail response -> fields filled in at delivery: description (contacts redacted) and the
 * full location list (the list endpoint names only the primary location of multi-location jobs).
 */
export function parseWorkdayDetail(board, response) {
  const info = response?.jobPostingInfo;
  if (!info || typeof info !== 'object' || !info.title) throw schemaError('workday', board.token);
  const extra = Array.isArray(info.additionalLocations) ? info.additionalLocations : [];
  const locations = uniq([info.location, ...extra].filter((x) => typeof x === 'string'));
  const hints = [info.jobRequisitionLocation?.country?.alpha2Code, info.country?.descriptor].filter(Boolean);
  return {
    description_text: cleanDescription(info.jobDescription),
    locations,
    country_codes: countryCodes(locations, hints),
  };
}

// ------------------------------------------------------------------ Personio / Teamtailor normalizers
// Personio position fields (developer.personio.de + real feeds): employmentType permanent | intern | trainee |
// working_student | freelance (some accounts: temporary), schedule full-time | part-time | full-or-part-time,
// seniority entry-level | experienced | executive | student, yearsOfExperience lt-1 | 1-2 | 2-5 | 5-7 | 7-10 |
// 10-15 | gt-15, optional salaryInformation { min, max, currencyCode, type: yearly | monthly | hourly }.
// "experienced" spans mid to senior, so it maps to no level of ours.
const PERSONIO_SENIORITY = { student: 'intern', 'entry-level': 'entry', executive: 'executive' };
const PERSONIO_YEARS = { 'lt-1': 0, '1-2': 1, '2-5': 2, '5-7': 5, '7-10': 7, '10-15': 10, 'gt-15': 15 };
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Personio employmentType + schedule -> one EMPLOYMENT_TYPES value (or null). */
export function personioEmployment(type, schedule) {
  const t = String(type || '').toLowerCase();
  const sch = String(schedule || '').toLowerCase();
  if (/intern|trainee|working.?student|freelance/.test(t)) return employmentType(t.replace(/_/g, ' '));
  if (sch === 'part-time') return 'part_time'; // "full-or-part-time" stays with the contract type
  if (/temp|fixed/.test(t)) return 'temporary';
  return employmentType(sch === 'full-time' ? sch : t || sch);
}

const PERSONIO_PERIOD = { yearly: 'year', monthly: 'month', weekly: 'week', daily: 'day', hourly: 'hour' };

function personio(board, p, companyName) {
  const id = textOf(p, 'id');
  const title = textOf(p, 'name');
  if (!/^\d+$/.test(id) || !title) return null;
  const offices = [textOf(p, 'office'), ...childrenOf(child(p, 'additionalOffices'), 'office').map((o) => o.text.trim())];
  const html = childrenOf(child(p, 'jobDescriptions'), 'jobDescription').map((d) => {
    const head = textOf(d, 'name');
    return `${head ? `<p><strong>${escHtml(head)}</strong></p>` : ''}${child(d, 'value')?.text || ''}`;
  }).join('\n');
  const jobUrl = `https://${boardHost(board)}/job/${id}`;
  const sal = child(p, 'salaryInformation');
  return finish(board, {
    id,
    title,
    company_name: textOf(p, 'subcompany') || companyName,
    salary_min: sal ? textOf(sal, 'min') : null,
    salary_max: sal ? textOf(sal, 'max') : null,
    salary_currency: sal ? textOf(sal, 'currencyCode') : null,
    salary_period: sal ? PERSONIO_PERIOD[textOf(sal, 'type').toLowerCase()] || textOf(sal, 'type') : null,
    department: textOf(p, 'department') || null,
    team: textOf(p, 'recruitingCategory') || null,
    employment_type: personioEmployment(textOf(p, 'employmentType'), textOf(p, 'schedule')),
    locations: offices,
    posted_at: textOf(p, 'createdAt') || null,
    updated_at: null,
    job_url: jobUrl,
    apply_url: jobUrl,
    description_text: html.trim() ? cleanDescription(html) : null,
    seniority_hint: PERSONIO_SENIORITY[textOf(p, 'seniority').toLowerCase()] || null,
    years_experience_hint: PERSONIO_YEARS[textOf(p, 'yearsOfExperience').toLowerCase()],
  });
}

// Teamtailor remoteStatus: none | hybrid | fully | temporary. "temporary" (temporarily remote) names no lasting
// arrangement, so it falls back to the location text like a missing value.
const TEAMTAILOR_WORKPLACE = { none: 'onsite', hybrid: 'hybrid', fully: 'remote' };

function teamtailor(board, item, companyName) {
  const link = textOf(item, 'link');
  const title = textOf(item, 'title');
  if (!link || !title || !/^https?:\/\//i.test(link)) return null;
  const id = link.match(/\/jobs\/(\d+)/)?.[1] || textOf(item, 'guid');
  if (!id) return null;
  const locs = childrenOf(child(item, 'locations'), 'location');
  // City and country only: an office's street address and zip are not needed to place a job.
  const locations = locs.map((l) => [textOf(l, 'city'), textOf(l, 'country')].filter(Boolean).join(', ') || textOf(l, 'name'));
  return finish(board, {
    id,
    title,
    company_name: companyName,
    department: textOf(item, 'department') || null,
    team: textOf(item, 'role') || null,
    employment_type: null,
    workplace_type: TEAMTAILOR_WORKPLACE[textOf(item, 'remoteStatus').toLowerCase()] || null,
    locations,
    country_hints: locs.map((l) => textOf(l, 'country')).filter(Boolean),
    posted_at: textOf(item, 'pubDate') || null,
    updated_at: null,
    job_url: link,
    apply_url: link,
    description_text: cleanDescription(textOf(item, 'description')),
  });
}

/** Feed text (or an already parsed root) -> root element; a body that is not XML is a schema change. */
function feedRoot(ats, token, response) {
  if (response && typeof response === 'object' && Array.isArray(response.children)) return response;
  if (typeof response !== 'string') throw schemaError(ats, token);
  try { return parseXml(response); } catch { throw schemaError(ats, token); }
}

function schemaError(ats, token) {
  const e = new Error(`Unexpected ${ats} response shape for board ${token}`);
  e.failureClass = 'schema_change';
  return e;
}

/**
 * Raw ATS API response -> { company_name, jobs[] } (jobs lack source_url/fetched_at).
 * Throws a schema_change error when the response is not the documented shape.
 * Workday: `response` is a jobs page ({ total, jobPostings }) or several pages' postings merged into
 * one; `fetchedAt` anchors its relative "Posted N Days Ago" labels.
 */
export function parseBoard(board, response, { fetchedAt = new Date() } = {}) {
  const { ats, token } = board;
  let list;
  let companyName = null;
  if (ats === 'workday') {
    list = response?.jobPostings;
    if (!Array.isArray(list)) throw schemaError(ats, token);
    const jobs = [];
    const ids = new Set();
    for (const raw of list) {
      let job = null;
      try {
        // Requisition id; a second posting of the same requisition falls back to its full slug.
        let id = workdayJobId(raw.externalPath);
        if (ids.has(id)) id = decodeURIComponent(pathSegments(raw.externalPath).pop());
        if (ids.has(id)) continue;
        job = workday(board, raw, null, { id, fetchedAt });
        if (job) ids.add(id);
      } catch { job = null; }
      if (job && job.title && job.job_url) jobs.push(job);
    }
    return { company_name: null, jobs };
  }
  if (ats === 'personio' || ats === 'teamtailor') {
    const root = feedRoot(ats, token, response);
    if (ats === 'personio') {
      if (root.name !== 'workzag-jobs') throw schemaError(ats, token);
      list = childrenOf(root, 'position');
    } else {
      const channel = child(root, 'channel');
      if (root.name !== 'rss' || !channel) throw schemaError(ats, token);
      list = childrenOf(channel, 'item');
      companyName = clean(textOf(channel, 'title')) || null;
    }
    const norm = ats === 'personio' ? personio : teamtailor;
    const jobs = [];
    const ids = new Set();
    for (const raw of list) {
      let job = null;
      try { job = norm(board, raw, companyName); } catch { job = null; } // one malformed job never sinks a board
      if (!job || !job.title || !job.job_url || ids.has(job.job_id)) continue;
      ids.add(job.job_id);
      jobs.push(job);
    }
    return { company_name: companyName, jobs, items: list.length };
  }
  if (ats === 'greenhouse') {
    list = response?.jobs;
    companyName = list?.find?.((j) => j?.company_name)?.company_name ?? null;
  } else if (ats === 'lever') {
    list = Array.isArray(response) ? response : undefined;
  } else if (ats === 'ashby') {
    list = response?.jobs;
  } else if (ats === 'workable') {
    list = response?.jobs;
    companyName = clean(response?.name);
  } else if (ats === 'recruitee') {
    list = response?.offers;
    companyName = list?.find?.((o) => o?.company_name)?.company_name ?? null;
  }
  if (!Array.isArray(list)) throw schemaError(ats, token);
  const norm = { greenhouse, lever, ashby, workable, recruitee }[ats];
  const jobs = [];
  for (const raw of list) {
    let job = null;
    try { job = norm(board, raw, companyName); } catch { job = null; } // one malformed job never sinks a board
    if (job && job.title && job.job_url) jobs.push(job);
  }
  return { company_name: companyName, jobs }; // null when the ATS response carries no company name
}

// ------------------------------------------------------------------ dedupe
// Teamtailor job ids are global: a group career site lists its sister sites' jobs under the same id and link
// (e.g. jobs/8466633 on anicuraglobal and on anicuraportugal), with a different company name. The id is the key.
const TT_JOB_ID = /\/jobs\/(\d+)/;

export function dedupeKey(job) {
  const tt = job.ats === 'teamtailor' ? String(job.job_url || '').match(TT_JOB_ID) : null;
  if (tt) return `teamtailor#${tt[1]}`;
  return [companyKey(job.company_name || job.company_board), normKey(job.title), job.locations.map(normKey).sort().join('|')].join('#');
}

/** Minimal view of a job used to pick the kept copy among duplicates (also used by the index writer). */
export function dedupeLite(job) {
  const score = (job.salary_min !== null && job.salary_min !== undefined ? 4 : 0)
    + (job.description_text ? 2 : 0) + (job.country_codes?.length ? 1 : 0);
  return { job_id: job.job_id, score, posted_at: job.posted_at || '' };
}

/** Which of two lite views wins: more complete record, then newer, then smaller job_id. */
export function preferLite(a, b) {
  if (a.score !== b.score) return a.score > b.score ? a : b;
  if (a.posted_at !== b.posted_at) return a.posted_at > b.posted_at ? a : b;
  return a.job_id <= b.job_id ? a : b;
}

export function betterOf(a, b) {
  return preferLite(dedupeLite(a), dedupeLite(b)).job_id === a.job_id ? a : b;
}

/**
 * Collapse jobs that are the same opening (same normalized company + title + locations), e.g. a
 * company that moved ATS and still has both boards live. Keeps one, lists the others' job_ids.
 */
export function dedupeJobs(jobs) {
  const byKey = new Map();
  for (const job of jobs) {
    const k = dedupeKey(job);
    const cur = byKey.get(k);
    if (!cur) { byKey.set(k, { keep: job, dups: [] }); continue; }
    const keep = betterOf(cur.keep, job);
    cur.dups.push(keep === job ? cur.keep.job_id : job.job_id);
    cur.keep = keep;
  }
  return [...byKey.values()].map(({ keep, dups }) => ({
    ...keep,
    duplicate_sources: [...new Set([...(keep.duplicate_sources || []), ...dups])].filter((id) => id !== keep.job_id).sort(),
  }));
}
