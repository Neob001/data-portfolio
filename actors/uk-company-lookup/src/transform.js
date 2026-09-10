// Pure transforms for Companies House API responses. Company facts only —
// deliberately NO officers/PSC endpoints (personal data; see DECISIONS.md).
import { isoDate } from './lib/records.js';

export const CH_BASE = 'https://api.company-information.service.gov.uk';

function joinAddress(a) {
  if (!a || typeof a !== 'object') return null;
  return [a.premises, a.address_line_1, a.address_line_2, a.locality, a.region, a.postal_code, a.country]
    .filter(Boolean)
    .join(', ') || null;
}

/** Company profile response -> flat record (or null if malformed). */
export function profileToRecord(p) {
  if (!p || !p.company_number) return null;
  return {
    company_number: p.company_number,
    company_name: p.company_name || null,
    status: p.company_status || null,
    company_type: p.type || null,
    jurisdiction: p.jurisdiction || null,
    incorporated_on: isoDate(p.date_of_creation),
    dissolved_on: isoDate(p.date_of_cessation),
    sic_codes: p.sic_codes || [],
    registered_office: joinAddress(p.registered_office_address),
    registered_office_postcode: p.registered_office_address?.postal_code || null,
    accounts_next_due: isoDate(p.accounts?.next_due),
    accounts_overdue: p.accounts?.overdue ?? null,
    confirmation_statement_next_due: isoDate(p.confirmation_statement?.next_due),
    has_insolvency_history: p.has_insolvency_history ?? null,
    has_charges: p.has_charges ?? null,
    company_url: `https://find-and-update.company-information.service.gov.uk/company/${p.company_number}`,
  };
}

/** Search response -> best match company number for a name (or null). */
export function bestSearchMatch(searchResponse, name) {
  const items = searchResponse?.items;
  if (!Array.isArray(items)) {
    const e = new Error('Unexpected Companies House search response: items missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  if (items.length === 0) return null;
  const norm = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const target = norm(name);
  const exact = items.find((i) => norm(i.title) === target);
  return (exact || items[0]).company_number || null;
}

/** Normalize a user-supplied company number: pad to 8 chars for numeric ids. */
export function normalizeCompanyNumber(n) {
  const s = String(n || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;
  return /^\d+$/.test(s) ? s.padStart(8, '0') : s;
}
