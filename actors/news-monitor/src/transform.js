// Pure transforms for the GDELT DOC 2.0 API (https://api.gdeltproject.org/api/v2/doc/doc).
// No I/O here: query/URL building, time-window splitting, response parsing, date conversion,
// URL-based dedupe filtering and risk-term matching. See src/client.js for the network glue
// (rate limiting + GDELT's non-JSON "please limit requests" replies) and src/monitor.js for the
// stateful orchestration that calls these helpers while walking the run's time window.
import { createHash } from 'node:crypto';

export const GDELT_BASE = 'https://api.gdeltproject.org/api/v2/doc/doc';
export const GDELT_MAX_RECORDS = 250;

// GDELT terms of use (verified live 2026-09-18, https://www.gdeltproject.org/about.html#termsofuse):
// "all datasets released by the GDELT Project are available for unlimited and unrestricted use
// for any academic, commercial, or governmental use of any kind without fee", conditional on
// citing the GDELT Project and linking to https://www.gdeltproject.org/ wherever the data is
// redistributed. We satisfy that by stamping this string onto every output record and in the README.
export const ATTRIBUTION = 'GDELT Project, https://www.gdeltproject.org';

// Curated adverse-media / risk-term group, ANDed onto the user query in "adverse_media" mode.
// Matching against article titles (matchRiskTerms) is necessarily best-effort: the DOC API
// returns only a title + metadata per article, never full body text.
export const RISK_TERMS = [
  'fraud', 'bribery', 'corruption', 'money laundering', 'sanctions', 'lawsuit',
  'indictment', 'investigation', 'scandal', 'bankruptcy', 'data breach', 'recall',
];
export const RISK_TERM_CLAUSE = RISK_TERMS.map((t) => (t.includes(' ') ? `"${t}"` : t)).join(' OR ');

function schemaError(message) {
  return Object.assign(new Error(message), { failureClass: 'schema_change' });
}

/** GDELT query-language OR-group for one field, e.g. sourcecountry:US OR sourcecountry:GB. */
function orGroup(field, values) {
  const vs = (values || []).filter(Boolean);
  return vs.length ? `(${vs.map((v) => `${field}:${v}`).join(' OR ')})` : null;
}

/**
 * Compose the full GDELT query string: the user's query (quoted phrases / boolean operators
 * are the caller's own GDELT syntax, passed through unchanged), ANDed with the adverse-media
 * risk-term group when mode is "adverse_media", and ANDed with any sourcelang/sourcecountry/
 * domain OR-groups.
 */
export function buildQuery({ query, mode = 'news', languages = [], countries = [], domains = [] }) {
  if (!query || !String(query).trim()) {
    throw Object.assign(new Error('A non-empty query is required.'), { failureClass: 'http_error' });
  }
  const base = mode === 'adverse_media' ? `(${query}) AND (${RISK_TERM_CLAUSE})` : query;
  const clauses = [orGroup('sourcelang', languages), orGroup('sourcecountry', countries), orGroup('domain', domains)]
    .filter(Boolean);
  return [base, ...clauses].join(' ');
}

/** JS Date (or epoch ms) -> GDELT STARTDATETIME/ENDDATETIME format: YYYYMMDDHHMMSS, UTC. */
export function toGdeltDateTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const iso = d.toISOString(); // 2026-09-08T14:00:00.000Z
  return iso.slice(0, 4) + iso.slice(5, 7) + iso.slice(8, 10) + iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19);
}

/** Build one ArtList/JSON request URL for a [startDate, endDate) window. */
export function buildUrl({ query, mode = 'news', languages = [], countries = [], domains = [], startDate, endDate, maxrecords = GDELT_MAX_RECORDS }) {
  const q = buildQuery({ query, mode, languages, countries, domains });
  const p = new URLSearchParams();
  p.set('query', q);
  p.set('mode', 'ArtList');
  p.set('format', 'json');
  p.set('maxrecords', String(Math.min(maxrecords, GDELT_MAX_RECORDS)));
  p.set('sort', 'DateDesc');
  p.set('startdatetime', toGdeltDateTime(startDate));
  p.set('enddatetime', toGdeltDateTime(endDate));
  return `${GDELT_BASE}?${p.toString()}`;
}

/**
 * ArtList/JSON response -> array of raw article objects.
 * GDELT returns a bare `{}` (no "articles" key at all) when a window matches zero articles --
 * verified live 2026-09-18 -- so a missing key means "no results", not a schema change. Only a
 * present-but-non-array `articles` value, or a non-object response body, is treated as malformed.
 */
export function parseArtList(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) {
    throw schemaError('Unexpected GDELT response shape: expected a JSON object');
  }
  if (response.articles === undefined) return [];
  if (!Array.isArray(response.articles)) {
    throw schemaError('Unexpected GDELT response shape: articles is not an array');
  }
  return response.articles;
}

/** GDELT seendate ("20260908T140000Z") -> ISO 8601 datetime, or null if unparseable. */
export function seenDateToIso(seendate) {
  if (typeof seendate !== 'string') return null;
  const m = seendate.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** sha1 hex digest, used for the article_id (stable id GDELT itself does not provide). */
export function sha1Hex(str) {
  return createHash('sha1').update(String(str)).digest('hex');
}

/** Risk terms (lowercase, from RISK_TERMS) that appear in the title. Best-effort, title only. */
export function matchRiskTerms(title) {
  if (!title) return [];
  const lower = title.toLowerCase();
  return RISK_TERMS.filter((t) => lower.includes(t));
}

/** One raw GDELT article -> flat output record, or null if it has no URL (nothing to key on). */
export function articleToRecord(article, { query, mode }) {
  if (!article || !article.url) return null;
  const title = article.title || null;
  return {
    query,
    mode,
    title,
    url: article.url,
    domain: article.domain || null,
    source_country: article.sourcecountry || null,
    language: article.language || null,
    published_at: seenDateToIso(article.seendate),
    image_url: article.socialimage || null,
    matched_risk_terms: mode === 'adverse_media' ? matchRiskTerms(title) : [],
    article_id: sha1Hex(article.url),
    attribution: ATTRIBUTION,
  };
}

/** Articles from one window response, minus any URL already seen in an earlier window/query. */
export function filterNewByUrl(articles, seenUrls) {
  return articles.filter((a) => a && a.url && !seenUrls.has(a.url));
}

// A returned batch at the API cap (250) means the true window almost certainly holds more than
// fit in one page; GDELT DOC has no offset/cursor param, so we narrow the time window instead.
// MIN_WINDOW_MS stops recursion once further splitting can no longer be meaningful (GDELT dates
// have 1-second resolution; a few minutes is already a generous floor for pathologically dense
// windows) and MAX_SPLIT_DEPTH is a hard backstop against runaway recursion.
export const MIN_WINDOW_MS = 2 * 60 * 1000;
export const MAX_SPLIT_DEPTH = 20;

/** True when a window's result count indicates truncation (hit the API cap) and is still worth splitting. */
export function needsSplit(articleCount, startMs, endMs, depth) {
  return articleCount >= GDELT_MAX_RECORDS && endMs - startMs > MIN_WINDOW_MS && depth < MAX_SPLIT_DEPTH;
}

/** Bisect [startMs, endMs) into two contiguous, non-overlapping halves. */
export function splitWindow(startMs, endMs) {
  const midMs = startMs + Math.floor((endMs - startMs) / 2);
  return [[startMs, midMs], [midMs, endMs]];
}
