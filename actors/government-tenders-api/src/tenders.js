// Pure logic of government-tenders-api: input normalization, shard selection, record matching,
// keyword ranking and ordering. No I/O (tests import it directly).

/** Dataset fields, in output order (= scripts/tenders_index/lib/normalize.mjs RECORD_FIELDS). */
export const OUTPUT_FIELDS = [
  'notice_id', 'source', 'country_code', 'buyer_name', 'buyer_country', 'title', 'description_snippet',
  'notice_type', 'procedure_type', 'status', 'cpv_codes', 'naics_codes', 'unspsc_codes', 'value_amount',
  'value_currency', 'published_at', 'deadline_at', 'award_date', 'supplier_names', 'lots_count', 'language',
  'notice_url', 'source_url', 'fetched_at',
];

export const NOTICE_TYPES = ['planning', 'tender', 'award', 'contract', 'cancellation', 'other'];
export const SORTS = ['relevance', 'newest', 'deadline', 'value'];
const DAY = 86400000;

const fold = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : [])
  .map((x) => String(x).trim()).filter(Boolean);

function bad(message) {
  const e = new Error(message);
  e.failureClass = 'http_error';
  e.inputError = true;
  return e;
}

/** Raw Actor input -> validated options (throws an input error with a readable message). */
export function normalizeInput(input = {}, now = Date.now()) {
  const o = {
    keywords: list(input.keywords).map(fold),
    keywordMatch: input.keywordMatch === 'all' ? 'all' : 'any',
    countries: list(input.countries).map((c) => c.toUpperCase()).map((c) => (c === 'UK' ? 'GB' : c)),
    cpvCodes: list(input.cpvCodes).map((c) => c.replace(/\D/g, '')).filter(Boolean),
    naicsCodes: list(input.naicsCodes).map((c) => c.replace(/\D/g, '')).filter(Boolean),
    noticeTypes: list(input.noticeTypes).map((t) => t.toLowerCase()),
    openOnly: input.openOnly === true,
    minValue: input.minValue === undefined || input.minValue === null || input.minValue === '' ? null : Number(input.minValue),
    maxValue: input.maxValue === undefined || input.maxValue === null || input.maxValue === '' ? null : Number(input.maxValue),
    currency: input.currency ? String(input.currency).trim().toUpperCase() : null,
    publishedWithinDays: input.publishedWithinDays ? Number(input.publishedWithinDays) : null,
    deadlineAfter: input.deadlineAfter ? String(input.deadlineAfter).trim() : null,
    buyers: list(input.buyers).map(fold),
    sources: list(input.sources).map((s) => s.toLowerCase()),
    sortBy: SORTS.includes(input.sortBy) ? input.sortBy : null,
    maxResults: input.maxResults === undefined ? 100 : Number(input.maxResults),
    sinceLastRun: input.sinceLastRun === true,
  };
  for (const c of o.countries) if (!/^[A-Z]{2}$/.test(c)) throw bad(`countries: "${c}" is not a 2-letter ISO country code (e.g. "DE", "US", "GB").`);
  for (const t of o.noticeTypes) if (!NOTICE_TYPES.includes(t)) throw bad(`noticeTypes: "${t}" is not one of ${NOTICE_TYPES.join(', ')}.`);
  for (const k of ['minValue', 'maxValue']) if (o[k] !== null && !(Number.isFinite(o[k]) && o[k] >= 0)) throw bad(`${k} must be a number >= 0.`);
  if (o.publishedWithinDays !== null && !(Number.isInteger(o.publishedWithinDays) && o.publishedWithinDays > 0)) throw bad('publishedWithinDays must be a whole number of days >= 1.');
  if (o.deadlineAfter && !/^\d{4}-\d{2}-\d{2}$/.test(o.deadlineAfter)) throw bad('deadlineAfter must be a date like 2026-12-01.');
  if (!(Number.isInteger(o.maxResults) && o.maxResults >= 1 && o.maxResults <= 100000)) throw bad('maxResults must be between 1 and 100,000.');
  o.sortBy ||= o.keywords.length ? 'relevance' : (o.openOnly ? 'deadline' : 'newest');
  o.publishedAfter = o.publishedWithinDays ? new Date(now - o.publishedWithinDays * DAY).toISOString() : null;
  o.deadlineAfterTs = o.deadlineAfter ? `${o.deadlineAfter}T00:00:00Z` : null;
  return o;
}

/** Filters that define the incremental cursor (sort order and maxResults do not). */
export function cursorFilters(o) {
  const { keywords, keywordMatch, countries, cpvCodes, naicsCodes, noticeTypes, openOnly, minValue, maxValue, currency, deadlineAfter, buyers, sources } = o;
  return { keywords, keywordMatch, countries, cpvCodes, naicsCodes, noticeTypes, openOnly, minValue, maxValue, currency, deadlineAfter, buyers, sources };
}

/** Shards that can hold a match; newest publication band first. */
export function selectShards(manifest, o, { publishedAfter = o.publishedAfter, now = Date.now() } = {}) {
  const nowIso = new Date(now).toISOString();
  return (manifest.shards || []).filter((s) => {
    if (o.sources.length && !o.sources.includes(s.source)) return false;
    if (o.countries.length && !(s.countries || []).some((c) => o.countries.includes(c))) return false;
    if (o.noticeTypes.length && s.notice_types && !s.notice_types.some((t) => o.noticeTypes.includes(t))) return false;
    if (publishedAfter && s.published_to && s.published_to < publishedAfter) return false;
    if (o.openOnly && !(s.deadline_max && s.deadline_max > nowIso)) return false;
    if (o.deadlineAfterTs && !(s.deadline_max && s.deadline_max >= o.deadlineAfterTs)) return false;
    return true;
  }).sort((a, b) => a.band - b.band || String(a.source).localeCompare(String(b.source)) || a.part - b.part);
}

/** Status as of `now`: a tender whose deadline passed since the nightly build is closed. */
export function currentStatus(r, now = Date.now()) {
  if ((r.notice_type === 'tender' || r.notice_type === 'planning') && r.deadline_at && r.status !== 'cancelled') {
    if (Date.parse(r.deadline_at) > now) return 'open';
    return r.notice_type === 'tender' ? 'closed' : 'unknown';
  }
  return r.status;
}

function wordRx(k) {
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Phrase at a word start; a trailing plural "s"/"es" is allowed ("laptop" finds "laptops").
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${esc}(?:e?s)?(?![\\p{L}\\p{N}])`, 'u');
}

/** Keyword matcher: returns 0 for no match, else a score (title hits weigh 3, description 1). */
export function keywordScorer(o) {
  if (!o.keywords.length) return () => 1;
  const rxs = o.keywords.map(wordRx);
  return (r) => {
    const t = fold(r.title);
    const d = fold(r.description_snippet);
    let score = 0;
    let hits = 0;
    for (const rx of rxs) {
      const inT = rx.test(t);
      const inD = !inT && rx.test(d);
      if (inT || inD) hits += 1;
      score += inT ? 3 : inD ? 1 : 0;
    }
    if (!hits || (o.keywordMatch === 'all' && hits < rxs.length)) return 0;
    return score;
  };
}

/** Record filter (everything except keywords). Mutates r.status to the current status. */
export function recordMatcher(o, now = Date.now()) {
  return (r) => {
    r.status = currentStatus(r, now);
    if (o.sources.length && !o.sources.includes(r.source)) return false;
    if (o.countries.length && !o.countries.includes(r.country_code) && !o.countries.includes(r.buyer_country)) return false;
    if (o.noticeTypes.length && !o.noticeTypes.includes(r.notice_type)) return false;
    if (o.openOnly && r.status !== 'open') return false;
    if (o.publishedAfter && !(r.published_at >= o.publishedAfter)) return false;
    if (o.deadlineAfterTs && !(r.deadline_at && r.deadline_at >= o.deadlineAfterTs)) return false;
    if (o.cpvCodes.length && !(r.cpv_codes || []).some((c) => o.cpvCodes.some((p) => c.startsWith(p)))) return false;
    if (o.naicsCodes.length && !(r.naics_codes || []).some((c) => o.naicsCodes.some((p) => c.startsWith(p)))) return false;
    if (o.currency && r.value_currency !== o.currency) return false;
    if (o.minValue !== null && !(r.value_amount !== null && r.value_amount >= o.minValue)) return false;
    if (o.maxValue !== null && !(r.value_amount !== null && r.value_amount <= o.maxValue)) return false;
    if (o.buyers.length) {
      const b = fold(r.buyer_name);
      if (!o.buyers.some((x) => b.includes(x))) return false;
    }
    return true;
  };
}

const cmpDesc = (a, b) => (a > b ? -1 : a < b ? 1 : 0);

/** Comparator over {r, score}. */
export function comparator(sortBy) {
  const newest = (x, y) => cmpDesc(x.r.published_at, y.r.published_at) || (x.r.notice_id < y.r.notice_id ? -1 : 1);
  if (sortBy === 'relevance') return (x, y) => y.score - x.score || newest(x, y);
  if (sortBy === 'deadline') {
    return (x, y) => {
      const a = x.r.deadline_at || '9999';
      const b = y.r.deadline_at || '9999';
      return a < b ? -1 : a > b ? 1 : newest(x, y);
    };
  }
  if (sortBy === 'value') return (x, y) => (y.r.value_amount ?? -1) - (x.r.value_amount ?? -1) || newest(x, y);
  return newest;
}

/** Bounded top-N collector: keeps the best `n` items under `cmp` while scanning millions. */
export function topN(n, cmp) {
  let items = [];
  let total = 0;
  const limit = Math.max(n * 4, 5000);
  return {
    push(x) {
      items.push(x);
      total += 1;
      if (items.length > limit) items = items.sort(cmp).slice(0, n);
    },
    result() {
      return items.sort(cmp).slice(0, n);
    },
    get total() {
      return total;
    },
  };
}

/** Index record -> output row with exactly OUTPUT_FIELDS. */
export function toRow(r) {
  const out = {};
  for (const k of OUTPUT_FIELDS) out[k] = r[k] === undefined ? (k.endsWith('_codes') || k === 'supplier_names' ? [] : null) : r[k];
  return out;
}
