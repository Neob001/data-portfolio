import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildQuery, buildUrl, toGdeltDateTime, parseArtList, seenDateToIso, sha1Hex,
  matchRiskTerms, articleToRecord, filterNewByUrl, needsSplit, splitWindow,
  GDELT_MAX_RECORDS, RISK_TERMS, ATTRIBUTION,
} from '../src/transform.js';

const readGolden = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../golden/${name}`, import.meta.url)), 'utf8'));

test('buildQuery: news mode passes the query through, ANDs optional filter groups', () => {
  const q = buildQuery({ query: '"OpenAI"', mode: 'news', languages: ['eng'], countries: ['US', 'GB'], domains: [] });
  assert.equal(q, '"OpenAI" (sourcelang:eng) (sourcecountry:US OR sourcecountry:GB)');
});

test('buildQuery: adverse_media mode ANDs the curated risk-term group', () => {
  const q = buildQuery({ query: '"Acme Corp"', mode: 'adverse_media' });
  assert.ok(q.startsWith('("Acme Corp") AND ('));
  assert.ok(q.includes('fraud OR bribery'));
  assert.ok(q.includes('"money laundering"'), 'multi-word risk terms are quoted');
  assert.ok(q.includes('"data breach"'));
});

test('buildQuery: rejects an empty query with failureClass http_error', () => {
  assert.throws(() => buildQuery({ query: '' }), (e) => e.failureClass === 'http_error');
  assert.throws(() => buildQuery({ query: '   ' }), (e) => e.failureClass === 'http_error');
});

test('toGdeltDateTime: formats as YYYYMMDDHHMMSS UTC', () => {
  assert.equal(toGdeltDateTime(new Date('2026-09-08T14:03:07.000Z')), '20260908140307');
  assert.equal(toGdeltDateTime('2026-01-01T00:00:00.000Z'), '20260101000000');
});

test('buildUrl: composes the ArtList/JSON request URL and caps maxrecords at 250', () => {
  const url = buildUrl({
    query: '"OpenAI"', mode: 'news', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-02T00:00:00Z'), maxrecords: 9999,
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, 'https://api.gdeltproject.org/api/v2/doc/doc');
  assert.equal(parsed.searchParams.get('query'), '"OpenAI"');
  assert.equal(parsed.searchParams.get('mode'), 'ArtList');
  assert.equal(parsed.searchParams.get('format'), 'json');
  assert.equal(parsed.searchParams.get('maxrecords'), String(GDELT_MAX_RECORDS));
  assert.equal(parsed.searchParams.get('sort'), 'DateDesc');
  assert.equal(parsed.searchParams.get('startdatetime'), '20260901000000');
  assert.equal(parsed.searchParams.get('enddatetime'), '20260902000000');
});

test('parseArtList: golden fixture parses to the expected raw articles', () => {
  const articles = parseArtList(readGolden('artlist_response.json'));
  assert.equal(articles.length, 3);
  assert.equal(articles[0].domain, 'reuters.com');
});

test('parseArtList + articleToRecord: real captured GDELT response (2026-09-18 live call, query=the) round-trips to flat records', () => {
  const articles = parseArtList(readGolden('artlist_response_captured.json'));
  assert.equal(articles.length, 3);
  const records = articles.map((a) => articleToRecord(a, { query: 'the', mode: 'news' }));
  for (const r of records) {
    assert.ok(r.url.startsWith('http'));
    assert.match(r.published_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
    assert.equal(r.article_id, sha1Hex(r.url));
  }
  assert.equal(records[1].domain, 'thenorthlines.com');
  assert.equal(records[1].source_country, 'India');
  assert.equal(records[1].language, 'English');
});

test('parseArtList: a bare {} (GDELT\'s real zero-match response) parses to an empty array, not an error', () => {
  assert.deepEqual(parseArtList(readGolden('artlist_response_empty.json')), []);
  assert.deepEqual(parseArtList({}), []);
});

test('parseArtList: malformed shapes are flagged schema_change', () => {
  assert.throws(() => parseArtList(null), (e) => e.failureClass === 'schema_change');
  assert.throws(() => parseArtList([]), (e) => e.failureClass === 'schema_change');
  assert.throws(() => parseArtList({ articles: 'nope' }), (e) => e.failureClass === 'schema_change');
});

test('seenDateToIso: GDELT seendate -> ISO 8601', () => {
  assert.equal(seenDateToIso('20260908T140307Z'), '2026-09-08T14:03:07.000Z');
  assert.equal(seenDateToIso('garbage'), null);
  assert.equal(seenDateToIso(undefined), null);
});

test('sha1Hex: stable, distinct per input', () => {
  const a = sha1Hex('https://example.com/a');
  const b = sha1Hex('https://example.com/b');
  assert.equal(a, sha1Hex('https://example.com/a'));
  assert.notEqual(a, b);
  assert.match(a, /^[0-9a-f]{40}$/);
});

test('matchRiskTerms: lowercase, best-effort match against the title only', () => {
  assert.deepEqual(matchRiskTerms('Acme Corp shares fall after fraud investigation widens'), ['fraud', 'investigation']);
  assert.deepEqual(matchRiskTerms('Acme Corp issues recall of industrial valves'), ['recall']);
  assert.deepEqual(matchRiskTerms('Quarterly earnings beat expectations'), []);
  assert.deepEqual(matchRiskTerms(null), []);
});

test('articleToRecord: flattens a raw article, tags mode, and only computes matched_risk_terms in adverse_media', () => {
  const [raw] = parseArtList(readGolden('artlist_response.json'));
  const newsRec = articleToRecord(raw, { query: '"OpenAI"', mode: 'news' });
  assert.equal(newsRec.query, '"OpenAI"');
  assert.equal(newsRec.mode, 'news');
  assert.equal(newsRec.url, raw.url);
  assert.equal(newsRec.domain, 'reuters.com');
  assert.equal(newsRec.source_country, 'United States');
  assert.equal(newsRec.language, 'English');
  assert.equal(newsRec.published_at, '2026-09-15T14:00:00.000Z');
  assert.equal(newsRec.image_url, raw.socialimage);
  assert.deepEqual(newsRec.matched_risk_terms, []);
  assert.equal(newsRec.article_id, sha1Hex(raw.url));
  assert.equal(newsRec.attribution, ATTRIBUTION);

  const [adverseRaw] = parseArtList(readGolden('artlist_response_adverse.json'));
  const adverseRec = articleToRecord(adverseRaw, { query: '"Acme Corp"', mode: 'adverse_media' });
  assert.deepEqual(adverseRec.matched_risk_terms, ['fraud', 'investigation']);
});

test('articleToRecord: null for an article with no url', () => {
  assert.equal(articleToRecord({ title: 'no url here' }, { query: 'x', mode: 'news' }), null);
  assert.equal(articleToRecord(null, { query: 'x', mode: 'news' }), null);
});

test('filterNewByUrl: drops articles whose URL is already in the seen set, without mutating it', () => {
  const seen = new Set(['https://a.example/1']);
  const articles = [{ url: 'https://a.example/1' }, { url: 'https://a.example/2' }, { url: null }];
  const result = filterNewByUrl(articles, seen);
  assert.equal(result.length, 1);
  assert.equal(result[0].url, 'https://a.example/2');
  assert.equal(seen.size, 1, 'filterNewByUrl does not mutate the set it is given');
});

test('needsSplit: only true at the API cap, above the minimum window, within the depth cap', () => {
  const hour = 60 * 60 * 1000;
  assert.equal(needsSplit(GDELT_MAX_RECORDS, 0, hour, 0), true);
  assert.equal(needsSplit(GDELT_MAX_RECORDS - 1, 0, hour, 0), false, 'below the cap: not truncated');
  assert.equal(needsSplit(GDELT_MAX_RECORDS, 0, 60_000, 0), false, 'window already at the minimum floor');
  assert.equal(needsSplit(GDELT_MAX_RECORDS, 0, hour, 999), false, 'depth cap reached');
});

test('splitWindow: bisects into two contiguous, non-overlapping halves covering the whole range', () => {
  const [a, b] = splitWindow(0, 1000);
  assert.equal(a[0], 0);
  assert.equal(a[1], b[0]);
  assert.equal(b[1], 1000);
});

test('RISK_TERMS: matches the spec\'s curated adverse-media group', () => {
  assert.deepEqual(RISK_TERMS, [
    'fraud', 'bribery', 'corruption', 'money laundering', 'sanctions', 'lawsuit',
    'indictment', 'investigation', 'scandal', 'bankruptcy', 'data breach', 'recall',
  ]);
});
