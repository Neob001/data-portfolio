import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseVatInput, parseViesResponse } from '../src/transform.js';

const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8'));

test('parses VAT inputs in common formats', () => {
  assert.deepEqual(parseVatInput('CZ04788290'), { countryCode: 'CZ', vatNumber: '04788290' });
  assert.deepEqual(parseVatInput('de 811.569.869'), { countryCode: 'DE', vatNumber: '811569869' });
  assert.deepEqual(parseVatInput('GR094014201'), { countryCode: 'EL', vatNumber: '094014201' });
  assert.deepEqual(parseVatInput('6388047V', 'IE'), { countryCode: 'IE', vatNumber: '6388047V' });
  assert.equal(parseVatInput('US123456789'), null);
  assert.equal(parseVatInput('123456789'), null);
  assert.equal(parseVatInput(''), null);
});

test('valid response (real VIES capture) -> flat record with name/address', () => {
  const r = parseViesResponse(load('vat_CZ_04788290.json'));
  assert.equal(r.status, 'valid');
  assert.equal(r.record.full_vat_number, 'CZ04788290');
  assert.equal(r.record.name, 'Apify Technologies s.r.o.');
  assert.ok(!r.record.address.includes('\n'));
  assert.equal(r.record.consultation_number, null);
});

test('invalid response -> invalid with no name/address', () => {
  const r = parseViesResponse(load('vat_FR_00000000000.json'));
  assert.equal(r.status, 'invalid');
  assert.equal(r.record.valid, false);
  assert.equal(r.record.name, null);
});

test('concurrency throttle is transient, never invalid', () => {
  const r = parseViesResponse(load('vat_DE_811569869.json'));
  assert.equal(r.status, 'transient');
  assert.equal(r.error, 'MS_MAX_CONCURRENT_REQ');
  assert.equal(parseViesResponse({ errorWrappers: [{ error: 'INVALID_INPUT' }] }).status, 'error');
});

test('unexpected shapes raise schema_change', () => {
  assert.throws(() => parseViesResponse({ foo: 1 }), (e) => e.failureClass === 'schema_change');
});
