// Pure input normalization and job filtering.
import { ATS_LIST, EMPLOYMENT_TYPES, parseBoardRef, boardKey } from './transform.js';
import { normKey, companyKey } from './text.js';
import { isCountryCode } from './geo.js';
import { compileKeyword, keywordHit, normText, jobKeywordTokens } from './keywords.js';

const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : [])
  .map((x) => String(x ?? '').trim())
  .filter(Boolean);

/** Raw Actor input -> validated options with defaults. Throws a readable Error on bad input. */
export function normalizeInput(input = {}) {
  const remote = input.remote ?? 'any';
  if (!['any', 'remote_only', 'onsite_only'].includes(remote)) throw new Error(`"remote" must be any, remote_only or onsite_only (got ${remote})`);
  const keywordScope = input.keywordScope ?? 'title_and_description';
  if (!['title', 'title_and_description'].includes(keywordScope)) throw new Error(`"keywordScope" must be title or title_and_description (got ${keywordScope})`);
  const keywordMatch = input.keywordMatch ?? 'any';
  if (!['any', 'all'].includes(keywordMatch)) throw new Error(`"keywordMatch" must be any or all (got ${keywordMatch})`);
  const ats = strList(input.ats).map((a) => a.toLowerCase());
  for (const a of ats) if (!ATS_LIST.includes(a)) throw new Error(`Unknown ATS "${a}". Supported: ${ATS_LIST.join(', ')}`);
  const employmentTypes = strList(input.employmentTypes).map((e) => e.toLowerCase().replace(/[\s-]+/g, '_'));
  for (const e of employmentTypes) if (!EMPLOYMENT_TYPES.includes(e)) throw new Error(`Unknown employment type "${e}". Use: ${EMPLOYMENT_TYPES.join(', ')}`);
  const maxResults = input.maxResults === undefined || input.maxResults === null ? 100 : Number(input.maxResults);
  if (!Number.isInteger(maxResults) || maxResults < 1) throw new Error('"maxResults" must be a positive integer');
  const postedWithinDays = input.postedWithinDays === undefined || input.postedWithinDays === null || input.postedWithinDays === ''
    ? null : Number(input.postedWithinDays);
  if (postedWithinDays !== null && (!Number.isFinite(postedWithinDays) || postedWithinDays <= 0)) throw new Error('"postedWithinDays" must be a positive number');

  const boardRefs = [...strList(input.companyUrls), ...strList(input.boards)];
  const boards = [];
  const badRefs = [];
  const seen = new Set();
  for (const ref of boardRefs) {
    const b = parseBoardRef(ref);
    if (!b) { badRefs.push(ref); continue; }
    const k = boardKey(b);
    if (!seen.has(k)) { seen.add(k); boards.push(b); }
  }

  return {
    mode: boards.length > 0 || badRefs.length > 0 ? 'live' : 'search',
    boards,
    badRefs,
    keywords: strList(input.keywords),
    keywordMatch,
    keywordScope,
    excludeKeywords: strList(input.excludeKeywords),
    locations: strList(input.locations),
    remote,
    companies: strList(input.companies),
    ats,
    departments: strList(input.departments),
    employmentTypes,
    postedWithinDays,
    sinceLastRun: Boolean(input.sinceLastRun),
    includeDescription: input.includeDescription === undefined ? true : Boolean(input.includeDescription),
    maxResults,
  };
}

/** Filter subset that defines an incremental "feed" (the cursor key). */
export function filterIdentity(opts) {
  const sorted = (a) => [...a].map((x) => x.toLowerCase()).sort();
  return {
    mode: opts.mode,
    boards: opts.boards.map(boardKey).sort(),
    keywords: sorted(opts.keywords),
    keywordMatch: opts.keywordMatch,
    keywordScope: opts.keywordScope,
    excludeKeywords: sorted(opts.excludeKeywords),
    locations: sorted(opts.locations),
    remote: opts.remote,
    companies: sorted(opts.companies),
    ats: sorted(opts.ats),
    departments: sorted(opts.departments),
    employmentTypes: sorted(opts.employmentTypes),
    postedWithinDays: opts.postedWithinDays,
  };
}

const lc = (s) => String(s ?? '').toLowerCase();

/** Company filter term matches a job's board token or (normalized) company name. */
export function companyMatches(term, job) {
  const t = lc(term).trim();
  const ref = parseBoardRef(term);
  if (ref && /[:/.]/.test(term)) return ref.ats === job.ats && lc(ref.token) === lc(job.company_board);
  if (t === lc(job.company_board)) return true;
  const ck = companyKey(term);
  const jk = companyKey(job.company_name);
  if (!ck || !jk) return false;
  return ck === jk || (ck.length >= 4 && ` ${jk} `.includes(` ${ck} `));
}

/**
 * opts -> predicate(job, now). All filters are AND-ed; values inside one filter are OR-ed
 * (except keywords with keywordMatch "all").
 */
export function compileFilter(opts) {
  const kws = opts.keywords.map(compileKeyword).filter((k) => k.phrase);
  const scope = opts.keywordScope || 'title_and_description';
  const excl = opts.excludeKeywords.map(lc);
  const locTerms = opts.locations.map((l) => ({ raw: l, text: normKey(l), code: isCountryCode(l) ? l.toUpperCase().replace(/^UK$/, 'GB') : null }));
  const depts = opts.departments.map(lc);
  const ats = new Set(opts.ats);
  const emp = new Set(opts.employmentTypes);
  const maxAgeMs = opts.postedWithinDays ? opts.postedWithinDays * 86400000 : null;

  return (job, now = Date.now()) => {
    if (ats.size && !ats.has(job.ats)) return false;
    if (opts.remote === 'remote_only' && !(job.workplace_type === 'remote' || job.remote === true)) return false;
    if (opts.remote === 'onsite_only' && (job.workplace_type === 'remote' || job.remote === true)) return false;
    if (emp.size && !emp.has(job.employment_type)) return false;
    if (maxAgeMs !== null) {
      const t = job.posted_at ? Date.parse(job.posted_at) : NaN;
      if (!Number.isFinite(t) || now - t > maxAgeMs) return false;
    }
    if (opts.companies.length && !opts.companies.some((c) => companyMatches(c, job))) return false;
    if (depts.length) {
      const d = `${lc(job.department)} | ${lc(job.team)}`;
      if (!depts.some((x) => d.includes(x))) return false;
    }
    if (locTerms.length) {
      const text = ` ${normKey(job.locations.join(' | '))} `;
      const ok = locTerms.some((l) => (l.code && job.country_codes.includes(l.code)) || (l.text && text.includes(` ${l.text} `)));
      if (!ok) return false;
    }
    const title = lc(job.title);
    if (excl.length && excl.some((x) => title.includes(x))) return false;
    if (kws.length) {
      const titleNorm = normText(job.title);
      let vocab = null;
      // Index rows carry `kw` (job words + the board's shared words); live rows are tokenized here.
      const getVocab = () => vocab || (vocab = new Set([
        ...titleNorm.split(' '),
        ...(typeof job.kw === 'string' ? job.kw.split(' ') : jobKeywordTokens(job)),
      ]));
      const hit = (k) => keywordHit(k, titleNorm, getVocab, scope);
      const ok = opts.keywordMatch === 'all' ? kws.every(hit) : kws.some(hit);
      if (!ok) return false;
    }
    return true;
  };
}
