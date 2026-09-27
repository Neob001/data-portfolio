// Remote Jobs API: input mapping onto the shared jobs core. Pure, no I/O.
//  - remote is always "remote_only" (not an input)
//  - timezonesOrRegions ("US", "Europe", "EMEA", "Worldwide/Anywhere", "CET", "UTC-5", ...) become
//    location terms (ISO country codes + location words) for the core `locations` filter
//  - postedWithinDays defaults to 7
import { normalizeInput } from './core/filters.js';
import { normKey } from './core/text.js';
import { countryCode } from './core/geo.js';

export const DEFAULT_POSTED_WITHIN_DAYS = 7;

// Location words that mean "open to candidates anywhere". Every region also matches these jobs:
// a "Remote - Worldwide" job can be done from Europe or the US.
export const WORLDWIDE_TERMS = ['anywhere', 'worldwide', 'world wide', 'global'];

const EU27 = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
const EUROPE = [...EU27, 'GB', 'CH', 'NO', 'IS', 'LI', 'UA', 'RS', 'BA', 'ME', 'MK', 'AL', 'MD', 'AD', 'MC', 'SM'];
const MIDDLE_EAST = ['AE', 'SA', 'QA', 'IL', 'TR', 'EG', 'JO', 'BH', 'KW', 'OM', 'LB', 'IQ'];
const AFRICA = ['ZA', 'NG', 'KE', 'EG', 'GH', 'MA', 'TN', 'RW', 'UG', 'ET', 'SN', 'CI', 'TZ', 'DZ', 'CM', 'ZW', 'ZM', 'MU', 'BW', 'NA'];
const LATAM = ['MX', 'BR', 'AR', 'CO', 'CL', 'PE', 'UY', 'CR', 'EC', 'GT', 'PA', 'DO', 'BO', 'PY', 'SV', 'HN', 'NI', 'VE', 'PR'];
const ASIA = ['JP', 'KR', 'CN', 'HK', 'TW', 'SG', 'MY', 'TH', 'VN', 'ID', 'PH', 'IN', 'PK', 'BD', 'LK'];
const US_TZ = ['est', 'edt', 'pst', 'pdt', 'cst', 'cdt', 'mst', 'mdt', 'eastern time', 'pacific time', 'central time', 'mountain time'];

/** Region -> { codes: ISO country codes, words: location words }. */
export const REGIONS = {
  worldwide: { codes: [], words: [] },
  us: { codes: ['US'], words: ['north america', 'americas', ...US_TZ] },
  canada: { codes: ['CA'], words: ['north america', 'americas'] },
  north_america: { codes: ['US', 'CA', 'MX'], words: ['north america', 'americas', ...US_TZ] },
  latam: { codes: LATAM, words: ['latam', 'latin america', 'south america', 'central america', 'americas'] },
  americas: { codes: ['US', 'CA', ...LATAM], words: ['americas', 'north america', 'latam', 'latin america', 'south america', ...US_TZ] },
  europe: { codes: EUROPE, words: ['europe', 'eu', 'emea', 'european union', 'eea', 'cet', 'cest', 'eet'] },
  uk: { codes: ['GB'], words: ['uk', 'united kingdom', 'great britain', 'europe', 'emea', 'gmt', 'bst'] },
  emea: { codes: [...EUROPE, ...MIDDLE_EAST, ...AFRICA], words: ['emea', 'europe', 'eu', 'middle east', 'africa', 'mena', 'cet', 'cest'] },
  middle_east: { codes: MIDDLE_EAST, words: ['middle east', 'mena', 'emea'] },
  africa: { codes: AFRICA, words: ['africa', 'mena', 'emea'] },
  apac: { codes: [...ASIA, 'AU', 'NZ'], words: ['apac', 'asia pacific', 'asia', 'anz', 'oceania'] },
  asia: { codes: ASIA, words: ['asia', 'apac', 'asia pacific'] },
  anz: { codes: ['AU', 'NZ'], words: ['anz', 'oceania', 'apac', 'aest', 'aedt'] },
};

// What a user may type (normalized with normKey) -> region key.
const ALIASES = {
  worldwide: 'worldwide', anywhere: 'worldwide', global: 'worldwide', 'worldwide anywhere': 'worldwide', 'anywhere worldwide': 'worldwide', remote: 'worldwide',
  us: 'us', usa: 'us', 'united states': 'us', 'united states of america': 'us', america: 'us',
  canada: 'canada',
  'north america': 'north_america', amer: 'north_america',
  latam: 'latam', 'latin america': 'latam', 'south america': 'latam', 'central america': 'latam',
  americas: 'americas',
  europe: 'europe', eu: 'europe', 'european union': 'europe', eea: 'europe',
  uk: 'uk', gb: 'uk', 'united kingdom': 'uk', 'great britain': 'uk', britain: 'uk',
  emea: 'emea',
  'middle east': 'middle_east', mena: 'middle_east',
  africa: 'africa',
  apac: 'apac', 'asia pacific': 'apac',
  asia: 'asia',
  anz: 'anz', oceania: 'anz', 'australia nz': 'anz', 'australia new zealand': 'anz', 'australia and new zealand': 'anz',
  // time zones
  // (ET / PT / NA are left out: they are also the ISO codes of Ethiopia, Portugal and Namibia)
  est: 'north_america', edt: 'north_america', 'eastern time': 'north_america',
  pst: 'north_america', pdt: 'north_america', 'pacific time': 'north_america',
  cst: 'north_america', cdt: 'north_america', 'central time': 'north_america',
  mst: 'north_america', mdt: 'north_america', 'mountain time': 'north_america',
  cet: 'europe', cest: 'europe', eet: 'europe', eest: 'europe', wet: 'europe', gmt: 'uk', bst: 'uk',
  aest: 'anz', aedt: 'anz', nzst: 'anz',
};
// Single-country time zones.
const TZ_COUNTRY = { ist: 'IN', jst: 'JP', kst: 'KR', sgt: 'SG', hkt: 'HK', brt: 'BR' };

/** UTC offset (hours) -> region key, for inputs like "UTC-5", "GMT+1", "UTC+05:30". */
export function regionForOffset(hours) {
  if (hours <= -3 && hours >= -10) return 'americas';
  if (hours > -3 && hours <= 3) return 'emea';
  if (hours > 3 && hours < 7) return 'asia';
  if (hours >= 7 && hours <= 13) return 'apac';
  return null;
}

/**
 * timezonesOrRegions values -> { codes: ISO codes (matched against country_codes only), words:
 * location words, resolved: [value, region] }. Unknown values are used as location words as-is.
 */
export function regionTerms(values) {
  const codes = new Set();
  const terms = new Set();
  const resolved = [];
  for (const raw of values || []) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    const k = normKey(v);
    let region = ALIASES[k] || null;
    const off = !region && v.replace(/[−–]/g, '-').match(/^(?:utc|gmt)\s*([+-])\s*(\d{1,2})(?::?(\d{2}))?$/i);
    if (off) region = regionForOffset((off[1] === '-' ? -1 : 1) * (Number(off[2]) + Number(off[3] || 0) / 60));
    if (region) {
      for (const c of REGIONS[region].codes) codes.add(c);
      for (const w of REGIONS[region].words) terms.add(w);
      resolved.push([v, region]);
    } else {
      const code = TZ_COUNTRY[k] || countryCode(v);
      if (code) { codes.add(code); resolved.push([v, code]); } else { terms.add(v); resolved.push([v, 'text']); }
    }
    for (const w of WORLDWIDE_TERMS) terms.add(w);
  }
  return { codes: [...codes], words: [...terms], resolved };
}

const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : []);

/** Actor input -> core options. Throws a readable Error on bad input. */
export function toFeedOptions(input = {}) {
  const { remote, timezonesOrRegions, ...rest } = input;
  const { codes, words } = regionTerms(list(timezonesOrRegions));
  const posted = rest.postedWithinDays === undefined || rest.postedWithinDays === null || rest.postedWithinDays === ''
    ? DEFAULT_POSTED_WITHIN_DAYS : rest.postedWithinDays;
  return normalizeInput({
    ...rest,
    remote: 'remote_only',
    postedWithinDays: posted,
    locations: [...list(rest.locations), ...words],
    countryCodes: codes,
  });
}
