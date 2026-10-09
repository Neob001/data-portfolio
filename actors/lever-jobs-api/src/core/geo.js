// Best-effort ISO-3166 alpha-2 country codes from free-text job locations. Pure, no network.
import { normKey } from './text.js';

// Region codes Intl knows that are not ISO 3166-1 countries (or are reserved/transitional).
const NON_ISO = new Set(['AA', 'AC', 'AN', 'BU', 'CP', 'CQ', 'CS', 'DD', 'DG', 'EA', 'EU', 'EZ', 'FX', 'IC', 'NT', 'QO',
  'SU', 'TA', 'TP', 'UK', 'UN', 'XA', 'XB', 'YU', 'ZR', 'ZZ']);
const NAME_TO_CODE = new Map();
const VALID = new Set();
{
  const names = new Intl.DisplayNames(['en'], { type: 'region' });
  for (let a = 65; a <= 90; a += 1) {
    for (let b = 65; b <= 90; b += 1) {
      const code = String.fromCharCode(a, b);
      if (NON_ISO.has(code)) continue;
      let name;
      try { name = names.of(code); } catch { continue; }
      if (!name || name === code || /unknown/i.test(name)) continue;
      VALID.add(code);
      if (!NAME_TO_CODE.has(normKey(name))) NAME_TO_CODE.set(normKey(name), code);
    }
  }
}

const ALIASES = {
  US: ['usa', 'us', 'u s', 'u s a', 'united states of america', 'america', 'united states'],
  GB: ['uk', 'u k', 'england', 'scotland', 'wales', 'northern ireland', 'great britain', 'britain'],
  AE: ['uae', 'u a e', 'dubai', 'abu dhabi'],
  KR: ['korea', 'republic of korea', 'south korea'],
  CZ: ['czech republic', 'czechia'],
  TR: ['turkey', 'turkiye'],
  NL: ['holland', 'the netherlands'],
  RU: ['russian federation'],
  VN: ['viet nam'],
  CI: ['ivory coast', 'cote d ivoire'],
  HK: ['hong kong sar', 'hong kong'],
  MO: ['macau'],
  TW: ['taiwan roc'],
  PH: ['the philippines'],
  CD: ['drc', 'democratic republic of the congo'],
  MK: ['macedonia'],
  SZ: ['swaziland'],
  MM: ['burma'],
};
for (const [code, list] of Object.entries(ALIASES)) for (const n of list) NAME_TO_CODE.set(n, code);

const US_STATES = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut',
  DE: 'delaware', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
  KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan',
  MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire',
  NJ: 'new jersey', NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio',
  OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota',
  TN: 'tennessee', TX: 'texas', UT: 'utah', VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia',
  WI: 'wisconsin', WY: 'wyoming', DC: 'district of columbia',
};
const CA_PROVINCES = {
  AB: 'alberta', BC: 'british columbia', MB: 'manitoba', NB: 'new brunswick', NL: 'newfoundland and labrador',
  NS: 'nova scotia', ON: 'ontario', PE: 'prince edward island', QC: 'quebec', SK: 'saskatchewan',
};
const STATE_NAMES = new Map();
for (const n of Object.values(US_STATES)) if (n !== 'georgia' && n !== 'washington') STATE_NAMES.set(n, 'US');
for (const n of Object.values(CA_PROVINCES)) STATE_NAMES.set(n, 'CA');

// Unambiguous large job-market cities (a city that shares its name with a bigger one elsewhere is left out).
const CITIES = {
  US: ['new york city', 'nyc', 'san francisco', 'sf bay area', 'bay area', 'los angeles', 'seattle', 'boston', 'chicago',
    'austin', 'denver', 'atlanta', 'miami', 'san jose', 'palo alto', 'mountain view', 'menlo park', 'sunnyvale',
    'san diego', 'washington dc', 'washington d c', 'philadelphia', 'pittsburgh', 'salt lake city', 'dallas',
    'houston', 'phoenix', 'minneapolis', 'detroit', 'nashville', 'raleigh', 'brooklyn', 'redwood city', 'san mateo',
    'oakland', 'irvine', 'santa monica', 'cambridge ma', 'new york'],
  GB: ['london', 'manchester', 'edinburgh', 'glasgow', 'bristol', 'leeds', 'belfast', 'cardiff', 'birmingham uk'],
  CA: ['toronto', 'vancouver', 'montreal', 'ottawa', 'calgary', 'waterloo on'],
  DE: ['berlin', 'munich', 'munchen', 'hamburg', 'frankfurt', 'cologne', 'koln', 'stuttgart', 'dusseldorf'],
  FR: ['paris', 'lyon', 'marseille', 'toulouse', 'nantes', 'bordeaux', 'lille'],
  NL: ['amsterdam', 'rotterdam', 'utrecht', 'eindhoven', 'the hague'],
  IE: ['dublin', 'cork', 'galway'],
  ES: ['madrid', 'barcelona', 'valencia', 'seville'],
  PT: ['lisbon', 'lisboa', 'porto'],
  IT: ['milan', 'milano', 'rome', 'roma', 'turin', 'torino'],
  SE: ['stockholm', 'gothenburg', 'goteborg', 'malmo'],
  DK: ['copenhagen', 'kobenhavn', 'aarhus'],
  NO: ['oslo', 'bergen'],
  FI: ['helsinki', 'espoo', 'tampere'],
  CH: ['zurich', 'geneva', 'geneve', 'lausanne', 'basel'],
  AT: ['vienna', 'wien'],
  BE: ['brussels', 'antwerp', 'ghent'],
  PL: ['warsaw', 'warszawa', 'krakow', 'wroclaw', 'gdansk'],
  CZ: ['prague', 'praha', 'brno'],
  GR: ['athens', 'thessaloniki'],
  RO: ['bucharest', 'cluj napoca'],
  HU: ['budapest'],
  UA: ['kyiv', 'kiev', 'lviv'],
  EE: ['tallinn'],
  LT: ['vilnius'],
  LV: ['riga'],
  IL: ['tel aviv', 'tel aviv yafo', 'jerusalem', 'haifa'],
  IN: ['bangalore', 'bengaluru', 'mumbai', 'new delhi', 'delhi', 'hyderabad', 'pune', 'chennai', 'gurgaon', 'gurugram', 'noida'],
  SG: ['singapore'],
  JP: ['tokyo', 'osaka'],
  AU: ['sydney', 'melbourne', 'brisbane', 'perth wa', 'canberra'],
  NZ: ['auckland', 'wellington'],
  BR: ['sao paulo', 'rio de janeiro', 'belo horizonte', 'florianopolis'],
  MX: ['mexico city', 'ciudad de mexico', 'guadalajara', 'monterrey'],
  AR: ['buenos aires'],
  CO: ['bogota', 'medellin'],
  CL: ['santiago de chile'],
  ZA: ['cape town', 'johannesburg'],
  NG: ['lagos'],
  KE: ['nairobi'],
  EG: ['cairo'],
  TR: ['istanbul'],
  PH: ['manila', 'makati'],
  CN: ['shanghai', 'beijing', 'shenzhen'],
  KR: ['seoul'],
  AE: ['abu dhabi'],
};
const CITY_TO_CODE = new Map();
for (const [code, list] of Object.entries(CITIES)) for (const c of list) CITY_TO_CODE.set(c, code);

/** Country name / alias / ISO code -> ISO code, or null. */
export function countryCode(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (/^[A-Z]{2}$/.test(raw) && VALID.has(raw)) return raw === 'UK' ? 'GB' : raw;
  if (/^[A-Za-z]{2}$/.test(raw) && raw.toUpperCase() === 'UK') return 'GB';
  if (/^[A-Z]{3}$/.test(raw) && raw === 'USA') return 'US';
  return NAME_TO_CODE.get(normKey(raw)) || null;
}

/** Country codes mentioned in one free-text location such as "San Francisco, CA" or "Remote (EU, UK)". */
export function codesFromLocation(location) {
  const found = new Set();
  if (!location) return found;
  const text = String(location);
  const parts = text.split(/[,;/|()·•]|\s[-–—]\s/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    if (/^[A-Z]{2}$/.test(part)) {
      if (parts.length > 1 && US_STATES[part]) { found.add('US'); continue; }
      if (parts.length > 1 && CA_PROVINCES[part] && !VALID.has(part)) { found.add('CA'); continue; }
      if (part === 'UK') { found.add('GB'); continue; }
      if (VALID.has(part)) { found.add(part); continue; }
      continue;
    }
    const k = normKey(part);
    const code = NAME_TO_CODE.get(k) || STATE_NAMES.get(k) || CITY_TO_CODE.get(k);
    if (code) { found.add(code); continue; }
    // "Remote US", "US Remote", "New York City Office": look at word n-grams inside the part.
    const words = k.split(' ');
    const used = new Array(words.length).fill(false);
    for (let n = Math.min(4, words.length); n >= 1; n -= 1) {
      for (let i = 0; i + n <= words.length; i += 1) {
        if (used.slice(i, i + n).some(Boolean)) continue;
        const g = words.slice(i, i + n).join(' ');
        const c = g.length <= 3
          ? ALIAS_SHORT.get(g)
          : NAME_TO_CODE.get(g) || STATE_NAMES.get(g) || CITY_TO_CODE.get(g);
        if (c) {
          found.add(c);
          for (let j = i; j < i + n; j += 1) used[j] = true;
        }
      }
    }
  }
  // "Atlanta, Georgia": the US state, not the country.
  if (found.has('US') && found.has('GE') && /georgia/i.test(text) && !/tbilisi/i.test(text)) found.delete('GE');
  return found;
}
const ALIAS_SHORT = new Map([['us', 'US'], ['usa', 'US'], ['uk', 'GB'], ['uae', 'AE']]);

/** Merge explicit ATS country hints with codes inferred from location strings; sorted, unique. */
export function countryCodes(locations, hints = []) {
  const out = new Set();
  for (const h of hints) {
    const c = countryCode(h);
    if (c) out.add(c);
  }
  for (const loc of locations || []) for (const c of codesFromLocation(loc)) out.add(c);
  return [...out].sort();
}

export function isCountryCode(s) {
  return typeof s === 'string' && /^[A-Za-z]{2}$/.test(s) && (VALID.has(s.toUpperCase()) || s.toUpperCase() === 'UK');
}
