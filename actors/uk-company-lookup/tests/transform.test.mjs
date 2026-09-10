import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { profileToRecord, bestSearchMatch, normalizeCompanyNumber } from '../src/transform.js';

const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8'));

test('maps golden company profile to flat record', () => {
  const r = profileToRecord(load('company_profile.json'));
  assert.equal(r.company_number, '01234567');
  assert.equal(r.company_name, 'EXAMPLE WIDGETS LIMITED');
  assert.equal(r.status, 'active');
  assert.equal(r.incorporated_on, '2012-03-15');
  assert.equal(r.registered_office, '1, Example Street, London, Greater London, EC1A 1AA, England');
  assert.equal(r.registered_office_postcode, 'EC1A 1AA');
  assert.equal(r.accounts_next_due, '2026-12-31');
  assert.equal(r.has_charges, true);
  assert.equal(r.company_url, 'https://find-and-update.company-information.service.gov.uk/company/01234567');
  // No personal data fields may ever appear (see DECISIONS.md).
  for (const k of Object.keys(r)) {
    assert.ok(!/officer|director|birth|nationality|occupation/i.test(k), `unexpected personal field ${k}`);
  }
});

test('search match prefers exact normalized title', () => {
  const s = load('company_search.json');
  assert.equal(bestSearchMatch(s, 'Example Widgets Ltd.'), '07654321'); // no exact -> first
  assert.equal(bestSearchMatch(s, 'example widgets limited'), '01234567'); // exact wins
  assert.equal(bestSearchMatch({ items: [] }, 'x'), null);
  assert.throws(() => bestSearchMatch({ bad: true }, 'x'), (e) => e.failureClass === 'schema_change');
});

test('normalizes company numbers', () => {
  assert.equal(normalizeCompanyNumber('1234567'), '01234567');
  assert.equal(normalizeCompanyNumber(' sc 123456 '.replace(/ /g, '')), 'SC123456');
  assert.equal(normalizeCompanyNumber(''), null);
});

test('malformed profile returns null', () => {
  assert.equal(profileToRecord({}), null);
  assert.equal(profileToRecord(null), null);
});
