// Pure logic for multi-list sanctions screening (OFAC SDN, EU FSF, UK Sanctions
// List, UN SC Consolidated List): parsing, entry building, deterministic name
// matching and record building. No I/O, no model.

export const SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
export const ALT_URL = 'https://www.treasury.gov/ofac/downloads/alt.csv';
// Public token published by the European Commission on data.europa.eu and in the FSF RSS feed.
export const EU_URL = 'https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw';
export const UK_URL = 'https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.xml';
export const UN_URL = 'https://scsanctions.un.org/resources/xml/en/consolidated.xml';

export const LIST_IDS = ['OFAC_SDN', 'EU', 'UK', 'UN'];

export const LIST_SOURCES = {
  OFAC_SDN: { url: SDN_URL, label: 'OFAC SDN list' },
  EU: { url: EU_URL, label: 'EU consolidated financial sanctions list' },
  UK: { url: UK_URL, label: 'UK Sanctions List' },
  UN: { url: UN_URL, label: 'UN Security Council consolidated list' },
};

const LIST_ALIASES = {
  OFAC: 'OFAC_SDN', SDN: 'OFAC_SDN', OFAC_SDN: 'OFAC_SDN', US: 'OFAC_SDN',
  EU: 'EU', EU_FSF: 'EU', EUROPEAN_UNION: 'EU',
  UK: 'UK', UK_SANCTIONS_LIST: 'UK', FCDO: 'UK', OFSI: 'UK', GB: 'UK',
  UN: 'UN', UNSC: 'UN', UN_SC: 'UN', UNITED_NATIONS: 'UN',
};

/**
 * Input `lists` -> canonical list ids in canonical order. Missing/empty means all
 * four. Accepts an array or a comma-separated string, case-insensitive.
 * Throws (no downloads, no charges) on unknown values.
 */
export function listsFromInput(v) {
  if (v === undefined || v === null || v === '') return [...LIST_IDS];
  let arr;
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') arr = v.split(',');
  else throw new Error('"lists" must be an array of list ids: OFAC_SDN, EU, UK, UN.');
  const picked = new Set();
  for (const raw of arr) {
    const key = String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
    if (!key) continue;
    const id = LIST_ALIASES[key];
    if (!id) throw new Error(`Unknown list "${raw}" in "lists". Allowed values: ${LIST_IDS.join(', ')}.`);
    picked.add(id);
  }
  if (picked.size === 0) return [...LIST_IDS];
  return LIST_IDS.filter((id) => picked.has(id));
}

// ---------------------------------------------------------------------------
// OFAC SDN CSV
// ---------------------------------------------------------------------------

/** Minimal CSV parser handling quoted fields with embedded commas/quotes. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field.trim()); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field.trim()); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

const NULLISH = new Set(['-0-', '-0', '', 'null']);
const clean = (v) => (v === undefined || NULLISH.has(String(v).trim()) ? null : String(v).trim());

/** SDN rows + ALT rows -> legacy OFAC entries {uid, name, type, programs, aliases[]}. */
export function buildEntries(sdnRows, altRows) {
  if (!Array.isArray(sdnRows) || sdnRows.length === 0) {
    const e = new Error('SDN list empty or unreadable');
    e.failureClass = 'schema_change';
    throw e;
  }
  const aliasesByUid = new Map();
  for (const r of altRows || []) {
    const uid = clean(r[0]);
    const altName = clean(r[3]);
    if (!uid || !altName) continue;
    if (!aliasesByUid.has(uid)) aliasesByUid.set(uid, []);
    aliasesByUid.get(uid).push(altName);
  }
  const entries = [];
  for (const r of sdnRows) {
    const uid = clean(r[0]);
    const name = clean(r[1]);
    if (!uid || !name) continue;
    entries.push({
      uid,
      name,
      type: clean(r[2]) || 'unknown',
      programs: clean(r[3]),
      aliases: aliasesByUid.get(uid) || [],
    });
  }
  return entries;
}

const OFAC_TYPES = new Set(['individual', 'vessel', 'aircraft']);

/** Legacy OFAC entry -> unified entry shape. Idempotent for unified entries. */
export function toUnifiedEntry(e) {
  if (e && e.list) return e;
  const t = String(e.type || '').toLowerCase();
  const programsText = e.programs ?? null;
  return {
    list: 'OFAC_SDN',
    list_entry_id: e.uid,
    primary_name: e.name,
    names: dedupeNames([e.name, ...(e.aliases || [])]),
    entity_type: OFAC_TYPES.has(t) ? t : 'entity',
    programs: programsText ? programsText.split(/\]\s*\[/).map((p) => p.replace(/[[\]]/g, '').trim()).filter(Boolean) : [],
    programs_text: programsText,
    legacy_type: e.type || 'unknown',
    listed_on: null,
  };
}

export function ofacEntries(sdnRows, altRows) {
  return buildEntries(sdnRows, altRows).map(toUnifiedEntry);
}

// ---------------------------------------------------------------------------
// Tiny XML helpers (regex/indexOf, no deps). Lists are flat and well-formed.
// ---------------------------------------------------------------------------

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s) {
  if (s === undefined || s === null) return null;
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => {
    if (g[0] === '#') {
      const cp = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return XML_ENTITIES[g.toLowerCase()] ?? m;
  });
}

// Copy a substring so it does not pin the multi-MB source text in memory (V8 sliced strings).
const own = (s) => (s === null || s === undefined ? s : (` ${s}`).slice(1));

const cleanText = (s) => {
  if (s === null || s === undefined) return null;
  const t = decodeXml(s).replace(/\s+/g, ' ').trim();
  return t ? own(t) : null;
};

/** Yield each complete `<tag ...>...</tag>` block (exact tag name, not prefixes). */
export function* xmlBlocks(text, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let pos = 0;
  for (;;) {
    const i = text.indexOf(open, pos);
    if (i < 0) return;
    const next = text[i + open.length];
    if (next !== '>' && next !== ' ' && next !== '\n' && next !== '\t' && next !== '\r' && next !== '/') {
      pos = i + open.length;
      continue;
    }
    const gt = text.indexOf('>', i);
    if (gt < 0) return;
    if (text[gt - 1] === '/') { pos = gt + 1; continue; } // self-closing, no content
    const j = text.indexOf(close, gt);
    if (j < 0) return;
    yield text.slice(i, j + close.length);
    pos = j + close.length;
  }
}

/** Inner text of every `<tag>` in block (exact tag name). */
export function xmlTexts(block, tag) {
  const out = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  let m;
  while ((m = re.exec(block))) {
    const v = cleanText(m[1]);
    if (v) out.push(v);
  }
  return out;
}

export const xmlText = (block, tag) => xmlTexts(block, tag)[0] ?? null;

/** Opening tags `<tag attr=...>` (exact name) -> array of attribute maps. */
export function xmlTagAttrs(block, tag) {
  const out = [];
  const re = new RegExp(`<${tag}\\s([^>]*?)/?>`, 'g');
  let m;
  while ((m = re.exec(block))) {
    const attrs = {};
    const ar = /([A-Za-z_:][\w:.-]*)="([^"]*)"/g;
    let a;
    while ((a = ar.exec(m[1]))) attrs[a[1]] = a[2];
    out.push(attrs);
  }
  return out;
}

// Latin-script names only: non-Latin originals normalize to nothing useful.
const LATIN_ONLY = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\p{Zs}\p{M}]+$/u;
export const isLatinName = (s) => typeof s === 'string' && /[A-Za-z0-9]/.test(s) && LATIN_ONLY.test(s);

// Cyrillic/Greek letters that look identical to Latin ones (source typos like "ROMASHKІN").
const HOMOGLYPHS = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I', Ј: 'J', Ѕ: 'S',
  а: 'a', е: 'e', о: 'o', р: 'p', с: 'c', х: 'x', у: 'y', і: 'i', ј: 'j', ѕ: 's',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X', ο: 'o',
};

/**
 * Latin-script name as-is; a mostly-Latin name (>= 80% Latin letters) with stray
 * Cyrillic/Greek look-alike letters repaired; otherwise null (non-Latin original).
 */
export function latinName(s) {
  if (typeof s !== 'string' || !s) return null;
  if (isLatinName(s)) return s;
  const letters = s.match(/\p{L}/gu) || [];
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  if (letters.length === 0 || latin / letters.length < 0.8) return null;
  const fixed = s.replace(/[\u0370-\u03ff\u0400-\u04ff]/g, (c) => HOMOGLYPHS[c] ?? c);
  return isLatinName(fixed) ? fixed : null;
}

function dedupeNames(names) {
  const seen = new Set();
  const out = [];
  for (const n of names) {
    if (!n) continue;
    const k = normalizeName(n);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(n);
  }
  return out;
}

/** dd/mm/yyyy or yyyy-mm-dd[Thh:mm...] -> yyyy-mm-dd (the source's own calendar day). */
const isoDay = (v) => {
  if (!v) return null;
  const s = String(v).trim();
  const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  const ymd = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return ymd ? ymd[1] : null;
};

function schemaError(msg) {
  const e = new Error(msg);
  e.failureClass = 'schema_change';
  return e;
}

// ---------------------------------------------------------------------------
// EU Financial Sanctions Files (FSF) XML 1.1
// ---------------------------------------------------------------------------

const EU_TYPES = { person: 'individual', enterprise: 'entity' };

export function parseEuXml(text) {
  const root = xmlTagAttrs(text.slice(0, 2000), 'export')[0] || {};
  const entries = [];
  for (const block of xmlBlocks(text, 'sanctionEntity')) {
    const head = xmlTagAttrs(block.slice(0, block.indexOf('>') + 1), 'sanctionEntity')[0] || {};
    const aliases = xmlTagAttrs(block, 'nameAlias')
      .map((a) => ({ name: latinName(cleanText(a.wholeName)), lang: (a.nameLanguage || '').toUpperCase(), last: (a.lastName || '').trim() }))
      .filter((a) => a.name);
    if (aliases.length === 0) continue;
    const pref = aliases.filter((a) => a.lang === '' || a.lang === 'EN');
    const primary = (pref.find((a) => a.last) || pref[0] || aliases[0]).name;
    const regs = xmlTagAttrs(block, 'regulation');
    const programs = [...new Set(regs.map((r) => (r.programme || '').trim()).filter(Boolean))];
    const regDates = regs.map((r) => isoDay(r.publicationDate)).filter(Boolean).sort();
    const subject = xmlTagAttrs(block, 'subjectType')[0] || {};
    entries.push({
      list: 'EU',
      list_entry_id: own(head.euReferenceNumber || head.logicalId || '') || null,
      primary_name: primary,
      names: dedupeNames([primary, ...aliases.map((a) => a.name)]),
      entity_type: EU_TYPES[subject.code] ?? null,
      programs,
      listed_on: isoDay(head.designationDate) || regDates[0] || null,
    });
  }
  if (entries.length === 0) throw schemaError('EU sanctions XML contained no sanctionEntity records');
  return { entries, publication_date: isoDay(root.generationDate) };
}

// ---------------------------------------------------------------------------
// UK Sanctions List (FCDO) XML
// ---------------------------------------------------------------------------

const UK_TYPES = { individual: 'individual', entity: 'entity', ship: 'vessel' };

export function parseUkXml(text) {
  const entries = [];
  for (const block of xmlBlocks(text, 'Designation')) {
    const id = xmlText(block, 'UniqueID');
    let primary = null;
    const names = [];
    for (const nb of xmlBlocks(block, 'Name')) {
      const parts = ['Name1', 'Name2', 'Name3', 'Name4', 'Name5', 'Name6'].map((t) => xmlText(nb, t)).filter(Boolean);
      const full = latinName(cleanText(parts.join(' ')));
      if (!full) continue;
      const type = (xmlText(nb, 'NameType') || '').toLowerCase();
      if (!primary && type === 'primary name') primary = full;
      names.push(full);
    }
    for (const nl of xmlTexts(block, 'NameNonLatinScript')) if (isLatinName(nl)) names.push(nl);
    if (!primary) primary = names[0] ?? null;
    if (!id || !primary) continue;
    const kind = (xmlText(block, 'IndividualEntityShip') || '').toLowerCase();
    entries.push({
      list: 'UK',
      list_entry_id: id,
      primary_name: primary,
      names: dedupeNames([primary, ...names]),
      entity_type: UK_TYPES[kind] ?? null,
      programs: [...new Set(xmlTexts(block, 'RegimeName'))],
      listed_on: isoDay(xmlText(block, 'DateDesignated')),
    });
  }
  if (entries.length === 0) throw schemaError('UK Sanctions List XML contained no Designation records');
  return { entries, publication_date: isoDay(xmlText(text.slice(0, 2000), 'DateGenerated')) };
}

// ---------------------------------------------------------------------------
// UN Security Council Consolidated List XML
// ---------------------------------------------------------------------------

export function parseUnXml(text) {
  const root = xmlTagAttrs(text.slice(0, 2000), 'CONSOLIDATED_LIST')[0] || {};
  const entries = [];
  for (const [tag, aliasTag, type] of [['INDIVIDUAL', 'INDIVIDUAL_ALIAS', 'individual'], ['ENTITY', 'ENTITY_ALIAS', 'entity']]) {
    for (const block of xmlBlocks(text, tag)) {
      const primary = latinName(cleanText(['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME'].map((t) => xmlText(block, t)).filter(Boolean).join(' ')));
      const id = xmlText(block, 'REFERENCE_NUMBER') || xmlText(block, 'DATAID');
      if (!primary || !id) continue;
      const aliases = [];
      for (const ab of xmlBlocks(block, aliasTag)) {
        const a = latinName(xmlText(ab, 'ALIAS_NAME'));
        if (a) aliases.push(own(a.replace(/^["']+|["']+$/g, '').trim()));
      }
      entries.push({
        list: 'UN',
        list_entry_id: id,
        primary_name: primary,
        names: dedupeNames([primary, ...aliases]),
        entity_type: type,
        programs: [...new Set(xmlTexts(block, 'UN_LIST_TYPE'))],
        listed_on: isoDay(xmlText(block, 'LISTED_ON')),
      });
    }
  }
  if (entries.length === 0) throw schemaError('UN consolidated XML contained no INDIVIDUAL/ENTITY records');
  return { entries, publication_date: isoDay(root.dateGenerated) };
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

const STOP = new Set(['THE', 'OF', 'AND', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'LTD', 'LIMITED', 'LLC', 'INC', 'SA', 'JSC', 'OOO', 'GMBH']);

// Letters that NFD does not decompose into base + combining mark.
const FOLD = { Ø: 'O', Æ: 'AE', Œ: 'OE', Ł: 'L', Đ: 'D', Ð: 'D', Þ: 'TH', Ħ: 'H', Ŧ: 'T', ẞ: 'SS', Ŋ: 'N', Ə: 'E' };

export function normalizeName(s) {
  return (s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ØÆŒŁĐÐÞĦŦẞŊƏ]/g, (c) => FOLD[c])
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(s) {
  return normalizeName(s).split(' ').filter((t) => t && !STOP.has(t));
}

function scoreTokens(queryNorm, querySet, queryTokens, candNorm, candTokens) {
  if (!candNorm || querySet.size === 0) return 0;
  if (candNorm === queryNorm) return 1;
  if (candTokens.length === 0) return 0;
  const candSet = new Set(candTokens);
  let inter = 0;
  for (const t of querySet) if (candSet.has(t)) inter += 1;
  const union = new Set([...queryTokens, ...candTokens]).size;
  const jaccard = inter / union;
  const containment = inter / Math.min(querySet.size, candSet.size);
  // Containment catches "IVAN PETROV" vs "PETROV, Ivan Ivanovich"; jaccard tempers it.
  return Math.round((0.6 * containment + 0.4 * jaccard) * 1000) / 1000;
}

/** Deterministic similarity in [0,1]: exact 1.0, else token overlap score. */
export function scoreNames(queryNorm, queryTokens, candidate) {
  const candNorm = normalizeName(candidate);
  return scoreTokens(queryNorm, new Set(queryTokens), queryTokens, candNorm, nameTokens(candidate));
}

/** Input minScore may be a percent (85) or fraction (0.85); normalize to 0..1. */
export function thresholdFromInput(v, fallback = 0.85) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n > 1 ? Math.min(n, 100) / 100 : n;
}

/**
 * Pre-normalized inverted index over every candidate name. Only candidates that
 * share at least one token can score > 0, so results equal a full scan.
 */
export function buildIndex(entries, { includeAliases = true } = {}) {
  const unified = (entries || []).map(toUnifiedEntry);
  const candEntry = [];
  const candName = [];
  const candNorm = [];
  const candTokens = [];
  const tokenMap = new Map();
  unified.forEach((e, ei) => {
    const names = includeAliases ? e.names : e.names.slice(0, 1);
    for (const n of names) {
      const norm = normalizeName(n);
      if (!norm) continue;
      const toks = norm.split(' ').filter((t) => t && !STOP.has(t));
      const ci = candEntry.length;
      candEntry.push(ei); candName.push(n); candNorm.push(norm); candTokens.push(toks);
      for (const t of new Set(toks)) {
        let list = tokenMap.get(t);
        if (!list) { list = []; tokenMap.set(t, list); }
        list.push(ci);
      }
    }
  });
  return { __index: true, entries: unified, candEntry, candName, candNorm, candTokens, tokenMap, seen: new Int32Array(candEntry.length), stamp: 0 };
}

const indexCache = new WeakMap();
function indexFor(entriesOrIndex) {
  if (entriesOrIndex && entriesOrIndex.__index) return entriesOrIndex;
  let idx = indexCache.get(entriesOrIndex);
  if (!idx) { idx = buildIndex(entriesOrIndex); indexCache.set(entriesOrIndex, idx); }
  return idx;
}

/** Screen one name against entries (array or buildIndex result) -> flat result record. */
export function screenName(query, entries, minScore = 0.85, maxMatches = 10) {
  const idx = indexFor(entries);
  const queryNorm = normalizeName(query);
  const queryTokens = nameTokens(query);
  const querySet = new Set(queryTokens);
  idx.stamp += 1;
  if (idx.stamp > 2e9) { idx.seen.fill(0); idx.stamp = 1; }
  const best = new Map(); // entry index -> {score, ci}
  for (const t of querySet) {
    const posting = idx.tokenMap.get(t);
    if (!posting) continue;
    for (const ci of posting) {
      if (idx.seen[ci] === idx.stamp) continue;
      idx.seen[ci] = idx.stamp;
      const s = scoreTokens(queryNorm, querySet, queryTokens, idx.candNorm[ci], idx.candTokens[ci]);
      if (s < minScore) continue;
      const ei = idx.candEntry[ci];
      const cur = best.get(ei);
      if (!cur || s > cur.score || (s === cur.score && ci < cur.ci)) best.set(ei, { score: s, ci });
    }
  }
  const hits = [...best.entries()]
    .sort((a, b) => b[1].score - a[1].score || a[0] - b[0])
    .map(([ei, { score, ci }]) => {
      const e = idx.entries[ei];
      return {
        uid: e.list_entry_id,
        sdn_name: e.primary_name,
        matched_name: idx.candName[ci],
        score,
        type: e.legacy_type ?? e.entity_type ?? 'unknown',
        programs: e.programs_text ?? (e.programs.length ? e.programs.join('; ') : null),
        list: e.list,
        list_entry_id: e.list_entry_id,
        primary_name: e.primary_name,
        entity_type: e.entity_type,
        program_list: e.programs,
        listed_on: e.listed_on,
      };
    });
  const top = hits.slice(0, maxMatches);
  return {
    query,
    matched: top.length > 0,
    match_count: hits.length,
    top_match_name: top[0]?.sdn_name ?? null,
    top_match_score: top[0]?.score ?? null,
    best_score: top[0]?.score ?? null,
    lists_matched: LIST_IDS.filter((id) => hits.some((h) => h.list === id)),
    matches: top,
  };
}

// ---------------------------------------------------------------------------
// Run decisions and record building
// ---------------------------------------------------------------------------

/**
 * outcomes: [{list, ok, entry_count?, source_url, publication_date?, failure_class?, message?}]
 * -> which lists were screened, which are unavailable, and whether the run must fail.
 * Charging is allowed only when at least one list was screened.
 */
export function decideListOutcomes(outcomes) {
  const screened = (outcomes || []).filter((o) => o && o.ok);
  const failed = (outcomes || []).filter((o) => o && !o.ok);
  return {
    screened: screened.map((o) => o.list),
    unavailable: failed.map((o) => o.list),
    allFailed: screened.length === 0,
    canCharge: screened.length > 0,
    failures: failed.map((o) => ({ list: o.list, failure_class: o.failure_class || 'unknown', message: o.message || null })),
    lists_info: screened.map((o) => ({
      list: o.list,
      entries: o.entry_count ?? 0,
      source_url: o.source_url ?? LIST_SOURCES[o.list]?.url ?? null,
      publication_date: o.publication_date ?? null,
    })),
  };
}

export function publishInfo(listsInfo, downloadedAt) {
  const parts = listsInfo.map((l) => `${LIST_SOURCES[l.list]?.label ?? l.list}, ${l.entries} entries${l.publication_date ? ` (published ${l.publication_date})` : ''}`);
  return `${parts.join('; ')}, downloaded ${downloadedAt}`;
}

/**
 * source_url: the list URL of the best match when there is a match, otherwise the
 * first screened list's URL (OFAC SDN when it was selected).
 */
export function pickSourceUrl(result, listsInfo) {
  const bestList = result?.matches?.[0]?.list;
  const hit = bestList && listsInfo.find((l) => l.list === bestList);
  return hit?.source_url ?? LIST_SOURCES[bestList]?.url ?? listsInfo[0]?.source_url ?? SDN_URL;
}

/** Screening result + run context -> dataset record (without fetched_at). */
export function buildRecord(result, decision, downloadedAt) {
  return {
    ...result,
    lists_screened: decision.screened,
    lists_unavailable: decision.unavailable,
    lists_info: decision.lists_info,
    list_publish_info: publishInfo(decision.lists_info, downloadedAt),
    source_url: pickSourceUrl(result, decision.lists_info),
  };
}
