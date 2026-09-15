import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  parseCsv, buildEntries, ofacEntries, parseEuXml, parseUkXml, parseUnXml, buildIndex, screenName,
  normalizeName, latinName, listsFromInput, decideListOutcomes, buildRecord, pickSourceUrl, publishInfo, xmlBlocks, decodeXml,
  LIST_IDS, SDN_URL, EU_URL, UK_URL, UN_URL,
} from '../src/transform.js';

const load = (f, enc = 'utf8') => readFileSync(fileURLToPath(new URL(`../golden/${f}`, import.meta.url)), enc);

const ofac = ofacEntries(parseCsv(load('sdn_sample.csv', 'latin1')), parseCsv(load('alt_sample.csv', 'latin1')));
const eu = parseEuXml(load('eu_sample.xml'));
const uk = parseUkXml(load('uk_sample.xml'));
const un = parseUnXml(load('un_sample.xml'));
const all = [...ofac, ...eu.entries, ...uk.entries, ...un.entries];
const index = buildIndex(all);

const SHAPE_KEYS = ['list', 'list_entry_id', 'primary_name', 'names', 'entity_type', 'programs', 'listed_on'];
const TYPES = new Set(['individual', 'entity', 'vessel', 'aircraft', null]);

test('every parser emits the unified entry shape', () => {
  for (const e of all) {
    for (const k of SHAPE_KEYS) assert.ok(k in e, `${e.list} ${e.list_entry_id} missing ${k}`);
    assert.ok(LIST_IDS.includes(e.list));
    assert.equal(e.names[0], e.primary_name);
    assert.ok(Array.isArray(e.programs));
    assert.ok(TYPES.has(e.entity_type));
    assert.ok(e.listed_on === null || /^\d{4}-\d{2}-\d{2}$/.test(e.listed_on));
    // No remarks, birth dates or ID documents are carried into entries.
    for (const k of Object.keys(e)) assert.ok(!/remark|birth|passport|document|address/i.test(k), k);
  }
});

test('OFAC unified entries keep legacy program text and types', () => {
  const bnc = ofac.find((e) => e.list_entry_id === '306');
  assert.equal(bnc.primary_name, 'BANCO NACIONAL DE CUBA');
  assert.deepEqual(bnc.names, ['BANCO NACIONAL DE CUBA', 'NATIONAL BANK OF CUBA']);
  assert.deepEqual(bnc.programs, ['CUBA']);
  assert.equal(bnc.entity_type, 'entity');
  const multi = ofacEntries([['1', 'X TRADING', 'individual', 'SDGT] [IRGC']], [])[0];
  assert.deepEqual(multi.programs, ['SDGT', 'IRGC']);
  assert.equal(multi.entity_type, 'individual');
});

test('EU parser: individuals, entities, EN/original primary name, dates, publication date', () => {
  assert.equal(eu.publication_date, '2026-08-05');
  assert.equal(eu.entries.length, 5);
  const qusay = eu.entries.find((e) => e.list_entry_id === 'EU.39.56');
  assert.equal(qusay.primary_name, 'Qusay Saddam Hussein Al-Tikriti');
  assert.ok(qusay.names.includes('Qoussaï Saddam Hussein Al-Tikriti'));
  assert.equal(qusay.entity_type, 'individual');
  assert.deepEqual(qusay.programs, ['IRQ']);
  assert.equal(qusay.listed_on, '2003-07-08'); // no designationDate -> regulation publication date
  const ano = eu.entries.find((e) => e.list_entry_id === 'EU.3502.46');
  assert.equal(ano.primary_name, 'Abu Nidal Organisation');
  assert.equal(ano.entity_type, 'entity');
  assert.equal(ano.listed_on, '2002-06-18');
  assert.ok(ano.names.includes('Organização Abu Nidal'));
  assert.ok(!ano.names.some((n) => /[Ͱ-Ͽ]/.test(n)), 'non-Latin names are skipped');
  const kabir = eu.entries.find((e) => e.list_entry_id === 'EU.449.72');
  assert.equal(kabir.primary_name, 'Abdul Kabir Mohammad Jan');
  assert.deepEqual(kabir.names.slice(1).sort(), ['A. Kabir', 'Kabir Abdul']);
});

test('UK parser: name parts, primary vs aliases, ships, regimes, dd/mm/yyyy dates', () => {
  assert.equal(uk.publication_date, '2026-09-11');
  assert.equal(uk.entries.length, 4);
  const kabir = uk.entries.find((e) => e.list_entry_id === 'AFG0007');
  assert.equal(kabir.primary_name, 'Abdul Kabir MOHAMMAD JAN');
  assert.ok(kabir.names.includes('ABDUL KABIR MUHAMMAD JAN'));
  assert.ok(kabir.names.includes('A Kabir'));
  assert.equal(kabir.listed_on, '2001-01-25');
  assert.deepEqual(kabir.programs, ['The Afghanistan (Sanctions) (EU Exit) Regulations 2020']);
  const adf = uk.entries.find((e) => e.list_entry_id === 'DRC0015');
  assert.equal(adf.entity_type, 'entity');
  assert.ok(adf.names.includes('Allied Democratic Forces'));
  const ship = uk.entries.find((e) => e.list_entry_id === 'DPR0075');
  assert.equal(ship.entity_type, 'vessel');
  assert.equal(ship.primary_name, 'Petrel 8');
  assert.equal(ship.listed_on, '2017-10-03');
  const mukulu = uk.entries.find((e) => e.list_entry_id === 'DRC0041');
  assert.ok(mukulu.names.includes('Julius Elius Mashauri'));
});

test('UN parser: individuals + entities, reference numbers, aliases, quotes stripped', () => {
  assert.equal(un.publication_date, '2026-09-14');
  assert.equal(un.entries.length, 4);
  const kabir = un.entries.find((e) => e.list_entry_id === 'TAi.003');
  assert.equal(kabir.primary_name, 'ABDUL KABIR MOHAMMAD JAN');
  assert.equal(kabir.entity_type, 'individual');
  assert.deepEqual(kabir.programs, ['Taliban']);
  assert.equal(kabir.listed_on, '2001-01-25');
  assert.ok(kabir.names.includes('A. Kabir'));
  const komid = un.entries.find((e) => e.list_entry_id === 'KPe.001');
  assert.equal(komid.entity_type, 'entity');
  assert.ok(komid.names.includes('KOMID'));
  const adf = un.entries.find((e) => e.list_entry_id === 'CDe.001');
  assert.ok(adf.names.includes('Forces Démocratiques Alliées-Armée Nationale de Libération de l’Ouganda'));
});

test('latinName repairs stray Cyrillic look-alikes and drops non-Latin originals', () => {
  assert.equal(latinName('Ruslan Alexandrovich ROMASHK\u0406N'), 'Ruslan Alexandrovich ROMASHKIN');
  assert.equal(latinName('Руслан Александрович РОМАШКИН'), null);
  assert.equal(latinName('Organização Abu Nidal'), 'Organização Abu Nidal');
  assert.equal(latinName('Οργάνωση Abu Nidal'), null);
});

test('parsers raise schema_change on empty/unrecognised XML', () => {
  for (const p of [parseEuXml, parseUkXml, parseUnXml]) {
    assert.throws(() => p('<html><body>maintenance</body></html>'), (e) => e.failureClass === 'schema_change');
  }
});

test('xml helpers: exact tag blocks and entity decoding', () => {
  const xml = '<Designations><DesignationSource>x</DesignationSource><Designation><a/></Designation><Designation id="2">b</Designation></Designations>';
  assert.equal([...xmlBlocks(xml, 'Designation')].length, 2);
  assert.equal(decodeXml('Tom &amp; Jerry&apos;s &#233;&#xE9;'), "Tom & Jerry's éé");
});

test('cross-list screening: UN/EU/UK-listed entity found on every list', () => {
  const r = screenName('Allied Democratic Forces', index, 0.85);
  assert.equal(r.matched, true);
  assert.deepEqual(r.lists_matched, ['EU', 'UK', 'UN']);
  assert.equal(r.best_score, 1);
  assert.equal(r.matches[0].score, 1);
  const unHit = r.matches.find((m) => m.list === 'UN');
  assert.equal(unHit.list_entry_id, 'CDe.001');
  assert.equal(unHit.entity_type, 'entity');
  assert.deepEqual(unHit.program_list, ['DRC']);
  assert.equal(unHit.programs, 'DRC');
  assert.equal(unHit.listed_on, '2014-06-30');
  for (let i = 1; i < r.matches.length; i += 1) assert.ok(r.matches[i - 1].score >= r.matches[i].score);
});

test('diacritics: EU name matches with and without accents', () => {
  const withAccents = screenName('Qoussaï Saddam Hussein Al-Tikriti', index, 0.85);
  const without = screenName('Qoussai Saddam Hussein al Tikriti', index, 0.85);
  for (const r of [withAccents, without]) {
    assert.equal(r.matches[0].list, 'EU');
    assert.equal(r.matches[0].list_entry_id, 'EU.39.56');
    assert.equal(r.matches[0].score, 1);
    assert.equal(r.matches[0].matched_name, 'Qoussaï Saddam Hussein Al-Tikriti');
  }
  assert.equal(normalizeName('Organização Łódź Øresund Æther'), 'ORGANIZACAO LODZ ORESUND AETHER');
  const pt = screenName('Organizacao Abu Nidal', index, 0.85);
  assert.equal(pt.matches[0].list_entry_id, 'EU.3502.46');
});

test('UK vessel and UN individual alias found; clean name stays clear across lists', () => {
  assert.equal(screenName('Tian Tai 36', index, 0.85).matches[0].entity_type, 'vessel');
  const mashauri = screenName('Julius Elius Mashauri', index, 0.85);
  assert.deepEqual(mashauri.lists_matched, ['UK', 'UN']);
  const clear = screenName('Wholesome Bakery of Vermont', index, 0.85);
  assert.equal(clear.matched, false);
  assert.equal(clear.match_count, 0);
  assert.equal(clear.best_score, null);
  assert.deepEqual(clear.lists_matched, []);
});

test('includeAliases=false screens primary names only (all lists)', () => {
  const primaryOnly = buildIndex(all, { includeAliases: false });
  assert.equal(screenName('Julius Elius Mashauri', primaryOnly, 0.85).matched, false);
  assert.equal(screenName('NATIONAL BANK OF CUBA', primaryOnly, 1).matched, false);
  assert.equal(screenName('Jamil Mukulu', primaryOnly, 0.85).match_count, 2);
});

test('matches are capped at 10 best across lists; match_count is uncapped', () => {
  const many = Array.from({ length: 15 }, (_, i) => ({
    list: LIST_IDS[i % 4], list_entry_id: `X${i}`, primary_name: `ACME HOLDINGS ${i}`, names: [`ACME HOLDINGS ${i}`],
    entity_type: 'entity', programs: [], listed_on: null,
  }));
  many.push({ list: 'UN', list_entry_id: 'EXACT', primary_name: 'ACME HOLDINGS', names: ['ACME HOLDINGS'], entity_type: 'entity', programs: [], listed_on: null });
  const r = screenName('Acme Holdings', many, 0.5);
  assert.equal(r.match_count, 16);
  assert.equal(r.matches.length, 10);
  assert.equal(r.matches[0].list_entry_id, 'EXACT');
});

test('lists input validation', () => {
  assert.deepEqual(listsFromInput(undefined), LIST_IDS);
  assert.deepEqual(listsFromInput([]), LIST_IDS);
  assert.deepEqual(listsFromInput(['un', 'OFAC_SDN']), ['OFAC_SDN', 'UN']);
  assert.deepEqual(listsFromInput('eu, uk'), ['EU', 'UK']);
  assert.deepEqual(listsFromInput(['OFAC', 'SDN', 'ofac-sdn']), ['OFAC_SDN']);
  assert.throws(() => listsFromInput(['OFAC_SDN', 'INTERPOL']), /Unknown list "INTERPOL"/);
  assert.throws(() => listsFromInput(42), /must be an array/);
});

test('list outcome decision: partial failure continues, all-failed throws/no charge', () => {
  const partial = decideListOutcomes([
    { list: 'OFAC_SDN', ok: true, entry_count: 18000, source_url: SDN_URL, publication_date: null },
    { list: 'EU', ok: false, source_url: EU_URL, failure_class: 'timeout', message: 'Timeout' },
    { list: 'UN', ok: true, entry_count: 1011, source_url: UN_URL, publication_date: '2026-09-14' },
  ]);
  assert.equal(partial.allFailed, false);
  assert.equal(partial.canCharge, true);
  assert.deepEqual(partial.screened, ['OFAC_SDN', 'UN']);
  assert.deepEqual(partial.unavailable, ['EU']);
  assert.deepEqual(partial.failures, [{ list: 'EU', failure_class: 'timeout', message: 'Timeout' }]);
  assert.deepEqual(partial.lists_info[1], { list: 'UN', entries: 1011, source_url: UN_URL, publication_date: '2026-09-14' });

  const none = decideListOutcomes([
    { list: 'EU', ok: false, failure_class: 'site_down' },
    { list: 'UK', ok: false },
  ]);
  assert.equal(none.allFailed, true);
  assert.equal(none.canCharge, false);
  assert.deepEqual(none.failures.map((f) => f.failure_class), ['site_down', 'unknown']);
});

test('record: source_url is best-match list URL, else first screened list URL', () => {
  const decision = decideListOutcomes([
    { list: 'OFAC_SDN', ok: true, entry_count: ofac.length, source_url: SDN_URL },
    { list: 'EU', ok: true, entry_count: 5, source_url: EU_URL, publication_date: '2026-08-05' },
    { list: 'UK', ok: false, failure_class: 'timeout' },
    { list: 'UN', ok: true, entry_count: 4, source_url: UN_URL, publication_date: '2026-09-14' },
  ]);
  const hit = buildRecord(screenName('Abu Nidal Organisation', index, 0.85), decision, '2026-09-15T00:00:00.000Z');
  assert.equal(hit.source_url, EU_URL);
  assert.deepEqual(hit.lists_screened, ['OFAC_SDN', 'EU', 'UN']);
  assert.deepEqual(hit.lists_unavailable, ['UK']);
  assert.equal(hit.lists_info.length, 3);
  const clear = buildRecord(screenName('Wholesome Bakery of Vermont', index, 0.85), decision, '2026-09-15T00:00:00.000Z');
  assert.equal(clear.source_url, SDN_URL);
  const ukOnly = decideListOutcomes([{ list: 'UK', ok: true, entry_count: 4, source_url: UK_URL }]);
  assert.equal(pickSourceUrl({ matches: [] }, ukOnly.lists_info), UK_URL);
});

test('backward compat: OFAC-only record keeps every legacy field and value type', () => {
  const ofacIndex = buildIndex(buildEntries(parseCsv(load('sdn_sample.csv', 'latin1')), parseCsv(load('alt_sample.csv', 'latin1'))));
  const decision = decideListOutcomes([{ list: 'OFAC_SDN', ok: true, entry_count: 12, source_url: SDN_URL }]);
  const rec = buildRecord(screenName('Banco Nacional de Cuba', ofacIndex, 0.85), decision, '2026-09-11T12:00:00.000Z');
  assert.equal(rec.query, 'Banco Nacional de Cuba');
  assert.equal(rec.matched, true);
  assert.equal(rec.match_count, 1);
  assert.equal(rec.top_match_name, 'BANCO NACIONAL DE CUBA');
  assert.equal(rec.top_match_score, 1);
  assert.equal(rec.source_url, SDN_URL);
  assert.equal(rec.list_publish_info, 'OFAC SDN list, 12 entries, downloaded 2026-09-11T12:00:00.000Z');
  assert.deepEqual(rec.matches[0], {
    uid: '306',
    sdn_name: 'BANCO NACIONAL DE CUBA',
    matched_name: 'BANCO NACIONAL DE CUBA',
    score: 1,
    type: 'unknown',
    programs: 'CUBA',
    list: 'OFAC_SDN',
    list_entry_id: '306',
    primary_name: 'BANCO NACIONAL DE CUBA',
    entity_type: 'entity',
    program_list: ['CUBA'],
    listed_on: null,
  });
  assert.deepEqual(rec.lists_screened, ['OFAC_SDN']);
  assert.deepEqual(rec.lists_matched, ['OFAC_SDN']);
  assert.equal(rec.best_score, 1);
  // Default prefill must still produce a match on the combined index (Apify daily auto-test).
  assert.equal(screenName('Banco Nacional de Cuba', index, 0.85).matches[0].list, 'OFAC_SDN');
});

test('publish info lists each screened list', () => {
  const s = publishInfo([
    { list: 'OFAC_SDN', entries: 10 },
    { list: 'UN', entries: 4, publication_date: '2026-09-14' },
  ], 'T');
  assert.equal(s, 'OFAC SDN list, 10 entries; UN Security Council consolidated list, 4 entries (published 2026-09-14), downloaded T');
});

test('parenthetical names are indexed as separate variants (UK list style)', async () => {
  const { parentheticalVariants, buildIndex, screenName } = await import('../src/transform.js');
  assert.deepEqual(
    parentheticalVariants('PJSC Sberbank (Public Joint-Stock Company Sberbank)'),
    ['PJSC Sberbank', 'Public Joint-Stock Company Sberbank'],
  );
  assert.deepEqual(parentheticalVariants('ACME (LTD)'), ['ACME']);
  assert.deepEqual(parentheticalVariants('No parentheses'), []);
  const entries = parseUkXml(load('uk_sample.xml')).entries;
  const adf = entries.find((e) => e.names.some((n) => n === 'ADF (Allied Democratic Forces)'));
  assert.ok(adf, 'fixture contains the parenthetical UK name');
  assert.ok(adf.names.includes('Allied Democratic Forces'));
  const r = screenName('Allied Democratic Forces', buildIndex(entries), 0.95);
  assert.equal(r.matched, true);
  assert.equal(r.best_score, 1);
});
