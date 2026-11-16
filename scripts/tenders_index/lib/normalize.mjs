// Pure helpers shared by every tenders source: the normalized record, dates, codes, PII redaction.
// No I/O here (tests import it directly). The Actor (actors/government-tenders-api) reads the records
// this produces; keep RECORD_FIELDS in sync with its dataset schema.

export const RECORD_FIELDS = [
  'notice_id', 'source', 'country_code', 'buyer_name', 'buyer_country', 'title', 'description_snippet',
  'notice_type', 'procedure_type', 'status', 'cpv_codes', 'naics_codes', 'unspsc_codes', 'value_amount',
  'value_currency', 'published_at', 'deadline_at', 'award_date', 'supplier_names', 'lots_count', 'language',
  'notice_url', 'source_url', 'fetched_at',
];

export const NOTICE_TYPES = ['planning', 'tender', 'award', 'contract', 'cancellation', 'other'];
export const STATUSES = ['open', 'closed', 'awarded', 'cancelled', 'unknown'];
export const SNIPPET_CHARS = 500;

const EMAIL_RX = /[A-Za-z0-9._%+-]+(?:@|\s?\(at\)\s?|\s?\[at\]\s?)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Separators are required so reference numbers, CPV/NAICS codes and amounts survive.
const PHONE_RX = /(?:\+|00)\d{1,3}[\s.-]?(?:\(0\)\s?)?\d{1,4}(?:[\s.-]\d{2,4}){2,4}\b|(?:\(\d{2,5}\)\s?|\b\d{3,5}[\s.-])\d{3,4}[\s.-]\d{3,4}\b(?:\s?(?:x|ext\.?)\s?\d{1,5})?/gi;

/** Mask e-mail addresses and phone numbers that notices embed in free text. */
export function redactContacts(text) {
  if (!text) return text;
  return text.replace(EMAIL_RX, '[email redacted]').replace(PHONE_RX, '[phone redacted]');
}

/** Whitespace-collapsed, contact-redacted text cut at `max` chars on a word boundary (… appended). */
export function snippet(text, max = SNIPPET_CHARS) {
  if (text === null || text === undefined) return null;
  let t = redactContacts(String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  if (!t) return null;
  if (t.length > max) {
    const cut = t.slice(0, max - 1);
    const sp = cut.lastIndexOf(' ');
    t = `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,;:.-]+$/, '')}…`;
  }
  return t;
}

export function clean(s) {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t === '' ? null : t;
}

/**
 * Any date-ish value -> ISO 8601 UTC timestamp without milliseconds ("2026-11-13T00:00:00Z"), or null.
 * A bare date (optionally with an offset, TED style "2026-11-13+01:00") is that calendar day at 00:00Z,
 * so the day never shifts.
 */
export function isoTs(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  const d = /^(\d{4}-\d{2}-\d{2})(?:Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (d) return `${d[1]}T00:00:00Z`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}T00:00:00Z`;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const y = new Date(t).getUTCFullYear();
  if (y < 1990 || y > 2100) return null;
  return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

export const uniq = (arr) => [...new Set((arr || []).filter((x) => x !== null && x !== undefined && x !== ''))];

/** CPV codes as 8 digits (check digit and suffixes dropped), deduplicated. */
export function cpvList(arr) {
  return uniq((arr || []).map((c) => {
    const m = /^(\d{8})/.exec(String(c).trim());
    return m ? m[1] : null;
  }));
}

const ISO3 = {
  AUT: 'AT', BEL: 'BE', BGR: 'BG', HRV: 'HR', CYP: 'CY', CZE: 'CZ', DNK: 'DK', EST: 'EE', FIN: 'FI', FRA: 'FR',
  DEU: 'DE', GRC: 'GR', HUN: 'HU', IRL: 'IE', ITA: 'IT', LVA: 'LV', LTU: 'LT', LUX: 'LU', MLT: 'MT', NLD: 'NL',
  POL: 'PL', PRT: 'PT', ROU: 'RO', SVK: 'SK', SVN: 'SI', ESP: 'ES', SWE: 'SE', NOR: 'NO', ISL: 'IS', LIE: 'LI',
  CHE: 'CH', GBR: 'GB', MKD: 'MK', SRB: 'RS', MNE: 'ME', ALB: 'AL', BIH: 'BA', MDA: 'MD', UKR: 'UA', GEO: 'GE',
  ARM: 'AM', AZE: 'AZ', TUR: 'TR', USA: 'US', CAN: 'CA', AUS: 'AU', NZL: 'NZ', JPN: 'JP', CHN: 'CN', IND: 'IN',
  BRA: 'BR', MEX: 'MX', ZAF: 'ZA', ISR: 'IL', MAR: 'MA', TUN: 'TN', EGY: 'EG', XKX: 'XK', AND: 'AD', MCO: 'MC',
  SMR: 'SM', VAT: 'VA', FRO: 'FO', GRL: 'GL', BLR: 'BY', RUS: 'RU', KAZ: 'KZ', SGP: 'SG', KOR: 'KR', ARE: 'AE',
  SAU: 'SA', NGA: 'NG', KEN: 'KE', ETH: 'ET', GHA: 'GH', SEN: 'SN', CIV: 'CI', CMR: 'CM', COD: 'CD', TZA: 'TZ',
  UGA: 'UG', ZMB: 'ZM', MOZ: 'MZ', AGO: 'AO', ARG: 'AR', CHL: 'CL', COL: 'CO', PER: 'PE', ECU: 'EC', URY: 'UY',
  PRY: 'PY', BOL: 'BO', VEN: 'VE', GTM: 'GT', HND: 'HN', SLV: 'SV', NIC: 'NI', CRI: 'CR', PAN: 'PA', DOM: 'DO',
  HTI: 'HT', JAM: 'JM', CUB: 'CU', PHL: 'PH', IDN: 'ID', MYS: 'MY', THA: 'TH', VNM: 'VN', PAK: 'PK', BGD: 'BD',
  LKA: 'LK', NPL: 'NP', JOR: 'JO', LBN: 'LB', IRQ: 'IQ', DZA: 'DZ', LBY: 'LY', SDN: 'SD', RWA: 'RW', MWI: 'MW',
  ZWE: 'ZW', BWA: 'BW', NAM: 'NA', MDG: 'MG', MUS: 'MU', TWN: 'TW', HKG: 'HK', GIB: 'GI', IMN: 'IM', JEY: 'JE',
  GGY: 'GG', REU: 'RE', GUF: 'GF', MTQ: 'MQ', GLP: 'GP', MYT: 'YT', NCL: 'NC', PYF: 'PF',
};

const NAMES = {
  'united kingdom': 'GB', uk: 'GB', 'great britain': 'GB', england: 'GB', scotland: 'GB', wales: 'GB', 'northern ireland': 'GB',
  'united states': 'US', usa: 'US', 'united states of america': 'US', australia: 'AU', canada: 'CA', ireland: 'IE',
  germany: 'DE', deutschland: 'DE', france: 'FR', netherlands: 'NL', nederland: 'NL', belgium: 'BE', spain: 'ES',
  italy: 'IT', ecuador: 'EC', peru: 'PE', perú: 'PE', guatemala: 'GT', honduras: 'HN', paraguay: 'PY', brazil: 'BR',
  brasil: 'BR', bulgaria: 'BG', greece: 'GR', 'south africa': 'ZA', uganda: 'UG', zambia: 'ZM', 'new zealand': 'NZ',
};

/** ISO 3166-1 alpha-2 from alpha-2, alpha-3 or a (common English) country name; null when unknown. */
export function countryCode(v) {
  const s = clean(v);
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase() === 'UK' ? 'GB' : s.toUpperCase();
  if (/^[A-Za-z]{3}$/.test(s)) return ISO3[s.toUpperCase()] || null;
  if (/^[A-Z]{2}-/.test(s)) return s.slice(0, 2); // ISO 3166-2 subdivision (DE-BY)
  return NAMES[s.toLowerCase()] || null;
}

const LANG3 = {
  ENG: 'en', DEU: 'de', FRA: 'fr', ITA: 'it', SPA: 'es', POL: 'pl', NLD: 'nl', POR: 'pt', RON: 'ro', CES: 'cs',
  SLK: 'sk', SLV: 'sl', HUN: 'hu', BUL: 'bg', HRV: 'hr', ELL: 'el', DAN: 'da', SWE: 'sv', FIN: 'fi', EST: 'et',
  LAV: 'lv', LIT: 'lt', MLT: 'mt', GLE: 'ga', NOR: 'no', ISL: 'is',
};

export function langCode(v) {
  const s = clean(v);
  if (!s) return null;
  if (/^[a-z]{2}(-[A-Za-z]{2})?$/i.test(s)) return s.slice(0, 2).toLowerCase();
  return LANG3[s.toUpperCase()] || null;
}

// Supplier names are only published when the supplier carries an identifier from a register that holds
// organisations only (companies, charities). Everything else is dropped: sole traders and natural persons
// cannot be told apart reliably (CLAUDE.md rule 3, no PII).
export const ORG_ONLY_SCHEMES = new Set(['GB-COH', 'GB-CHC', 'GB-SC', 'GB-NIC']);
const SOLE_TRADER_RX = /\b(t\/a|trading as|sole trader|self[- ]employed|freelance|mr|mrs|ms|miss|dr)\b\.?/i;

export function orgSupplierName(name, schemes) {
  const n = clean(name);
  if (!n || SOLE_TRADER_RX.test(n)) return null;
  return (schemes || []).some((s) => ORG_ONLY_SCHEMES.has(String(s || '').toUpperCase())) ? n : null;
}

/** Status at time `now` from type + deadline + an optional source status hint. */
export function deriveStatus({ notice_type: type, deadline_at: deadline }, hint = null, now = Date.now()) {
  if (hint === 'cancelled' || type === 'cancellation') return 'cancelled';
  if (type === 'award' || type === 'contract') return 'awarded';
  if (type === 'tender') {
    if (deadline) return Date.parse(deadline) > now ? 'open' : 'closed';
    if (hint === 'open' || hint === 'closed') return hint;
    return 'unknown';
  }
  if (type === 'planning') return deadline && Date.parse(deadline) > now ? 'open' : 'unknown';
  return hint && STATUSES.includes(hint) ? hint : 'unknown';
}

/** Fill every RECORD_FIELDS key (null / [] defaults) in the canonical order. */
export function finalize(rec, fetchedAt) {
  const out = {};
  for (const k of RECORD_FIELDS) {
    let v = rec[k];
    if (['cpv_codes', 'naics_codes', 'unspsc_codes', 'supplier_names'].includes(k)) v = uniq(v);
    else if (v === undefined) v = null;
    out[k] = v;
  }
  out.fetched_at = rec.fetched_at || fetchedAt;
  if (!NOTICE_TYPES.includes(out.notice_type)) out.notice_type = 'other';
  if (!STATUSES.includes(out.status)) out.status = 'unknown';
  return out;
}

/** A record must have an id, a title and a publication date to be indexed (and charged). */
export const isIndexable = (r) => Boolean(r && r.notice_id && r.title && r.published_at);
