import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCoordinate, parsePoints, parseForecast } from '../src/transform.js';

const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8'));

test('parses coordinates strictly', () => {
  assert.deepEqual(parseCoordinate('40.7128,-74.006'), { lat: 40.7128, lon: -74.006 });
  assert.deepEqual(parseCoordinate(' 33.4, 112.1 '), { lat: 33.4, lon: 112.1 });
  assert.equal(parseCoordinate('New York'), null);
  assert.equal(parseCoordinate('91,0'), null);
  assert.equal(parseCoordinate(''), null);
});

test('parses golden points response', () => {
  const p = parsePoints(load('points_response.json'));
  assert.equal(p.forecastUrl, 'https://api.weather.gov/gridpoints/OKX/33,42/forecast');
  assert.ok(p.gridId);
  assert.throws(() => parsePoints({}), (e) => e.failureClass === 'schema_change');
});

test('parses golden forecast periods into flat records', () => {
  const periods = parseForecast(load('forecast_response.json'));
  assert.equal(periods.length, 3);
  const p = periods[0];
  assert.equal(p.period_name, 'Overnight');
  assert.equal(p.temperature, 70);
  assert.equal(p.precipitation_probability_pct, 17);
  assert.equal(p.is_daytime, false);
  assert.ok(p.start_time && p.end_time);
  assert.throws(() => parseForecast({ properties: {} }), (e) => e.failureClass === 'schema_change');
});
