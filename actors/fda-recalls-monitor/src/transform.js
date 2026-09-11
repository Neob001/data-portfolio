// Pure transforms for openFDA enforcement API responses.
import { isoDate } from './lib/records.js';

export const CATEGORIES = { food: 'food', drug: 'drug', device: 'device' };

/** openFDA dates come as YYYYMMDD. */
function fdaDate(v) {
  if (!v || !/^\d{8}$/.test(v)) return null;
  return isoDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`);
}

/** One enforcement result -> flat record (or null). */
export function recallToRecord(r) {
  if (!r || !r.recall_number) return null;
  return {
    recall_number: r.recall_number,
    event_id: r.event_id || null,
    product_type: r.product_type || null,
    classification: r.classification || null,
    status: r.status || null,
    recalling_firm: r.recalling_firm || null,
    city: r.city || null,
    state: r.state || null,
    country: r.country || null,
    product_description: r.product_description || null,
    reason_for_recall: r.reason_for_recall || null,
    product_quantity: r.product_quantity || null,
    distribution_pattern: r.distribution_pattern || null,
    voluntary_mandated: r.voluntary_mandated || null,
    recall_initiation_date: fdaDate(r.recall_initiation_date),
    report_date: fdaDate(r.report_date),
  };
}

/** Full response -> { total, records[] }. openFDA 404s on empty result sets. */
export function parseEnforcementResponse(response) {
  if (!response || !Array.isArray(response.results)) {
    const e = new Error('Unexpected openFDA response shape: results missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  return {
    total: response.meta?.results?.total ?? response.results.length,
    records: response.results.map(recallToRecord).filter(Boolean),
  };
}

/** Build the enforcement.json URL. */
export function buildUrl({ category = 'food', searchTerm = null, classifications = [], reportedAfter = null, skip = 0, limit = 100 }) {
  if (!CATEGORIES[category]) {
    const e = new Error(`Unknown category "${category}"; use food, drug, or device.`);
    e.failureClass = 'http_error';
    throw e;
  }
  const clauses = [];
  if (searchTerm) clauses.push(`(${searchTerm.replace(/[^\w\s"'-]/g, ' ').trim().split(/\s+/).map((w) => `"${w}"`).join('+AND+')})`);
  if (classifications.length) clauses.push(`(${classifications.map((c) => `classification:"${c}"`).join('+OR+')})`);
  if (reportedAfter) clauses.push(`report_date:[${reportedAfter.replace(/-/g, '')}+TO+99991231]`);
  const params = [`limit=${limit}`];
  if (skip > 0) params.push(`skip=${skip}`);
  if (clauses.length) params.push(`search=${clauses.join('+AND+')}`);
  return `https://api.fda.gov/${category}/enforcement.json?${params.join('&')}`;
}
