import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runQueries } from '../src/lookup.js';
import { FetchError } from '../src/lib/http.js';

const load = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), 'utf8'));

/** Offline harness: routes API URLs to golden fixtures and records charge decisions. */
function harness(route, { chargeLimit = Infinity } = {}) {
  const rows = [];
  const urls = [];
  let charged = 0;
  const deps = {
    limit: async () => {},
    fetchJson: async (url) => {
      urls.push(url);
      return route(new URL(url));
    },
    emit: async (record, { charge }) => {
      rows.push({ record, charge });
      if (!charge) return { stop: false };
      charged += 1;
      return { stop: charged >= chargeLimit };
    },
  };
  return { rows, urls, deps, charged: () => charged };
}

const byQuery = (map) => (u) => {
  const q = u.searchParams.get('q');
  if (!(q in map)) return { results: [], total_results: 0, page: 1, per_page: 10, total_pages: 0 };
  const v = map[q];
  if (v instanceof Error) throw v;
  return v;
};

test('SIREN and SIRET lookups charge exactly once each', async () => {
  const h = harness(byQuery({
    552081317: load('lookup_siren_552081317.json'),
    38347481400100: load('lookup_siret_38347481400100.json'),
  }));
  const stats = await runQueries(['552 081 317', '383 474 814 00100'], { onlyActive: true, postalCode: '99999' }, h.deps);
  assert.equal(h.rows.length, 2);
  assert.ok(h.rows.every((r) => r.charge && r.record.found === true && r.record.reason === null));
  assert.equal(h.rows[0].record.siren, '552081317');
  assert.equal(h.rows[1].record.matched_siret, '38347481400100');
  // Identifier lookups ignore search filters.
  assert.ok(h.urls.every((u) => !u.includes('code_postal') && !u.includes('etat_administratif')));
  for (const { record } of h.rows) {
    assert.ok(record.source_url.startsWith('https://recherche-entreprises.api.gouv.fr/search?'));
    assert.ok(!Number.isNaN(Date.parse(record.fetched_at)));
    assert.ok(!('dirigeants' in record));
  }
  assert.equal(stats.found, 2);
});

test('invalid identifiers, SIREN mismatch and unknown SIRET are free', async () => {
  const siret = load('lookup_siret_38347481400100.json');
  const h = harness(byQuery({
    // API returned a text match for a different company -> must not be delivered
    123456782: load('lookup_siren_552081317.json'),
    38347481400092: siret,
  }));
  await runQueries(['552081318', '123456782', '383 474 814 00092', 'ab'], {}, h.deps);
  assert.deepEqual(h.rows.map((r) => r.record.reason), ['invalid_siren_checksum', 'not_found', 'siret_not_found', 'query_too_short']);
  assert.ok(h.rows.every((r) => !r.charge && r.record.found === false && r.record.source_url && r.record.fetched_at));
  assert.equal(h.charged(), 0);
});

test('identifier lookup of a sole proprietor returns individual_entrepreneur_excluded, uncharged', async () => {
  const withEi = load('search_with_individual.json');
  const ei = withEi.results.find((u) => u.nature_juridique === '1000');
  const h = harness(byQuery({ [ei.siren]: { ...withEi, results: [ei] } }));
  await runQueries([ei.siren], {}, h.deps);
  assert.equal(h.rows.length, 1);
  assert.equal(h.rows[0].charge, false);
  assert.deepEqual(Object.keys(h.rows[0].record).sort(), ['fetched_at', 'found', 'query', 'reason', 'source_url']);
  assert.equal(h.rows[0].record.reason, 'individual_entrepreneur_excluded');
});

test('name search skips sole proprietors silently and charges per delivered company', async () => {
  const h = harness(byQuery({ 'electricien lyon': load('search_with_individual.json') }));
  const stats = await runQueries(['electricien lyon'], { maxResultsPerQuery: 5 }, h.deps);
  assert.equal(h.rows.length, 3);
  assert.ok(h.rows.every((r) => r.charge && r.record.found));
  assert.ok(h.rows.every((r) => r.record.legal_form_code !== '1000'));
  assert.ok(!JSON.stringify(h.rows).includes('REDACTED'));
  assert.equal(stats.excluded, 1);
  const u = new URL(h.urls[0]);
  assert.equal(u.searchParams.get('etat_administratif'), 'A'); // onlyActive default
});

test('maxResultsPerQuery caps delivered rows; charge limit stops the run', async () => {
  const airbus = load('search_airbus.json');
  let h = harness(byQuery({ airbus }));
  await runQueries(['airbus'], { maxResultsPerQuery: 2 }, h.deps);
  assert.equal(h.rows.filter((r) => r.charge).length, 2);

  h = harness(byQuery({ airbus, 552081317: load('lookup_siren_552081317.json') }), { chargeLimit: 1 });
  const stats = await runQueries(['airbus', '552081317'], { maxResultsPerQuery: 5 }, h.deps);
  assert.equal(h.charged(), 1);
  assert.equal(h.rows.length, 1);
  assert.equal(stats.stopped, true);
});

test('single best-match mode returns a confident match or an uncharged miss', async () => {
  const airbus = load('search_airbus.json');
  const h = harness(byQuery({ airbus, 'airbus helicopters': airbus, 'jean dupont': airbus }));
  await runQueries(['airbus', 'airbus helicopters', 'jean dupont', 'nothing here'], { maxResultsPerQuery: 1 }, h.deps);
  assert.deepEqual(h.rows.map((r) => [r.record.found, r.record.reason, r.charge]), [
    [true, null, true],
    [false, 'no_confident_match', false],
    [false, 'no_confident_match', false],
    [false, 'no_results', false],
  ]);
});

test('API failures are recorded per query, never charged, and do not abort other queries', async () => {
  const h = harness(byQuery({
    boom: new FetchError('HTTP 503', 'site_down', 503),
    bad: new FetchError('HTTP 400', 'http_error', 400),
    552081317: load('lookup_siren_552081317.json'),
  }));
  const stats = await runQueries(['boom', 'bad', '552081317'], {}, h.deps);
  assert.deepEqual(h.rows.map((r) => [r.record.reason, r.charge]), [['api_error', false], ['invalid_query', false], [null, true]]);
  assert.equal(stats.errors, 1);
  assert.equal(stats.failure_class, 'site_down');
});

test('schema change in payload is reported as a failure class', async () => {
  const h = harness(() => ({ unexpected: true }));
  const stats = await runQueries(['airbus'], {}, h.deps);
  assert.equal(stats.failure_class, 'schema_change');
  assert.equal(h.charged(), 0);
});
