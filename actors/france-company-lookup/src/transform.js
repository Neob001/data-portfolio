// Pure transforms for the API Recherche d'entreprises (recherche-entreprises.api.gouv.fr).
// Company-level facts only. Deliberately NEVER outputs `dirigeants` (officers) or any
// person name, and excludes sole proprietors (entrepreneurs individuels), whose
// "company name" and head office are a natural person's name and home (see DECISIONS.md).
import { readFileSync } from 'node:fs';

export const API_BASE = 'https://recherche-entreprises.api.gouv.fr';
export const ANNUAIRE_BASE = 'https://annuaire-entreprises.data.gouv.fr/entreprise';
/** API hard limits (verified 2026-09-15): per_page 1..25, page * per_page <= 10,000. */
export const MAX_PER_PAGE = 25;
export const RESULT_WINDOW = 10000;
/** Secondary blocks requested. `dirigeants` is intentionally NOT requested (data minimisation). */
export const INCLUDE_BLOCKS = 'siege,complements,finances,matching_etablissements';

const LABELS = JSON.parse(readFileSync(new URL('./labels/insee_labels.json', import.meta.url), 'utf8'));
/** INSEE catégories juridiques (niveau III), official French labels. */
export const LEGAL_FORMS = LABELS.legal_forms;
/** INSEE NAF rév. 2 sub-classes, official French labels. */
export const NAF_LABELS = LABELS.naf_codes;
export const DEPARTMENTS = LABELS.departments;
export const REGIONS = LABELS.regions;

export const EMPLOYEE_RANGES = {
  NN: 'Non-employer unit',
  '00': '0 employees',
  '01': '1-2 employees',
  '02': '3-5 employees',
  '03': '6-9 employees',
  11: '10-19 employees',
  12: '20-49 employees',
  21: '50-99 employees',
  22: '100-199 employees',
  31: '200-249 employees',
  32: '250-499 employees',
  41: '500-999 employees',
  42: '1,000-1,999 employees',
  51: '2,000-4,999 employees',
  52: '5,000-9,999 employees',
  53: '10,000+ employees',
};
const EMPLOYEE_RANGE_ORDER = ['00', '01', '02', '03', '11', '12', '21', '22', '31', '32', '41', '42', '51', '52', '53'];

export const ACTIVITY_SECTIONS = {
  A: 'Agriculture, forestry and fishing',
  B: 'Mining and quarrying',
  C: 'Manufacturing',
  D: 'Electricity, gas, steam and air conditioning supply',
  E: 'Water supply; sewerage, waste management and remediation',
  F: 'Construction',
  G: 'Wholesale and retail trade; repair of motor vehicles',
  H: 'Transportation and storage',
  I: 'Accommodation and food service activities',
  J: 'Information and communication',
  K: 'Financial and insurance activities',
  L: 'Real estate activities',
  M: 'Professional, scientific and technical activities',
  N: 'Administrative and support service activities',
  O: 'Public administration and defence',
  P: 'Education',
  Q: 'Human health and social work activities',
  R: 'Arts, entertainment and recreation',
  S: 'Other service activities',
  T: 'Activities of households as employers',
  U: 'Activities of extraterritorial organisations',
};

export const COMPANY_CATEGORIES = {
  PME: 'SME (PME)',
  ETI: 'Mid-cap (ETI)',
  GE: 'Large enterprise (GE)',
};

/** Legal forms that are groupings of natural persons without legal personality (names are people). */
const NATURAL_PERSON_GROUPINGS = new Set(['2110', '2210', '2310']);
const LA_POSTE_SIREN = '356000000';

// ---------------------------------------------------------------------------
// Identifiers

const digitsOnly = (s) => String(s ?? '').replace(/[\s.\-]/g, '');

/** Luhn checksum over a digit string. */
export function luhnValid(digits) {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

export function isValidSiren(siren) {
  return /^\d{9}$/.test(siren) && luhnValid(siren);
}

/**
 * SIRET = SIREN + 5-digit NIC, Luhn over 14 digits. Exception: La Poste
 * (SIREN 356000000) has thousands of establishments, so its SIRETs use
 * "sum of digits divisible by 5" instead of Luhn. Verified live 2026-09-15: La Poste
 * establishments (e.g. 35600000065514) pass only the sum-of-5 rule, while its head
 * office 35600000000048 passes only Luhn — so either rule is accepted for La Poste.
 */
export function isValidSiret(siret) {
  if (!/^\d{14}$/.test(siret)) return false;
  if (siret.startsWith(LA_POSTE_SIREN)) {
    const sum = [...siret].reduce((a, c) => a + Number(c), 0);
    return sum % 5 === 0 || luhnValid(siret);
  }
  return luhnValid(siret);
}

/**
 * Classify a user query.
 * -> { type: 'siren'|'siret', value } | { type: 'name', value } | { type: 'invalid', value, reason }
 * All-digit input (spaces/dots/dashes allowed) of 9 or 14 digits is an identifier;
 * all-digit input of 8-15 digits with another length is treated as a mistyped identifier.
 */
export function parseQuery(raw) {
  const value = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!value) return { type: 'invalid', value, reason: 'empty_query' };
  const compact = digitsOnly(value);
  if (/^\d+$/.test(compact)) {
    if (compact.length === 9) {
      return isValidSiren(compact)
        ? { type: 'siren', value: compact }
        : { type: 'invalid', value: compact, reason: 'invalid_siren_checksum' };
    }
    if (compact.length === 14) {
      return isValidSiret(compact)
        ? { type: 'siret', value: compact }
        : { type: 'invalid', value: compact, reason: 'invalid_siret_checksum' };
    }
    if (compact.length >= 8 && compact.length <= 15) {
      return { type: 'invalid', value: compact, reason: 'invalid_identifier_length' };
    }
  }
  if (value.length < 3) return { type: 'invalid', value, reason: 'query_too_short' };
  return { type: 'name', value };
}

/** French intra-community VAT number computed from a SIREN: FR + key + SIREN. */
export function computeVatNumber(siren) {
  const s = String(siren ?? '');
  if (!/^\d{9}$/.test(s)) return null;
  const key = (12 + 3 * (Number(s) % 97)) % 97;
  return `FR${String(key).padStart(2, '0')}${s}`;
}

// ---------------------------------------------------------------------------
// Request building

/** Employee range codes at or above `minCode` (NN / unknown excluded). */
export function employeeRangesAtLeast(minCode) {
  if (!minCode) return null;
  const i = EMPLOYEE_RANGE_ORDER.indexOf(String(minCode));
  if (i < 0) return null;
  return EMPLOYEE_RANGE_ORDER.slice(i);
}

/**
 * Build a /search URL. For identifier lookups pass no filters (a SIREN/SIRET
 * lookup must return the company regardless of status or location).
 */
export function buildSearchUrl({ q, page = 1, perPage = 10, filters = {} } = {}) {
  const p = new URLSearchParams();
  p.set('q', String(q ?? ''));
  p.set('page', String(page));
  p.set('per_page', String(Math.min(MAX_PER_PAGE, Math.max(1, perPage))));
  p.set('minimal', 'true');
  p.set('include', INCLUDE_BLOCKS);
  const { postalCode, department, nafCode, onlyActive, minEmployeeRange } = filters;
  if (postalCode) p.set('code_postal', String(postalCode).replace(/\s+/g, ''));
  if (department) p.set('departement', String(department).trim().toUpperCase());
  if (nafCode) p.set('activite_principale', normalizeNafCode(nafCode));
  if (onlyActive) p.set('etat_administratif', 'A');
  const ranges = employeeRangesAtLeast(minEmployeeRange);
  if (ranges) p.set('tranche_effectif_salarie', ranges.join(','));
  return `${API_BASE}/search?${p.toString()}`;
}

/** "6201Z" / "62.01z" / "62.01Z" -> "62.01Z" (comma lists supported). */
export function normalizeNafCode(code) {
  return String(code)
    .split(',')
    .map((c) => c.trim().toUpperCase().replace(/\s+/g, ''))
    .filter(Boolean)
    .map((c) => (/^\d{4}[A-Z]$/.test(c) ? `${c.slice(0, 2)}.${c.slice(2)}` : c))
    .join(',');
}

export function annuaireUrl(siren) {
  return `${ANNUAIRE_BASE}/${siren}`;
}

// ---------------------------------------------------------------------------
// Privacy guards

/** Sole proprietor (entrepreneur individuel): the unit's name is a natural person's name. */
export function isIndividual(unit) {
  if (!unit) return false;
  return String(unit.nature_juridique ?? '').startsWith('1') || unit.complements?.est_entrepreneur_individuel === true;
}

const isRestricted = (v) => v === 'P' || v === 'N';

/** Reason a unit must never be output (and never charged), or null if it is fine. */
export function exclusionReason(unit) {
  if (!unit || typeof unit !== 'object') return 'malformed';
  if (isIndividual(unit)) return 'individual_entrepreneur_excluded';
  if (NATURAL_PERSON_GROUPINGS.has(String(unit.nature_juridique ?? ''))) return 'natural_person_grouping_excluded';
  if (isRestricted(unit.statut_diffusion)) return 'non_diffusible_excluded';
  const name = String(unit.nom_complet ?? unit.nom_raison_sociale ?? '');
  if (!name || /NON[- ]DIFFUSIBLE/i.test(name)) return 'non_diffusible_excluded';
  return null;
}

// ---------------------------------------------------------------------------
// Record mapping

/** "2026-09-14T08:39:36" -> "2026-09-14" without timezone shifts. */
export function dateOnly(v) {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v ?? ''));
  return m ? m[1] : null;
}

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool = (v) => (typeof v === 'boolean' ? v : null);
const str = (v) => (v === null || v === undefined || v === '' ? null : String(v));

function latestFinances(finances) {
  if (!finances || typeof finances !== 'object') return { year: null, ca: null, rn: null };
  const years = Object.keys(finances).filter((y) => /^\d{4}$/.test(y)).sort();
  const y = years[years.length - 1];
  if (!y) return { year: null, ca: null, rn: null };
  return { year: Number(y), ca: num(finances[y]?.ca), rn: num(finances[y]?.resultat_net) };
}

function street(et) {
  if (!et) return null;
  const s = [et.numero_voie, et.indice_repetition, et.type_voie, et.libelle_voie].filter(Boolean).join(' ').trim();
  return s || null;
}

/** Establishment (siege or matching) address block; masked when the establishment is non-diffusible. */
function addressOf(et) {
  const masked = !et || isRestricted(et.statut_diffusion_etablissement);
  const foreign = et?.code_pays_etranger || et?.libelle_pays_etranger;
  return {
    address: masked ? null : str(et.adresse),
    street: masked ? null : street(et),
    postal_code: masked ? null : str(et.code_postal),
    city: masked ? null : str(et.libelle_commune ?? et.libelle_commune_etranger),
    department_code: masked ? null : str(et.departement),
    region_code: masked ? null : str(et.region),
    country: masked ? null : foreign ? str(et.libelle_pays_etranger) : 'France',
    latitude: masked ? null : num(et.latitude),
    longitude: masked ? null : num(et.longitude),
  };
}

const isActive = (etat) => (etat === 'A' ? true : etat === 'C' || etat === 'F' ? false : null);

/**
 * Unit légale (search result) -> flat company record, or null when the unit is
 * malformed or excluded for privacy. `siret` selects the establishment block
 * for SIRET lookups (null establishment fields otherwise).
 * NEVER copies `dirigeants` or any person-name field.
 */
export function companyToRecord(unit, { siret = null } = {}) {
  if (!unit || !/^\d{9}$/.test(String(unit.siren ?? ''))) return null;
  if (exclusionReason(unit)) return null;
  const siege = unit.siege || null;
  const hq = addressOf(siege);
  const c = unit.complements || {};
  const fin = latestFinances(unit.finances);
  const naf = str(unit.activite_principale);
  const section = str(unit.section_activite_principale);
  const legal = str(unit.nature_juridique);
  const emp = str(unit.tranche_effectif_salarie);
  const cat = str(unit.categorie_entreprise);

  let est = null;
  if (siret) {
    const all = [...(unit.matching_etablissements || []), ...(siege ? [siege] : [])];
    est = all.find((e) => e && e.siret === siret) || null;
  }
  const estAddr = est ? addressOf(est) : null;

  return {
    siren: String(unit.siren),
    siret_head_office: str(siege?.siret),
    company_name: str(unit.nom_raison_sociale) ?? str(unit.nom_complet),
    company_full_name: str(unit.nom_complet),
    acronym: str(unit.sigle),
    legal_form_code: legal,
    legal_form: legal ? LEGAL_FORMS[legal] ?? null : null,
    naf_code: naf,
    naf_label: naf ? NAF_LABELS[naf] ?? null : null,
    naf_2025_code: str(unit.activite_principale_naf25),
    activity_section: section,
    activity_section_label: section ? ACTIVITY_SECTIONS[section] ?? null : null,
    employee_range_code: emp,
    employee_range: emp ? EMPLOYEE_RANGES[emp] ?? null : null,
    employee_range_year: num(unit.annee_tranche_effectif_salarie),
    company_category: cat,
    company_category_label: cat ? COMPANY_CATEGORIES[cat] ?? null : null,
    creation_date: dateOnly(unit.date_creation),
    closure_date: dateOnly(unit.date_fermeture),
    is_active: isActive(unit.etat_administratif),
    head_office_address: hq.address,
    head_office_street: hq.street,
    head_office_postal_code: hq.postal_code,
    head_office_city: hq.city,
    head_office_department_code: hq.department_code,
    head_office_department: hq.department_code ? DEPARTMENTS[hq.department_code] ?? null : null,
    head_office_region_code: hq.region_code,
    head_office_region: hq.region_code ? REGIONS[hq.region_code] ?? null : null,
    head_office_country: hq.country,
    head_office_latitude: hq.latitude,
    head_office_longitude: hq.longitude,
    establishments_count: num(unit.nombre_etablissements),
    open_establishments_count: num(unit.nombre_etablissements_ouverts),
    revenue_eur: fin.ca,
    net_income_eur: fin.rn,
    financials_year: fin.year,
    is_ess: bool(c.est_ess),
    is_association: bool(c.est_association),
    is_public_administration: bool(c.est_administration),
    is_mission_company: bool(c.est_societe_mission),
    is_entertainment_licensee: bool(c.est_entrepreneur_spectacle),
    is_training_organization: bool(c.est_organisme_formation),
    is_qualiopi_certified: bool(c.est_qualiopi),
    is_rge_certified: bool(c.est_rge),
    is_organic_certified: bool(c.est_bio),
    is_siae: bool(c.est_siae),
    is_finess: bool(c.est_finess),
    is_living_heritage_company: bool(c.est_patrimoine_vivant),
    has_responsible_purchasing_label: bool(c.est_achats_responsables),
    has_egapro_index: bool(c.egapro_renseignee),
    has_ghg_report: bool(c.bilan_ges_renseigne),
    vat_number_computed: computeVatNumber(unit.siren),
    matched_siret: est ? str(est.siret) : null,
    establishment_is_head_office: est ? bool(est.est_siege) : null,
    establishment_is_active: est ? isActive(est.etat_administratif) : null,
    establishment_address: estAddr ? estAddr.address : null,
    establishment_postal_code: estAddr ? estAddr.postal_code : null,
    establishment_city: estAddr ? estAddr.city : null,
    establishment_naf_code: est ? str(est.activite_principale) : null,
    establishment_employee_range_code: est ? str(est.tranche_effectif_salarie) : null,
    establishment_creation_date: est ? dateOnly(est.date_creation) : null,
    establishment_closure_date: est ? dateOnly(est.date_fermeture) : null,
    last_update: dateOnly(unit.date_mise_a_jour),
    annuaire_url: annuaireUrl(unit.siren),
  };
}

// ---------------------------------------------------------------------------
// Search relevance

const STOPWORDS = new Set([
  'LA', 'LE', 'LES', 'DE', 'DU', 'DES', 'ET', 'D', 'L', 'AU', 'AUX', 'EN', 'THE', 'AND', 'OF',
  'SA', 'SAS', 'SASU', 'SARL', 'EURL', 'SE', 'SCI', 'SNC', 'SCA', 'SCS', 'SCOP', 'GIE', 'SCM', 'SCP', 'SELARL', 'SELAS',
  'STE', 'SOCIETE', 'GROUPE', 'GROUP', 'FRANCE', 'CIE', 'COMPAGNIE',
]);

export const normText = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();

export const significantTokens = (s) => normText(s).split(' ').filter((t) => t.length >= 2 && !STOPWORDS.has(t));

function editDistanceAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokenHit(q, words) {
  return words.some(
    (w) => w === q || (q.length >= 3 && w.startsWith(q)) || (w.length >= 4 && q.startsWith(w)) || (q.length >= 5 && editDistanceAtMostOne(q, w)),
  );
}

function companyText(unit) {
  const ets = [unit.siege, ...(unit.matching_etablissements || [])].filter(Boolean);
  const parts = [unit.nom_complet, unit.nom_raison_sociale, unit.sigle];
  for (const e of ets) parts.push(e.adresse, e.libelle_commune, e.nom_commercial, ...(e.liste_enseignes || []));
  return normText(parts.filter(Boolean).join(' ')).split(' ');
}

/**
 * The API's full-text search also matches officers' and elected officials' names.
 * To avoid turning a person's name into a list of their companies, a search
 * result is kept only if at least one significant query token matches the
 * company's own name, acronym, trade names or address.
 */
export function matchesCompanyText(unit, query) {
  const qt = significantTokens(query);
  if (qt.length === 0) return true;
  const words = companyText(unit);
  return qt.some((t) => tokenHit(t, words));
}

/**
 * Single-best-match mode (maxResultsPerQuery == 1): exact normalized name or
 * acronym wins; otherwise every significant query token must be a word of the
 * company name/acronym. Returns the unit or null (never charge for a guess).
 */
export function bestNameMatch(units, query) {
  if (!Array.isArray(units) || units.length === 0) return null;
  const target = normText(query);
  const names = (u) => [u.nom_raison_sociale, u.nom_complet, u.sigle].filter(Boolean);
  const exact = units.find((u) => names(u).some((n) => normText(n) === target));
  if (exact) return exact;
  const qt = significantTokens(query);
  if (qt.length === 0) return null;
  return (
    units.find((u) => {
      const words = new Set(names(u).flatMap((n) => normText(n).split(' ')));
      return qt.every((t) => words.has(t));
    }) || null
  );
}

/** Validate the search payload shape. */
export function resultsOf(payload) {
  if (!payload || !Array.isArray(payload.results)) {
    const e = new Error('Unexpected API response: results missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  return payload.results;
}
