// Pure transforms for TED (Tenders Electronic Daily) Search API v3 responses.
// No I/O here so tests run against golden fixtures without the Apify SDK.
import { isoDate } from './lib/records.js';

export const TED_SEARCH_URL = 'https://api.ted.europa.eu/v3/notices/search';

export const TED_FIELDS = [
  'publication-number', 'notice-title', 'buyer-name', 'buyer-country',
  'publication-date', 'deadline-receipt-request', 'classification-cpv',
  'place-of-performance', 'contract-nature', 'links',
];

/** Pick English from a TED multilingual {lang: [values]|value} map, else first. */
export function pickLang(multi) {
  if (multi === undefined || multi === null) return null;
  if (typeof multi === 'string') return multi;
  if (Array.isArray(multi)) return multi[0] ?? null;
  const langs = Object.keys(multi);
  if (langs.length === 0) return null;
  const key = langs.find((l) => l === 'eng') || langs[0];
  const v = multi[key];
  return Array.isArray(v) ? v[0] ?? null : v;
}

const uniq = (arr) => [...new Set(arr || [])];

/** One TED notice -> one flat tender record (or null if malformed). */
export function noticeToRecord(notice) {
  if (!notice || !notice['publication-number']) return null;
  const links = notice.links || {};
  const pick = (k) => (links[k] ? Object.values(links[k])[0] : null);
  return {
    publication_number: notice['publication-number'],
    title: pickLang(notice['notice-title']),
    buyer_name: pickLang(notice['buyer-name']),
    buyer_country: pickLang(notice['buyer-country']),
    published_at: isoDate(String(notice['publication-date'] || '').slice(0, 10)),
    submission_deadline: (notice['deadline-receipt-request'] || [])[0] || null,
    cpv_codes: uniq(notice['classification-cpv']),
    places_of_performance: uniq(notice['place-of-performance']),
    contract_nature: pickLang(notice['contract-nature']),
    notice_url: pick('html') || pick('htmlDirect'),
    pdf_url: pick('pdf'),
  };
}

/** Full search response -> { total, records[], nextToken } */
export function parseSearchResponse(response) {
  if (!response || !Array.isArray(response.notices)) {
    const e = new Error('Unexpected TED response shape: notices missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  return {
    total: response.totalNoticeCount ?? response.notices.length,
    nextToken: response.iterationNextToken || null,
    records: response.notices.map(noticeToRecord).filter(Boolean),
  };
}

/** Build the TED expert query from friendly inputs. */
export function buildQuery({ cpvCodes = [], countries = [], text = null, publishedAfter = null }) {
  const parts = [];
  if (cpvCodes.length) parts.push(`(classification-cpv IN (${cpvCodes.join(' ')}))`);
  if (countries.length) parts.push(`(buyer-country IN (${countries.join(' ')}))`);
  if (text) parts.push(`(FT ~ ("${text.replace(/"/g, '')}"))`);
  if (publishedAfter) parts.push(`(publication-date > ${publishedAfter.replace(/-/g, '')})`);
  if (parts.length === 0) {
    const e = new Error('At least one of cpvCodes, countries, or fullTextSearch is required.');
    e.failureClass = 'http_error';
    throw e;
  }
  return parts.join(' AND ');
}
