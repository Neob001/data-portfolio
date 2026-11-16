// node --test scripts/tenders_index/tests/*.test.mjs  (real fixtures from 2026-11-12/13; contact points removed)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { RECORD_FIELDS, isoTs, snippet, redactContacts, countryCode, orgSupplierName, deriveStatus, cpvList } from '../lib/normalize.mjs';
import { tedToRecord, tedNoticeType, pickLang } from '../lib/ted.mjs';
import { samRowToRecord, headerIndex, createCsvParser, samTs } from '../lib/sam.mjs';
import { ocdsToRecord } from '../lib/ocds.mjs';
import { ftsCtx, cfCtx, plannedDays } from '../lib/sources.mjs';
import { retain, crossSourceDedupe, SourceStore } from '../lib/store.mjs';
import { writeIndex, ageBand } from '../lib/writer.mjs';
import { robotsAllows } from '../lib/robots.mjs';

const fx = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));
const NOW = Date.parse('2026-11-14T03:00:00Z');
const FETCHED = '2026-11-14T03:05:00Z';
const ctx = { now: NOW, fetchedAt: FETCHED };
const shape = (r) => assert.deepEqual(Object.keys(r), RECORD_FIELDS);

test('helpers: dates, snippets, redaction, codes', () => {
  assert.equal(isoTs('2026-11-13+01:00'), '2026-11-13T00:00:00Z');
  assert.equal(isoTs('2026-12-11T12:00:00+00:00'), '2026-12-11T12:00:00Z');
  assert.equal(isoTs('garbage'), null);
  assert.equal(samTs('2026-09-14 10:22:33.123-04'), '2026-09-14T14:22:33Z');
  assert.equal(redactContacts('Contact jane.doe@council.gov.uk or +44 20 7946 0958 about ref 2026/123 for £1,200,000'),
    'Contact [email redacted] or [phone redacted] about ref 2026/123 for £1,200,000');
  const s = snippet('word '.repeat(300));
  assert.ok(s.length <= 500 && s.endsWith('…'));
  assert.deepEqual([countryCode('POL'), countryCode('United Kingdom'), countryCode('gb'), countryCode('DE-BY')], ['PL', 'GB', 'GB', 'DE']);
  assert.deepEqual(cpvList(['45000000-7', '45000000', '7222']), ['45000000']);
  assert.equal(orgSupplierName('WSP UK LIMITED', ['GB-COH']), 'WSP UK LIMITED');
  assert.equal(orgSupplierName('WSP UK LIMITED', ['GB-PPON']), null);
  assert.equal(orgSupplierName('J Smith t/a Smith Plumbing', ['GB-COH']), null);
  assert.equal(deriveStatus({ notice_type: 'tender', deadline_at: '2026-12-01T00:00:00Z' }, null, NOW), 'open');
  assert.equal(deriveStatus({ notice_type: 'tender', deadline_at: '2026-11-01T00:00:00Z' }, null, NOW), 'closed');
  assert.equal(deriveStatus({ notice_type: 'award', deadline_at: null }, null, NOW), 'awarded');
});

test('TED: call for tender and award notice', () => {
  const [cn, can] = fx('ted_notices.json').map((n) => tedToRecord(n, ctx));
  for (const r of [cn, can]) {
    shape(r);
    assert.equal(r.source, 'ted');
    assert.equal(r.country_code, 'DE');
    assert.match(r.notice_id, /^ted:\d+-2026$/);
    assert.match(r.notice_url, /^https:\/\/ted\.europa\.eu\/en\/notice\/-\/detail\//);
    assert.equal(r.published_at, '2026-11-13T00:00:00Z');
    assert.deepEqual(r.supplier_names, []);
    assert.ok(r.cpv_codes.length && r.cpv_codes.every((c) => /^\d{8}$/.test(c)));
    assert.match(r.title, /^Germany – /);
  }
  assert.equal(cn.notice_type, 'tender');
  assert.ok(cn.deadline_at);
  assert.equal(can.notice_type, 'award');
  assert.equal(can.status, 'awarded');
  assert.equal(can.deadline_at, null);
  assert.deepEqual(['pin-only', 'pin-cfc-standard', 'cn-social', 'can-modif', 'veat', 'corr'].map(tedNoticeType), ['planning', 'tender', 'tender', 'contract', 'award', 'other']);
  assert.equal(pickLang({ deu: ['Stadt'], eng: ['City'] }), 'City');
});

test('UK Find a Tender + Contracts Finder releases', () => {
  const uk = fx('uk_releases.json');
  const t = ocdsToRecord(uk.fts_tender, { ...ftsCtx(ctx), now: NOW });
  shape(t);
  assert.equal(t.notice_type, 'tender');
  assert.equal(t.country_code, 'GB');
  assert.equal(t.notice_url, `https://www.find-tender.service.gov.uk/Notice/${uk.fts_tender.id}`);
  const a = ocdsToRecord(uk.fts_award, { ...ftsCtx(ctx), now: NOW });
  assert.equal(a.notice_type, 'award');
  assert.equal(a.status, 'awarded');
  assert.ok(a.supplier_names.length >= 1, 'GB-COH supplier listed');
  const c = ocdsToRecord(uk.cf_award, { ...cfCtx(ctx), now: NOW });
  assert.equal(c.notice_id, `uk-cf:${uk.cf_award.id}`);
  assert.equal(c.notice_url, 'https://www.contractsfinder.service.gov.uk/Notice/b8e851b7-aa00-4442-b861-4e96d5ff154e');
  assert.deepEqual(c.supplier_names, [], 'a supplier without a Companies House number is not listed');
  assert.equal(c.value_amount, 190659.59);
  assert.equal(c.value_currency, 'GBP');
  assert.deepEqual(c.cpv_codes, ['72224000']);
});

test('OCP registry compiled releases (South Africa): no contact person, no suppliers', () => {
  const recs = fx('ocds_compiled_za.json').map((r) => ocdsToRecord(r, {
    source: 'ocds-za', idPrefix: 'ocds-za', country: 'ZA', language: 'en', compiled: true, suppliers: false,
    now: NOW, fetchedAt: FETCHED, sourceUrl: () => 'https://data.open-contracting.org/en/publication/143',
  }));
  for (const r of recs) {
    shape(r);
    assert.match(r.notice_id, /^ocds-za:ocds-/);
    assert.deepEqual(r.supplier_names, []);
    const s = JSON.stringify(r);
    for (const pii of ['Test Person', 'person@example.org', '012-345-6789']) assert.ok(!s.includes(pii), pii);
  }
  assert.ok(recs.some((r) => r.notice_type === 'award' || r.notice_type === 'contract'));
  assert.ok(recs.every((r) => r.value_amount === null || r.value_amount > 0), 'zero values are "not stated"');
});

test('SAM.gov CSV rows: contacts never copied, types mapped', () => {
  const csv = readFileSync(new URL('./fixtures/sam_head.csv', import.meta.url), 'latin1');
  const rows = [];
  const p = createCsvParser((r) => { rows.push(r); return true; });
  p.feed(csv);
  p.end();
  const idx = headerIndex(rows[0]);
  const recs = rows.slice(1).filter((r) => r.length > 5).map((r) => samRowToRecord(r, idx, ctx));
  assert.ok(recs.length >= 3);
  for (const r of recs) {
    shape(r);
    assert.equal(r.country_code, 'US');
    assert.ok(!JSON.stringify(r).includes('officer@example.gov') && !JSON.stringify(r).includes('Test Officer'), 'contacts must not leak');
  }
  assert.ok(recs.some((r) => r.naics_codes.length));
});

test('retention, cross-source dedupe, store keeps first fetched_at', () => {
  const day = 86400000;
  const base = { notice_type: 'tender', status: 'open', deadline_at: new Date(NOW + 5 * day).toISOString(), buyer_name: 'Stadt Musterstadt', buyer_country: 'DE', country_code: 'DE' };
  assert.equal(retain({ ...base, published_at: new Date(NOW - 10 * day).toISOString() }, { now: NOW, windowDays: 90 }), true);
  assert.equal(retain({ ...base, published_at: new Date(NOW - 200 * day).toISOString() }, { now: NOW, windowDays: 90 }), true, 'old but still open');
  assert.equal(retain({ ...base, notice_type: 'award', deadline_at: null, published_at: new Date(NOW - 200 * day).toISOString() }, { now: NOW, windowDays: 90 }), false);
  const closing = { ...base, deadline_at: new Date(NOW - day).toISOString(), published_at: new Date(NOW - 20 * day).toISOString() };
  retain(closing, { now: NOW, windowDays: 90 });
  assert.equal(closing.status, 'closed', 'status re-derived every night');

  const t = { ...base, notice_id: 'ted:1-2026', source: 'ted', title: 'Germany – Road works – Sanierung der Hauptstraße Abschnitt 3', published_at: '2026-11-13T00:00:00Z', cpv_codes: ['45233000'] };
  const d = { ...base, notice_id: 'ocds-de:x', source: 'ocds-de', title: 'Sanierung der Hauptstraße, Abschnitt 3', published_at: '2026-11-13T00:00:00Z', cpv_codes: [] };
  const other = { ...d, notice_id: 'ocds-de:y', title: 'Neubau einer Grundschule mit Sporthalle' };
  const { drop, duplicates } = crossSourceDedupe([t, d, other]);
  assert.equal(duplicates, 1);
  assert.deepEqual([...drop], ['ocds-de:x']);

  const s = new SourceStore('ted');
  s.upsert({ notice_id: 'a', fetched_at: '2026-11-10T03:00:00Z', status: 'open' });
  s.upsert({ notice_id: 'a', fetched_at: '2026-11-12T03:00:00Z', status: 'closed' });
  assert.deepEqual(s.map.get('a'), { notice_id: 'a', fetched_at: '2026-11-10T03:00:00Z', status: 'closed' });
});

test('day planning: refresh window + backfill, weekends skipped for TED', () => {
  const days = plannedDays({ days: { '2026-11-10': { complete: true } } }, { now: NOW, windowDays: 7, refreshDays: 3 });
  assert.deepEqual(days, ['2026-11-14', '2026-11-13', '2026-11-12', '2026-11-11', '2026-11-09', '2026-11-08', '2026-11-07']);
  const ted = plannedDays({}, { now: NOW, windowDays: 7, refreshDays: 1, skipWeekends: true });
  assert.ok(!ted.includes('2026-11-08') && !ted.includes('2026-11-07'));
  assert.deepEqual(plannedDays({}, { now: NOW, windowDays: 90, maxDays: 2 }), ['2026-11-14', '2026-11-13']);
});

test('writer: shards by source and age band, manifest describes each shard', () => {
  const out = mkdtempSync(join(tmpdir(), 'tidx-'));
  const recs = fx('ted_notices.json').map((n) => tedToRecord(n, ctx));
  const m = writeIndex(recs, { outDir: out, builtAt: '2026-11-14T03:00:00.000Z', codec: 'br' });
  assert.equal(m.notices, 2);
  assert.equal(m.shards.length, 1);
  const s = m.shards[0];
  assert.equal(s.source, 'ted');
  assert.equal(s.band, ageBand('2026-11-13T00:00:00Z', NOW));
  assert.deepEqual(s.countries, ['DE']);
  assert.ok(s.fetched_max && s.published_to >= s.published_from);
  const lines = zlib.brotliDecompressSync(readFileSync(join(out, s.file))).toString().trim().split('\n');
  assert.equal(lines.length, 2);
  assert.deepEqual(Object.keys(JSON.parse(lines[0])), RECORD_FIELDS);
});

test('robots R1 evaluation (RFC 9309 longest match)', () => {
  const sam = 'User-agent: *\nAllow: /core/*.css$\nDisallow: /core/\nDisallow: /search/\n';
  assert.equal(robotsAllows(sam, '/api/prod/fileextractservices/v1/api/download/x.csv?privacy=Public'), true);
  assert.equal(robotsAllows(sam, '/search/opp'), false);
  assert.equal(robotsAllows(sam, '/core/a.css'), true);
  const canadabuys = 'User-agent: bingbot\nUser-agent: Googlebot\nDisallow: /admin/\n\nUser-agent: *\nDisallow: /\n';
  assert.equal(robotsAllows(canadabuys, '/opendata/pub/newTenderNotice.csv'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow:\n', '/en/publication/19/download'), true);
  assert.equal(robotsAllows('User-agent: factpipe\nDisallow: /\n\nUser-agent: *\nAllow: /\n', '/x'), false, 'our own group wins');
});

test('AusTender compiled release: order number title -> contract description; buyer = procuring entity', () => {
  // Real compiled release from the OCP registry (publication 19, CC BY 3.0 AU), contact points removed, ids shortened.
  const rel = {
    id: 'prod-0078e398a5bc448db8a441d81d5d8c96-2026-04-02T04:41:38Z', tag: ['compiled'], date: '2026-04-02T04:41:38Z', ocid: 'prod-0078e398a5bc448db8a441d81d5d8c96',
    awards: [{ id: 'CN4230358-7ea2', date: '2026-04-02T04:41:38Z', status: 'active', suppliers: [{ id: '48fc', name: 'AURECON AUSTRALASIA PTY LTD' }] }],
    tender: { id: 'prod-0078e398a5bc448db8a441d81d5d8c96', procurementMethod: 'limited', procurementMethodDetails: 'Limited tender' },
    parties: [
      { id: '48fc', name: 'AURECON AUSTRALASIA PTY LTD', roles: ['supplier'], additionalIdentifiers: [{ id: '54005139873', scheme: 'AU-ABN' }] },
      { id: '0ec9', name: 'Department of Defence', roles: ['procuringEntity'], additionalIdentifiers: [{ id: '62950639680', scheme: 'AU-ABN' }] },
    ],
    language: 'EN',
    contracts: [{ id: 'CN4230358', items: [{ id: '1', classification: { id: '72100000', scheme: 'UNSPSC' } }], title: '4600094260', value: { amount: '172143.42', currency: 'AUD' }, status: 'active', awardID: 'CN4230358-7ea2', dateSigned: '2026-04-02T04:41:38Z', description: 'Project Management' }],
  };
  const r = ocdsToRecord(rel, { source: 'ocds-au', idPrefix: 'ocds-au', country: 'AU', language: 'en', compiled: true, suppliers: false, now: NOW, fetchedAt: FETCHED, sourceUrl: () => 'https://data.open-contracting.org/en/publication/19' });
  assert.equal(r.title, 'Project Management');
  assert.equal(r.buyer_name, 'Department of Defence');
  assert.equal(r.notice_type, 'contract');
  assert.equal(r.value_amount, 172143.42);
  assert.deepEqual(r.unspsc_codes, ['72100000']);
  assert.equal(r.published_at, '2026-04-02T04:41:38Z');
  assert.equal(r.deadline_at, null);
  assert.deepEqual(r.supplier_names, [], 'ABNs are issued to sole traders too: registry suppliers are never listed');
  assert.equal(r.language, 'en');
});
