// TED Search API v3 notice -> normalized record. Pure (no I/O).
import { clean, countryCode, cpvList, deriveStatus, finalize, isoTs, langCode, num, snippet } from './normalize.mjs';

export const TED_SEARCH_URL = 'https://api.ted.europa.eu/v3/notices/search';

// Only what the record needs (no contact, person or winner fields are requested at all).
export const TED_FIELDS = [
  'publication-number', 'notice-type', 'procedure-type', 'notice-title', 'buyer-name', 'buyer-country',
  'classification-cpv', 'description-proc', 'description-lot', 'estimated-value-proc', 'estimated-value-cur-proc',
  'estimated-value-glo', 'estimated-value-cur-glo', 'total-value', 'total-value-cur', 'deadline-receipt-tender-date-lot',
  'deadline-receipt-request-date-lot', 'winner-decision-date', 'official-language', 'identifier-lot', 'publication-date',
];

const TYPE = [
  [/^(pin-cfc|cn-|qu-sy|subco)/, 'tender'],
  [/^(pin-|pmc)/, 'planning'],
  [/^can-modif/, 'contract'],
  [/^(can-|veat)/, 'award'],
  [/^compl/, 'contract'],
];

export function tedNoticeType(code) {
  const c = String(code || '').toLowerCase();
  for (const [rx, t] of TYPE) if (rx.test(c)) return t;
  return 'other';
}

const first = (v) => (Array.isArray(v) ? v[0] : v);

/** Multilingual {lang: [values]|value} -> preferred language (eng), else the notice's own language, else any. */
export function pickLang(multi, prefer = []) {
  if (multi === undefined || multi === null) return null;
  if (typeof multi === 'string' || typeof multi === 'number') return String(multi);
  if (Array.isArray(multi)) return multi.length ? String(multi[0]) : null;
  const keys = Object.keys(multi);
  if (!keys.length) return null;
  const key = ['eng', ...prefer.map((p) => p.toLowerCase())].find((k) => keys.includes(k)) || keys[0];
  return first(multi[key]) ?? null;
}

const PROC = { open: 'open', restricted: 'restricted', 'neg-w-call': 'negotiated with call', 'neg-wo-call': 'negotiated without call', 'comp-dial': 'competitive dialogue', 'innovation': 'innovation partnership', oth: 'other' };

export function tedToRecord(n, { now = Date.now(), fetchedAt } = {}) {
  const pub = n?.['publication-number'];
  if (!pub) return null;
  const langs = [].concat(n['official-language'] || []);
  const type = tedNoticeType(n['notice-type']);
  // TED deadline fields are dates (the time sits in a separate field): a date-only deadline counts until 23:59:59Z.
  const deadlines = [].concat(n['deadline-receipt-tender-date-lot'] || [], n['deadline-receipt-request-date-lot'] || []).map(isoTs).filter(Boolean)
    .map((d) => d.replace(/T00:00:00Z$/, 'T23:59:59Z')).sort();
  const buyerCountry = countryCode(first(n['buyer-country']));
  const award = type === 'award' || type === 'contract';
  let amount = null;
  let currency = null;
  if (award && num(n['total-value']) !== null) {
    amount = num(n['total-value']);
    currency = first(n['total-value-cur']) || null;
  } else if (num(first(n['estimated-value-proc'])) !== null) {
    amount = num(first(n['estimated-value-proc']));
    currency = first(n['estimated-value-cur-proc']) || null;
  } else if (num(first(n['estimated-value-glo'])) !== null) {
    amount = num(first(n['estimated-value-glo']));
    currency = first(n['estimated-value-cur-glo']) || null;
  }
  const lots = [...new Set([].concat(n['identifier-lot'] || []))].length || null;
  const rec = {
    notice_id: `ted:${pub}`,
    source: 'ted',
    country_code: buyerCountry,
    buyer_name: clean(pickLang(n['buyer-name'], langs)),
    buyer_country: buyerCountry,
    title: snippet(pickLang(n['notice-title'], langs), 300),
    description_snippet: snippet(pickLang(n['description-proc'], langs) || pickLang(n['description-lot'], langs)),
    notice_type: type,
    procedure_type: PROC[n['procedure-type']] || clean(n['procedure-type']),
    cpv_codes: cpvList([].concat(n['classification-cpv'] || [])),
    naics_codes: [],
    unspsc_codes: [],
    value_amount: amount,
    value_currency: amount === null ? null : clean(currency),
    published_at: isoTs(n['publication-date']),
    deadline_at: type === 'tender' || type === 'planning' ? deadlines[deadlines.length - 1] || null : null,
    award_date: award ? [].concat(n['winner-decision-date'] || []).map(isoTs).filter(Boolean).sort().pop() || null : null,
    supplier_names: [], // v1: TED winners are not published (natural persons cannot be told apart)
    lots_count: lots,
    language: langCode(langs[0]),
    notice_url: `https://ted.europa.eu/en/notice/-/detail/${pub}`,
    source_url: `${TED_SEARCH_URL}?q=publication-number%3D${pub}`,
  };
  rec.status = deriveStatus(rec, null, now);
  return finalize(rec, fetchedAt);
}
