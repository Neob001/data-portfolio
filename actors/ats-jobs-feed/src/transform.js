// Pure logic: ATS board detection, API URLs, per-ATS job normalization and cross-ATS dedupe.
// Shared by the Actor (live mode) and scripts/jobs_index/build_index.mjs (the jobs index).
import { clean, cleanDescription, snippetOf, normKey, companyKey } from './text.js';
import { countryCodes } from './geo.js';

export const ATS_LIST = ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee'];
export const WORKPLACE_TYPES = ['remote', 'hybrid', 'onsite', 'unknown'];
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'temporary', 'internship', 'other'];
export const SALARY_PERIODS = ['year', 'month', 'week', 'day', 'hour'];

// ------------------------------------------------------------------ board detection
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
];
const RESERVED_FIRST_SEGMENT = new Set(['embed', 'v1', 'j', 'api', 'jobs', 'static', 'assets']);

/**
 * One board reference -> { ats, token, region? } or null. Accepts board URLs (any page of the board)
 * and explicit "ats:token" strings such as "greenhouse:gitlab" or "lever:eu:acme".
 */
export function parseBoardRef(ref) {
  const s = String(ref ?? '').trim();
  if (!s) return null;
  const explicit = s.match(/^(greenhouse|lever|ashby|workable|recruitee):(?:(eu):)?([^\s/?#]+)$/i);
  if (explicit) {
    const ats = explicit[1].toLowerCase();
    return withRegion({ ats, token: fixCase(ats, decodeURIComponent(explicit[3])) }, explicit[2] && ats === 'lever' ? 'eu' : null);
  }
  for (const p of BOARD_PATTERNS) {
    const m = s.match(p.rx);
    if (!m) continue;
    const token = decodeURIComponent(m[1]);
    if (p.skip?.includes(token.toLowerCase())) continue;
    if (RESERVED_FIRST_SEGMENT.has(token.toLowerCase())) continue;
    return withRegion({ ats: p.ats, token: fixCase(p.ats, token) }, p.region);
  }
  return null;
}
const withRegion = (b, region) => (region ? { ...b, region } : b);
const fixCase = (ats, t) => (ats === 'greenhouse' || ats === 'recruitee' ? t.toLowerCase() : t);

export function boardKey({ ats, token, region }) {
  return `${ats}${region ? `:${region}` : ''}:${String(token).toLowerCase()}`;
}

export function apiUrlFor({ ats, token, region }) {
  const t = encodeURIComponent(token);
  if (ats === 'greenhouse') return `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`;
  if (ats === 'lever') return `https://api${region === 'eu' ? '.eu' : ''}.lever.co/v0/postings/${t}?mode=json`;
  if (ats === 'ashby') return `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`;
  if (ats === 'workable') return `https://apply.workable.com/api/v1/widget/accounts/${t}?details=true`;
  if (ats === 'recruitee') return `https://${t}.recruitee.com/api/offers/`;
  return null;
}

export function boardUrlFor({ ats, token, region }) {
  if (ats === 'greenhouse') return `https://job-boards.greenhouse.io/${token}`;
  if (ats === 'lever') return `https://jobs${region === 'eu' ? '.eu' : ''}.lever.co/${token}`;
  if (ats === 'ashby') return `https://jobs.ashbyhq.com/${encodeURIComponent(token)}`;
  if (ats === 'workable') return `https://apply.workable.com/${token}/`;
  if (ats === 'recruitee') return `https://${token}.recruitee.com/`;
  return null;
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

function schemaError(ats, token) {
  const e = new Error(`Unexpected ${ats} response shape for board ${token}`);
  e.failureClass = 'schema_change';
  return e;
}

/**
 * Raw ATS API response -> { company_name, jobs[] } (jobs lack source_url/fetched_at).
 * Throws a schema_change error when the response is not the documented shape.
 */
export function parseBoard(board, response) {
  const { ats, token } = board;
  let list;
  let companyName = null;
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
export function dedupeKey(job) {
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
