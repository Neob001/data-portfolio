import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildUrl, parseCsv, dropDiscontinued, toRows, normalizeCurrencies } from '../src/transform.js';

const load = (f) => readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8');

test('parses real ECB dataonly CSV', () => {
  const obs = parseCsv(load('range_dataonly.csv'));
  assert.equal(obs.length, 16);
  const chf = obs.find((o) => o.currency === 'CHF' && o.date === '2026-09-08');
  assert.equal(chf.eurRate, 0.9425);
});

test('empty result and bad header', () => {
  assert.deepEqual(parseCsv(load('empty.csv')), []);
  assert.throws(() => parseCsv('foo,bar\n1,2'), (e) => e.failureClass === 'schema_change');
});

test('EUR base rows equal ECB reference values; inverse consistent', () => {
  const rows = toRows(parseCsv(load('single_day.csv')), 'EUR', ['USD']);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].date, '2026-09-14');
  assert.equal(rows[0].rate, 1.1551);
  assert.ok(Math.abs(rows[0].rate * rows[0].inverse_rate - 1) < 1e-6);
});

test('cross rates computed via EUR only when both legs exist', () => {
  const obs = parseCsv(load('range_dataonly.csv'));
  const rows = toRows(obs, 'GBP', ['USD', 'EUR', 'GBP']);
  const r = rows.find((x) => x.date === '2026-09-08' && x.quote_currency === 'EUR');
  assert.ok(Math.abs(r.rate - 1 / 0.8574) < 1e-6);
  assert.ok(rows.every((x) => x.quote_currency !== 'GBP'));
  const usd = rows.find((x) => x.date === '2026-09-08' && x.quote_currency === 'USD');
  const eurusd = obs.find((o) => o.currency === 'USD' && o.date === '2026-09-08').eurRate;
  assert.ok(Math.abs(usd.rate - eurusd / 0.8574) < 1e-6);
  assert.equal(toRows(obs, 'XYZ', ['USD']).length, 0);
});

test('discontinued currencies are dropped (ARS 2020, BGN 2025)', () => {
  const obs = parseCsv(load('latest_all_head.csv'));
  const { kept, discontinued } = dropDiscontinued(obs, new Date('2026-09-15T12:00:00Z'));
  assert.ok(discontinued.includes('ARS'));
  assert.ok(discontinued.includes('BGN'));
  assert.ok(kept.some((o) => o.currency === 'AUD'));
});

test('url building and currency normalization', () => {
  assert.equal(
    buildUrl({ currencies: ['USD', 'GBP'] }),
    'https://data-api.ecb.europa.eu/service/data/EXR/D.USD+GBP.EUR.SP00.A?format=csvdata&detail=dataonly&lastNObservations=1',
  );
  const u = buildUrl({ currencies: [], startDate: '2026-01-01', endDate: '2026-01-31' });
  assert.ok(u.includes('/D..EUR.SP00.A?') && u.includes('startPeriod=2026-01-01') && !u.includes('lastNObservations'));
  assert.deepEqual(normalizeCurrencies([' usd', 'USD', 'eur', 'bad1', '', null]), ['USD', 'EUR']);
});
