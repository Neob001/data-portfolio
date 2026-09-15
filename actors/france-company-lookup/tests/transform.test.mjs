import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseQuery,
  luhnValid,
  isValidSiren,
  isValidSiret,
  computeVatNumber,
  buildSearchUrl,
  companyToRecord,
  isIndividual,
  exclusionReason,
  matchesCompanyText,
  bestNameMatch,
  employeeRangesAtLeast,
  normalizeNafCode,
  resultsOf,
  dateOnly,
  LEGAL_FORMS,
  NAF_LABELS,
} from '../src/transform.js';

const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8'));

// Any key that could carry a natural person's data must never appear in output.
const PERSON_KEY = /dirigeant|officer|director|nom\b|prenom|personne|birth|naissance|nationalit/i;

test('parseQuery: SIREN, SIRET (spaces allowed), names and invalid input', () => {
  assert.deepEqual(parseQuery('552 081 317'), { type: 'siren', value: '552081317' });
  assert.deepEqual(parseQuery(' 383 474 814 00100 '), { type: 'siret', value: '38347481400100' });
  assert.deepEqual(parseQuery('Airbus'), { type: 'name', value: 'Airbus' });
  assert.deepEqual(parseQuery('  Société   Générale '), { type: 'name', value: 'Société Générale' });
  assert.equal(parseQuery('552081318').reason, 'invalid_siren_checksum');
  assert.equal(parseQuery('38347481400101').reason, 'invalid_siret_checksum');
  assert.equal(parseQuery('1234567890').reason, 'invalid_identifier_length');
  assert.equal(parseQuery('ab').reason, 'query_too_short');
  assert.equal(parseQuery('').reason, 'empty_query');
  assert.equal(parseQuery(null).reason, 'empty_query');
  assert.equal(parseQuery('3615').type, 'name'); // short digit strings can be names
});

test('Luhn checks for SIREN and SIRET', () => {
  assert.ok(luhnValid('552081317'));
  assert.ok(isValidSiren('552081317')); // EDF
  assert.ok(isValidSiren('383474814')); // Airbus
  assert.ok(!isValidSiren('552081318'));
  assert.ok(!isValidSiren('55208131'));
  assert.ok(isValidSiret('38347481400100')); // Airbus head office
  assert.ok(isValidSiret('55208131766522')); // EDF head office
  assert.ok(!isValidSiret('38347481400101'));
  assert.ok(!luhnValid('12a4'));
});

test('La Poste SIRET exception (SIREN 356000000): sum of digits multiple of 5', () => {
  assert.ok(isValidSiren('356000000'));
  // Real La Poste establishment: fails Luhn, passes the sum-of-5 rule.
  assert.ok(!luhnValid('35600000065514'));
  assert.ok(isValidSiret('35600000065514'));
  assert.equal(parseQuery('356 000 000 65514').type, 'siret');
  // La Poste head office passes Luhn.
  assert.ok(isValidSiret('35600000000048'));
  // Neither rule -> invalid.
  assert.ok(!isValidSiret('35600000065515'));
  // The exception does not leak to other companies.
  assert.ok(!isValidSiret('38347481400105'));
});

test('computed VAT number matches VAT numbers published in the API (tva field)', () => {
  const edf = load('lookup_siren_552081317.json').results[0];
  assert.equal(computeVatNumber('552081317'), 'FR03552081317');
  assert.ok(edf.tva.includes(computeVatNumber(edf.siren)));
  assert.equal(computeVatNumber('383474814'), 'FR89383474814'); // Airbus, API tva: FR89383474814
  assert.equal(computeVatNumber('12345678'), null);
  assert.equal(computeVatNumber(null), null);
});

test('buildSearchUrl: minimal payload without dirigeants, caps and filters', () => {
  const u = new URL(buildSearchUrl({ q: 'airbus', page: 2, perPage: 80, filters: {
    postalCode: '31 700', department: '31', nafCode: '3030z', onlyActive: true, minEmployeeRange: '41',
  } }));
  assert.equal(u.origin, 'https://recherche-entreprises.api.gouv.fr');
  assert.equal(u.pathname, '/search');
  assert.equal(u.searchParams.get('q'), 'airbus');
  assert.equal(u.searchParams.get('page'), '2');
  assert.equal(u.searchParams.get('per_page'), '25');
  assert.equal(u.searchParams.get('minimal'), 'true');
  assert.ok(!u.searchParams.get('include').includes('dirigeants'));
  assert.equal(u.searchParams.get('code_postal'), '31700');
  assert.equal(u.searchParams.get('departement'), '31');
  assert.equal(u.searchParams.get('activite_principale'), '30.30Z');
  assert.equal(u.searchParams.get('etat_administratif'), 'A');
  assert.equal(u.searchParams.get('tranche_effectif_salarie'), '41,42,51,52,53');
  const plain = new URL(buildSearchUrl({ q: '552081317', perPage: 5 }));
  for (const k of ['code_postal', 'departement', 'activite_principale', 'etat_administratif', 'tranche_effectif_salarie']) {
    assert.equal(plain.searchParams.get(k), null);
  }
  assert.equal(employeeRangesAtLeast('bogus'), null);
  assert.equal(normalizeNafCode('6201z, 62.02A'), '62.01Z,62.02A');
});

test('SIREN lookup golden -> flat company record (EDF)', () => {
  const r = companyToRecord(load('lookup_siren_552081317.json').results[0]);
  assert.equal(r.siren, '552081317');
  assert.equal(r.siret_head_office, '55208131766522');
  assert.equal(r.company_name, 'ELECTRICITE DE FRANCE');
  assert.equal(r.acronym, 'EDF');
  assert.equal(r.legal_form_code, '5599');
  assert.equal(r.legal_form, "SA à conseil d'administration (s.a.i.)");
  assert.equal(r.naf_code, '35.11Z');
  assert.equal(r.naf_label, NAF_LABELS['35.11Z']);
  assert.equal(r.activity_section, 'D');
  assert.equal(r.employee_range_code, '53');
  assert.equal(r.employee_range, '10,000+ employees');
  assert.equal(r.company_category, 'GE');
  assert.equal(r.creation_date, '1955-01-01');
  assert.equal(r.closure_date, null);
  assert.equal(r.is_active, true);
  assert.equal(r.head_office_postal_code, '75008');
  assert.equal(r.head_office_city, 'PARIS');
  assert.equal(r.head_office_department, 'Paris');
  assert.equal(r.head_office_region, 'Île-de-France');
  assert.equal(r.head_office_country, 'France');
  assert.equal(typeof r.head_office_latitude, 'number');
  assert.equal(r.establishments_count, 9157);
  assert.equal(r.revenue_eur, 118690000000);
  assert.equal(r.financials_year, 2024);
  assert.equal(r.is_ess, false);
  assert.equal(r.vat_number_computed, 'FR03552081317');
  assert.equal(r.matched_siret, null);
  assert.equal(r.last_update, '2026-09-14');
  assert.equal(r.annuaire_url, 'https://annuaire-entreprises.data.gouv.fr/entreprise/552081317');
});

test('dirigeants and person fields never reach output, even when present in the payload', () => {
  const unit = load('lookup_siren_552081317.json').results[0];
  assert.ok(Array.isArray(unit.dirigeants) && unit.dirigeants.length > 0, 'fixture must contain dirigeants');
  const r = companyToRecord(unit);
  for (const k of Object.keys(r)) assert.ok(!PERSON_KEY.test(k), `unexpected personal field ${k}`);
  assert.ok(!JSON.stringify(r).includes('REDACTED'));
  assert.ok(!JSON.stringify(r).includes('Administrateur'));
});

test('SIRET lookup golden -> company plus matching establishment block', () => {
  const unit = load('lookup_siret_38347481400100.json').results[0];
  const r = companyToRecord(unit, { siret: '38347481400100' });
  assert.equal(r.siren, '383474814');
  assert.equal(r.company_name, 'AIRBUS');
  assert.equal(r.matched_siret, '38347481400100');
  assert.equal(r.establishment_is_head_office, true);
  assert.equal(r.establishment_is_active, true);
  assert.equal(r.establishment_postal_code, '31700');
  assert.equal(r.establishment_city, 'BLAGNAC');
  assert.equal(r.vat_number_computed, 'FR89383474814');
  assert.equal(companyToRecord(unit, { siret: '38347481499999' }).matched_siret, null);
});

test('sole proprietors are detected and never mapped', () => {
  const units = load('search_with_individual.json').results;
  const ei = units.find((u) => u.nature_juridique === '1000');
  assert.ok(ei, 'fixture must contain an entrepreneur individuel');
  assert.equal(isIndividual(ei), true);
  assert.equal(exclusionReason(ei), 'individual_entrepreneur_excluded');
  assert.equal(companyToRecord(ei), null);
  // Flag alone is enough, whatever the legal form code says.
  assert.equal(isIndividual({ nature_juridique: '5499', complements: { est_entrepreneur_individuel: true } }), true);
  const legal = units.filter((u) => u !== ei);
  for (const u of legal) {
    assert.equal(exclusionReason(u), null);
    assert.ok(companyToRecord(u));
  }
  assert.equal(LEGAL_FORMS['1000'], 'Entrepreneur individuel');
});

test('non-diffusible units and natural-person groupings are excluded defensively', () => {
  const base = load('search_airbus.json').results[0];
  assert.equal(exclusionReason({ ...base, statut_diffusion: 'P' }), 'non_diffusible_excluded');
  assert.equal(exclusionReason({ ...base, statut_diffusion: 'N' }), 'non_diffusible_excluded');
  assert.equal(exclusionReason({ ...base, nom_complet: '[NON-DIFFUSIBLE]', nom_raison_sociale: null }), 'non_diffusible_excluded');
  assert.equal(exclusionReason({ ...base, nature_juridique: '2110' }), 'natural_person_grouping_excluded');
  assert.equal(companyToRecord({ ...base, statut_diffusion: 'P' }), null);
  // Establishment-level restriction masks the address but keeps the legal entity.
  const masked = companyToRecord({ ...base, siege: { ...base.siege, statut_diffusion_etablissement: 'P' } });
  assert.equal(masked.head_office_address, null);
  assert.equal(masked.head_office_latitude, null);
  assert.equal(masked.siren, base.siren);
});

test('search relevance: person-name queries do not surface companies via officers', () => {
  const units = load('search_airbus.json').results;
  for (const u of units) {
    assert.equal(matchesCompanyText(u, 'Airbus'), true);
    assert.equal(matchesCompanyText(u, 'airbuss'), true); // typo tolerance
    assert.equal(matchesCompanyText(u, 'Jean Dupont'), false);
  }
  const ei = load('search_with_individual.json').results;
  assert.ok(ei.filter((u) => !exclusionReason(u)).every((u) => matchesCompanyText(u, 'electricien lyon')));
});

test('single best-match mode: exact or token-subset, otherwise null', () => {
  const units = load('search_airbus.json').results;
  assert.equal(bestNameMatch(units, 'airbus')?.siren, '383474814'); // exact, first ranked
  assert.equal(bestNameMatch(units, 'AIRBUS SAS')?.siren, '383474814'); // legal suffix ignored
  assert.equal(bestNameMatch(units, 'Airbus Helicopters'), null);
  assert.equal(bestNameMatch(units, 'Boeing'), null);
  assert.equal(bestNameMatch(units, 'SAS'), null);
  assert.equal(bestNameMatch([], 'x'), null);
});

test('schema guard and date helper', () => {
  assert.throws(() => resultsOf({ bad: true }), (e) => e.failureClass === 'schema_change');
  assert.deepEqual(resultsOf({ results: [] }), []);
  assert.equal(dateOnly('2026-09-14T08:39:36'), '2026-09-14');
  assert.equal(dateOnly(null), null);
  assert.equal(companyToRecord({}), null);
  assert.equal(companyToRecord(null), null);
});
