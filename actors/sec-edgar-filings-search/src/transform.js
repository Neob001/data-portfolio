// Pure transforms for SEC EDGAR full-text search responses. No I/O here so
// tests run against golden fixtures without the Apify SDK.
import { isoDate } from './lib/records.js';

const EDGAR_DOC_URL = 'https://www.sec.gov/Archives/edgar/data';

/** Company name without the trailing "(CIK 0001234567)" suffix. */
function cleanName(displayName) {
  return (displayName || '').replace(/\s*\(CIK \d+\)\s*$/, '').trim();
}

/** One FTS hit -> one flat filing record (or null if malformed). */
export function hitToRecord(hit) {
  const s = hit && hit._source;
  if (!s || !s.adsh || !Array.isArray(s.ciks) || s.ciks.length === 0) return null;
  const cik = String(parseInt(s.ciks[0], 10));
  const accessionNoDashes = s.adsh.replace(/-/g, '');
  const [, fileName = ''] = String(hit._id || '').split(':');
  return {
    accession_number: s.adsh,
    cik,
    company_name: cleanName((s.display_names || [])[0]),
    form_type: s.form || (s.root_forms || [])[0] || null,
    file_type: s.file_type || null,
    filed_at: isoDate(s.file_date),
    period_ending: isoDate(s.period_ending),
    items: s.items || [],
    sic_codes: s.sics || [],
    incorporated_in: (s.inc_states || [])[0] || null,
    document_url: fileName
      ? `${EDGAR_DOC_URL}/${cik}/${accessionNoDashes}/${fileName}`
      : `${EDGAR_DOC_URL}/${cik}/${accessionNoDashes}`,
    filing_index_url: `${EDGAR_DOC_URL}/${cik}/${accessionNoDashes}/${s.adsh}-index.htm`,
  };
}

/** Full FTS response -> { total, records[] } with malformed hits dropped. */
export function parseFtsResponse(response) {
  const hits = response?.hits?.hits;
  if (!Array.isArray(hits)) {
    const e = new Error('Unexpected SEC FTS response shape: hits.hits missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  return {
    total: response.hits.total?.value ?? hits.length,
    rawCount: hits.length,
    records: hits.map(hitToRecord).filter(Boolean),
  };
}

/** Build the FTS query URL for one page. */
export function buildFtsUrl({ query, forms, startDate, endDate, from = 0 }) {
  const p = new URLSearchParams({ q: `"${query}"` });
  if (forms && forms.length) p.set('forms', forms.join(','));
  if (startDate || endDate) {
    // EDGAR ignores startdt/enddt unless dateRange=custom and both bounds are present.
    p.set('dateRange', 'custom');
    p.set('startdt', startDate || '2001-01-01');
    p.set('enddt', endDate || new Date().toISOString().slice(0, 10));
  }
  if (from > 0) p.set('from', String(from));
  return `https://efts.sec.gov/LATEST/search-index?${p.toString()}`;
}
