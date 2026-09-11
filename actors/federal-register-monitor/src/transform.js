// Pure transforms for federalregister.gov API v1 responses.
import { isoDate } from './lib/records.js';

export const FR_BASE = 'https://www.federalregister.gov/api/v1/documents.json';

/** One FR document -> flat record (or null if malformed). */
export function docToRecord(doc) {
  if (!doc || !doc.document_number) return null;
  return {
    document_number: doc.document_number,
    title: doc.title || null,
    document_type: doc.type || null,
    abstract: doc.abstract || null,
    agencies: (doc.agencies || []).map((a) => a.name || a.raw_name).filter(Boolean),
    published_at: isoDate(doc.publication_date),
    html_url: doc.html_url || null,
    pdf_url: doc.pdf_url || null,
  };
}

/** Full documents response -> { total, records[] }. */
export function parseDocumentsResponse(response) {
  if (!response || !Array.isArray(response.results)) {
    const e = new Error('Unexpected Federal Register response shape: results missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  return {
    total: response.count ?? response.results.length,
    records: response.results.map(docToRecord).filter(Boolean),
  };
}

/** Build a documents.json URL for one page. */
export function buildUrl({ term, documentTypes = [], agencySlugs = [], publishedAfter = null, page = 1, perPage = 100 }) {
  const p = new URLSearchParams();
  if (term) p.set('conditions[term]', term);
  for (const t of documentTypes) p.append('conditions[type][]', t);
  for (const a of agencySlugs) p.append('conditions[agencies][]', a);
  if (publishedAfter) p.set('conditions[publication_date][gte]', publishedAfter);
  p.set('order', 'newest');
  p.set('per_page', String(perPage));
  if (page > 1) p.set('page', String(page));
  if (!term && documentTypes.length === 0 && agencySlugs.length === 0) {
    const e = new Error('At least one of searchTerm, documentTypes, or agencySlugs is required.');
    e.failureClass = 'http_error';
    throw e;
  }
  return `${FR_BASE}?${p.toString()}`;
}
