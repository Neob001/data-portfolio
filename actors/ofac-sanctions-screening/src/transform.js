// Pure logic for OFAC SDN screening: CSV parsing, entry building, and
// deterministic name matching. No I/O, no model.

export const SDN_URL = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
export const ALT_URL = 'https://www.treasury.gov/ofac/downloads/alt.csv';

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

/** SDN rows + ALT rows -> screening entries {uid, name, type, programs, aliases[]}. */
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

const STOP = new Set(['THE', 'OF', 'AND', 'CO', 'COMPANY', 'CORP', 'CORPORATION', 'LTD', 'LIMITED', 'LLC', 'INC', 'SA', 'JSC', 'OOO', 'GMBH']);

export function normalizeName(s) {
  return (s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function nameTokens(s) {
  return normalizeName(s).split(' ').filter((t) => t && !STOP.has(t));
}

/** Deterministic similarity in [0,1]: exact 1.0, else token overlap score. */
export function scoreNames(queryNorm, queryTokens, candidate) {
  const candNorm = normalizeName(candidate);
  if (!candNorm || queryTokens.length === 0) return 0;
  if (candNorm === queryNorm) return 1;
  const candTokens = nameTokens(candidate);
  if (candTokens.length === 0) return 0;
  const candSet = new Set(candTokens);
  let inter = 0;
  for (const t of new Set(queryTokens)) if (candSet.has(t)) inter += 1;
  const union = new Set([...queryTokens, ...candTokens]).size;
  const jaccard = inter / union;
  const containment = inter / Math.min(new Set(queryTokens).size, candSet.size);
  // Containment catches "IVAN PETROV" vs "PETROV, Ivan Ivanovich"; jaccard tempers it.
  return Math.round((0.6 * containment + 0.4 * jaccard) * 1000) / 1000;
}

/** Input minScore may be a percent (85) or fraction (0.85); normalize to 0..1. */
export function thresholdFromInput(v, fallback = 0.85) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n > 1 ? Math.min(n, 100) / 100 : n;
}

/** Screen one name against all entries -> flat result record. */
export function screenName(query, entries, minScore = 0.85, maxMatches = 10) {
  const queryNorm = normalizeName(query);
  const queryTokens = nameTokens(query);
  const hits = [];
  for (const e of entries) {
    let best = scoreNames(queryNorm, queryTokens, e.name);
    let matchedName = e.name;
    for (const a of e.aliases) {
      const s = scoreNames(queryNorm, queryTokens, a);
      if (s > best) { best = s; matchedName = a; }
    }
    if (best >= minScore) {
      hits.push({ uid: e.uid, sdn_name: e.name, matched_name: matchedName, score: best, type: e.type, programs: e.programs });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const top = hits.slice(0, maxMatches);
  return {
    query,
    matched: top.length > 0,
    match_count: hits.length,
    top_match_name: top[0]?.sdn_name ?? null,
    top_match_score: top[0]?.score ?? null,
    matches: top,
  };
}
