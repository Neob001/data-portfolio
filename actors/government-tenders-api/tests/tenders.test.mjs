// Golden: golden/index/ is a real 5-source index slice (built by scripts/tenders_index from the 2026-11-16 local run).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  normalizeInput, keywordScorer, recordMatcher, selectShards, currentStatus, comparator, topN, toRow, OUTPUT_FIELDS, cursorFilters,
} from '../src/tenders.js';
import { search, firstSeenDay } from '../src/search.js';
import { loadManifest } from '../src/index_reader.js';
import { createTracker } from '../src/lib/incremental.js';

const BASE = fileURLToPath(new URL('../golden/index', import.meta.url));
const records = JSON.parse(readFileSync(new URL('../golden/records.json', import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-16T18:00:00Z');
const o = (input) => normalizeInput({ maxResults: 100, ...input }, NOW);
const bySource = (s) => records.find((r) => r.source === s);

test('golden records: 5 sources, exact output fields, no contact data', () => {
  assert.ok(new Set(records.map((r) => r.source)).size >= 5);
  for (const r of records) {
    assert.deepEqual(Object.keys(toRow(r)), OUTPUT_FIELDS);
    assert.ok(!/@[a-z0-9-]+\.[a-z]{2,}/i.test(JSON.stringify(r)), 'no e-mail addresses');
  }
});

test('input: defaults, sort choice, validation messages', () => {
  const d = o({});
  assert.equal(d.sortBy, 'newest');
  assert.equal(o({ keywords: ['road'] }).sortBy, 'relevance');
  assert.equal(o({ openOnly: true }).sortBy, 'deadline');
  assert.deepEqual(o({ countries: ['uk', 'de'] }).countries, ['GB', 'DE']);
  assert.deepEqual(o({ cpvCodes: ['72000000-5', '45'] }).cpvCodes, ['720000005', '45']);
  assert.throws(() => o({ countries: ['Germany'] }), /2-letter/);
  assert.throws(() => o({ noticeTypes: ['rfp'] }), /noticeTypes/);
  assert.throws(() => o({ deadlineAfter: '01/12/2026' }), /deadlineAfter/);
  assert.throws(() => o({ maxResults: 0 }), /maxResults/);
  assert.ok(!('sortBy' in cursorFilters(d)) && !('maxResults' in cursorFilters(d)));
});

test('keywords: title beats description, plurals and accents, all vs any', () => {
  const r = { title: 'Supply of laptops for schools', description_snippet: 'Lieferung von Computern für die Straßenbauverwaltung' };
  assert.equal(keywordScorer(o({ keywords: ['laptop'] }))(r), 3);
  assert.equal(keywordScorer(o({ keywords: ['computern'] }))(r), 1);
  assert.equal(keywordScorer(o({ keywords: ['strassenbau'] }))(r), 0, 'no stemming beyond plurals');
  assert.equal(keywordScorer(o({ keywords: ['fur'] }))(r), 1, 'accent-insensitive (für)');
  assert.equal(keywordScorer(o({ keywords: ['lap'] }))(r), 0, 'whole words only');
  assert.equal(keywordScorer(o({ keywords: ['laptop', 'drones'], keywordMatch: 'all' }))(r), 0);
  assert.equal(keywordScorer(o({ keywords: ['laptop', 'drones'] }))(r), 3);
});

test('filters: country, CPV/NAICS prefix, value + currency, buyer, open-at-run-time', () => {
  const ted = bySource('ted');
  const sam = bySource('sam');
  assert.ok(recordMatcher(o({ countries: [ted.country_code] }), NOW)({ ...ted }));
  assert.ok(!recordMatcher(o({ countries: ['ZZ'] }), NOW)({ ...ted }));
  if (ted.cpv_codes.length) assert.ok(recordMatcher(o({ cpvCodes: [ted.cpv_codes[0].slice(0, 2)] }), NOW)({ ...ted }));
  assert.ok(!recordMatcher(o({ cpvCodes: ['72'] }), NOW)({ ...sam, cpv_codes: [] }));
  if (sam.naics_codes.length) assert.ok(recordMatcher(o({ naicsCodes: [sam.naics_codes[0].slice(0, 3)] }), NOW)({ ...sam }));
  const v = { ...ted, value_amount: 250000, value_currency: 'EUR' };
  assert.ok(recordMatcher(o({ minValue: 100000, maxValue: 300000, currency: 'eur' }), NOW)({ ...v }));
  assert.ok(!recordMatcher(o({ minValue: 300000 }), NOW)({ ...v }));
  assert.ok(!recordMatcher(o({ minValue: 1 }), NOW)({ ...v, value_amount: null }), 'no value -> excluded by a value filter');
  assert.ok(recordMatcher(o({ buyers: [ted.buyer_name.slice(0, 6)] }), NOW)({ ...ted }));
  const tender = { notice_type: 'tender', status: 'open', deadline_at: '2026-11-16T12:00:00Z' };
  assert.equal(currentStatus(tender, NOW), 'closed', 'deadline passed since the nightly build');
  assert.ok(!recordMatcher(o({ openOnly: true }), NOW)({ ...ted, ...tender }));
});

test('shard selection skips by source, country, open deadline and publication window', async () => {
  const m = await loadManifest(BASE);
  assert.equal(selectShards(m, o({}), { now: NOW }).length, m.shards.length);
  assert.ok(selectShards(m, o({ sources: ['sam'] }), { now: NOW }).every((s) => s.source === 'sam'));
  assert.ok(selectShards(m, o({ countries: ['US'] }), { now: NOW }).every((s) => s.countries.includes('US')));
  assert.ok(selectShards(m, o({ openOnly: true }), { now: NOW }).every((s) => s.deadline_max > '2026-11-16T18'));
  const late = normalizeInput({ publishedWithinDays: 1 }, Date.parse('2027-06-01T00:00:00Z'));
  assert.equal(selectShards(m, late, { now: NOW }).length, 0);
});

test('search over the golden index: ranking, open only, sort orders', async () => {
  const m = await loadManifest(BASE);
  const all = await search({ base: BASE, manifest: m, o: o({}), now: NOW });
  assert.equal(all.rows.length, records.length);
  assert.deepEqual(Object.keys(all.rows[0]), OUTPUT_FIELDS);
  for (let i = 1; i < all.rows.length; i += 1) assert.ok(all.rows[i - 1].published_at >= all.rows[i].published_at, 'newest first');
  const word = records[0].title.split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, '')).sort((a, b) => b.length - a.length)[0];
  const kw = await search({ base: BASE, manifest: m, o: o({ keywords: [word] }), now: NOW });
  assert.ok(kw.rows.length >= 1 && kw.rows[0].notice_id === records[0].notice_id);
  const open = await search({ base: BASE, manifest: m, o: o({ openOnly: true }), now: NOW });
  assert.ok(open.rows.every((r) => r.status === 'open' && r.deadline_at > '2026-11-16T18'));
  for (let i = 1; i < open.rows.length; i += 1) assert.ok(open.rows[i - 1].deadline_at <= open.rows[i].deadline_at, 'soonest deadline first');
  const top2 = await search({ base: BASE, manifest: m, o: o({ maxResults: 2 }), now: NOW });
  assert.equal(top2.rows.length, 2);
  assert.equal(top2.matched, records.length);
});

test('sinceLastRun: second pass over the same index delivers nothing', async () => {
  const m = await loadManifest(BASE);
  const opts = o({ sinceLastRun: true });
  const t1 = createTracker(null);
  const first = await search({ base: BASE, manifest: m, o: opts, tracker: t1, now: NOW });
  for (const r of first.rows) t1.observe(firstSeenDay(r), r.notice_id);
  const cursor = t1.next({ truncated: false, runSince: null });
  assert.ok(cursor && cursor.complete);
  const second = await search({ base: BASE, manifest: m, o: opts, tracker: createTracker(cursor), now: NOW });
  assert.equal(first.rows.length, records.length);
  assert.equal(second.rows.length, 0);
});

test('topN keeps the best n under any comparator', () => {
  const items = Array.from({ length: 30000 }, (_, i) => ({ r: { notice_id: `x${i}`, published_at: `2026-${String((i % 12) + 1).padStart(2, '0')}-01`, value_amount: i }, score: i % 7 }));
  const t = topN(5, comparator('value'));
  for (const x of items) t.push(x);
  assert.deepEqual(t.result().map((x) => x.r.value_amount), [29999, 29998, 29997, 29996, 29995]);
  assert.equal(t.total, 30000);
});
