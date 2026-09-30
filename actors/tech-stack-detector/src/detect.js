// Pure technology-detection engine: compiles Wappalyzer-format fingerprints once and matches them
// against signals collected from one plain HTTP response (+ DNS). No network, no browser.
//
// Supported pattern types: headers, cookies, meta, scriptSrc, scripts (inline <script> text),
// html, text, url, dns (MX/TXT/NS/SOA/CNAME) and dom (CSS selectors: exists / text / attributes).
// Skipped (need a real browser): js, css, xhr, probe, robots, certIssuer, dom "properties".
//
// Pattern syntax: "regex\;version:\1\;confidence:50". Version templates support back references
// (\1) and the ternary form (\1?yes:no). implies/excludes/requires/requiresCategory are resolved
// the way the original Wappalyzer engine does (implies transitively, min() of confidences).
//
// Regex safety: the patterns are third-party data. Unbounded + and * are rewritten into bounded
// {1,250}/{0,250} quantifiers, patterns that fail to compile are dropped, every input is length
// capped per type, and a pattern that ever takes > SLOW_PATTERN_MS on one input is disabled for
// the rest of the run. The build script additionally drops patterns that are slow on adversarial
// strings before they are vendored.

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { load as loadHtml } from 'cheerio/lib/slim';

export const MAX_QUANTIFIER = 250;
export const SLOW_PATTERN_MS = 200;

/** Per-type input caps (characters). html keeps head + tail because trackers sit at both ends. */
export const LIMITS = {
  value: 4096, // one header / cookie / meta / dns value
  url: 2048,
  scriptSrc: 2048,
  scriptCount: 300,
  scriptLen: 65536,
  htmlHead: 768 * 1024,
  htmlTail: 256 * 1024,
  domHtml: 2 * 1024 * 1024,
  text: 256 * 1024,
  domElements: 25,
};

/** Rewrite unbounded quantifiers outside character classes: a+ -> a{1,250}, a* -> a{0,250}. */
export function boundQuantifiers(src) {
  let out = '';
  let inClass = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') { out += c + (src[i + 1] ?? ''); i += 1; continue; }
    if (inClass) { if (c === ']') inClass = false; out += c; continue; }
    if (c === '[') { inClass = true; out += c; continue; }
    if (c === '+') { out += `{1,${MAX_QUANTIFIER}}`; continue; }
    if (c === '*') { out += `{0,${MAX_QUANTIFIER}}`; continue; }
    out += c;
  }
  return out;
}

/**
 * An unanchored pattern starting with ".+X" / ".*X" (X a literal) matches exactly when ".X" / "X"
 * matches, but costs up to 250 steps per input position. Trim the prefix (a 700 KB page went from
 * 224 ms to < 1 ms for one such pattern).
 */
export function trimLeadingWildcard(src) {
  const m = /^\.([+*])\??(?=[A-Za-z0-9<"'_=:/-]|\\[./"'-])/.exec(src);
  if (!m) return src;
  return (m[1] === '+' ? '.' : '') + src.slice(m[0].length);
}

/** Compile one fingerprint regex source (case-insensitive, bounded). Returns null when invalid. */
export function compileRegex(source) {
  if (source === '') return null; // "exists" pattern: matches any value
  try {
    return new RegExp(boundQuantifiers(trimLeadingWildcard(source)), 'i');
  } catch {
    return undefined;
  }
}

/**
 * "regex\;version:\1\;confidence:50" -> { source, version, confidence }.
 * Numbers (rare in the data) are treated as their string form.
 */
export function parsePattern(raw) {
  const [source, ...attrs] = String(raw).split('\\;');
  const out = { source, version: '', confidence: 100 };
  for (const attr of attrs) {
    const i = attr.indexOf(':');
    if (i <= 0) continue;
    const key = attr.slice(0, i);
    const value = attr.slice(i + 1);
    if (key === 'version') out.version = value;
    else if (key === 'confidence') out.confidence = Number.parseInt(value, 10) || 0;
  }
  return out;
}

/**
 * Longest ASCII literal every match must contain (lowercased), or '' when none can be proven.
 * Only top-level literal runs count: groups, classes and optional chars break a run, and a
 * top-level alternation means no single literal is required. Used to skip whole-page regex
 * scans that cannot match.
 */
export function requiredLiteral(src) {
  let best = '';
  let run = '';
  let depth = 0;
  let inClass = false;
  const flush = () => { if (run.length > best.length) best = run; run = ''; };
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1] ?? '';
      i += 1;
      if (inClass || depth > 0) continue;
      if (/[.\/\-"'_:=<>()[\]{}?+*|\\ !#@%&,;~`]/.test(n)) run += n; else flush();
      continue;
    }
    if (inClass) { if (c === ']') inClass = false; continue; }
    if (c === '[') { flush(); inClass = true; continue; }
    if (c === '(') { flush(); depth += 1; continue; }
    if (c === ')') { depth -= 1; continue; }
    if (depth > 0) continue;
    if (c === '|') return '';
    if (c === '?' || c === '*' || c === '{') { run = run.slice(0, -1); flush(); if (c === '{') { while (i < src.length && src[i] !== '}') i += 1; } continue; }
    if (c === '+') { flush(); continue; }
    if (c === '.' || c === '^' || c === '$') { flush(); continue; }
    if (/[\x20-\x7e]/.test(c)) run += c; else flush();
  }
  flush();
  return best.toLowerCase();
}

/** Parse + compile. Returns null when the regex does not compile (pattern is dropped). */
export function compilePattern(raw) {
  const p = parsePattern(raw);
  const regex = compileRegex(p.source);
  if (regex === undefined) return null;
  const literal = regex ? requiredLiteral(p.source) : '';
  return { regex, version: p.version, confidence: p.confidence, disabled: false, literal: literal.length >= 3 ? literal : '', word: interiorWord(literal) };
}

/**
 * Longest alphanumeric word of a literal that is delimited by non-alphanumerics on both sides
 * inside the literal ("cdn.shopify.com" -> "shopify"). Such a word must occur as a whole word in
 * any text containing the literal, so a Set lookup can rule a page out without scanning it.
 */
export function interiorWord(literal) {
  let best = '';
  for (const m of String(literal).matchAll(/[a-z0-9]+/g)) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > 0 && end < literal.length && m[0].length > best.length) best = m[0];
  }
  return best;
}

/**
 * Resolve a version template against the value a pattern matched.
 * "\1" -> first group; "\1?UA:" -> "UA" when group 1 matched, else ""; groups longer than
 * 10 chars are ignored (usually hashes, not versions).
 */
export function resolveVersion(template, regex, value) {
  if (!template || !regex) return template && !/\\\d/.test(template) ? template : '';
  const m = regex.exec(value);
  if (!m) return '';
  let resolved = template;
  m.forEach((group, index) => {
    if (String(group).length > 10) return;
    const ternary = new RegExp(`\\\\${index}\\?([^:]+):(.*)$`).exec(resolved);
    if (ternary) resolved = resolved.replace(ternary[0], group ? ternary[1] : ternary[2]);
    resolved = resolved.trim().replace(new RegExp(`\\\\${index}`, 'g'), group || '');
  });
  return resolved.replace(/\\\d/g, '').trim();
}

const toArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Strip "name\;confidence:50" style suffixes for implies/excludes/requires lists. */
function parseRef(raw) {
  const p = parsePattern(raw);
  return { name: p.source, confidence: p.confidence, version: p.version };
}

function compileKeyed(obj, stats, lowerKeys = true) {
  const out = {};
  for (const [key, patterns] of Object.entries(obj || {})) {
    const list = [];
    for (const raw of toArray(patterns)) {
      const p = compilePattern(raw);
      if (p) list.push(p); else stats.droppedPatterns += 1;
    }
    if (list.length) out[lowerKeys ? key.toLowerCase() : key] = list;
    stats.compiledPatterns += list.length;
  }
  return out;
}

function compileList(arr, stats) {
  const list = [];
  for (const raw of toArray(arr)) {
    const p = compilePattern(raw);
    if (p) list.push(p); else stats.droppedPatterns += 1;
  }
  stats.compiledPatterns += list.length;
  return list;
}

/**
 * What a selector needs from the document to possibly match, per comma-separated branch (any
 * branch may match): attribute names, ids, classes and attribute-value substrings. Checked
 * against a per-page attribute index so only a handful of the ~800 selectors ever reach the DOM
 * engine. Everything is lowercased (more permissive than the real match, never stricter).
 */
export function selectorRequirements(selector) {
  const branches = [];
  let depth = 0;
  let quote = null;
  let cur = '';
  for (const ch of String(selector)) {
    if (quote) { if (ch === quote) quote = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) { branches.push(cur); cur = ''; continue; }
    cur += ch;
  }
  branches.push(cur);
  return branches.map((b) => {
    const req = { attrs: [], ids: [], classes: [], values: [] };
    let s = b.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, ' ');
    s = s.replace(/\[\s*([\w:-]+)\s*(?:[~|^$*]?=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*(?:[isIS])?\s*\]/g, (_, name, dq, sq, bare) => {
      const attr = name.toLowerCase();
      const value = (dq ?? sq ?? bare ?? '').toLowerCase();
      if (value) req.values.push({ attr, value }); else req.attrs.push(attr);
      return ' ';
    });
    for (const m of s.matchAll(/#([\w-]+)/g)) req.ids.push(m[1].toLowerCase());
    for (const m of s.matchAll(/\.([\w-]+)/g)) req.classes.push(m[1].toLowerCase());
    return req;
  });
}

function compileDom(dom, stats) {
  if (!dom) return [];
  let obj = dom;
  if (typeof dom === 'string' || Array.isArray(dom)) {
    obj = {};
    for (const sel of toArray(dom)) obj[sel] = { exists: '' };
  }
  const out = [];
  for (const [selector, spec] of Object.entries(obj)) {
    if (!spec || typeof spec !== 'object') continue;
    const entry = { selector, branches: selectorRequirements(selector), exists: null, text: null, attributes: null };
    if ('exists' in spec) entry.exists = compilePattern(spec.exists ?? '');
    if ('text' in spec) entry.text = compilePattern(spec.text ?? '');
    if (spec.attributes && typeof spec.attributes === 'object') {
      entry.attributes = compileKeyed(spec.attributes, stats, false);
    }
    // "properties" need a live DOM with JavaScript state: not evaluable statically.
    if (entry.exists || entry.text || (entry.attributes && Object.keys(entry.attributes).length)) {
      out.push(entry);
      stats.compiledPatterns += (entry.exists ? 1 : 0) + (entry.text ? 1 : 0);
    }
  }
  return out;
}

const STATIC_TYPES = ['headers', 'cookies', 'meta', 'scriptSrc', 'scripts', 'html', 'text', 'url', 'dns', 'dom'];

/**
 * Compile the vendored fingerprint data once.
 * data = { categories: {id: {name, priority}}, technologies: {name: {...}} }
 */
export function compileFingerprints(data) {
  const stats = { technologies: 0, staticDetectable: 0, compiledPatterns: 0, droppedPatterns: 0 };
  const categories = new Map();
  for (const [id, c] of Object.entries(data.categories || {})) {
    categories.set(Number(id), { id: Number(id), name: c.name, priority: c.priority ?? 5 });
  }
  const techs = new Map();
  for (const [name, t] of Object.entries(data.technologies || {})) {
    const tech = {
      name,
      cats: toArray(t.cats).map(Number).filter((id) => categories.has(id)),
      headers: compileKeyed(t.headers, stats),
      cookies: compileKeyed(t.cookies, stats),
      meta: compileKeyed(t.meta, stats),
      dns: compileKeyed(t.dns, stats),
      scriptSrc: compileList(t.scriptSrc, stats),
      scripts: compileList(t.scripts, stats),
      html: compileList(t.html, stats),
      text: compileList(t.text, stats),
      url: compileList(t.url, stats),
      dom: compileDom(t.dom, stats),
      implies: toArray(t.implies).map(parseRef),
      excludes: toArray(t.excludes).map((r) => parseRef(r).name),
      requires: toArray(t.requires).map((r) => parseRef(r).name),
      requiresCategory: toArray(t.requiresCategory).map((r) => Number(parseRef(r).name)),
    };
    // Cookie names may carry a trailing/embedded "*" wildcard (e.g. GA4 "_ga_*").
    tech.cookieGlobs = Object.keys(tech.cookies)
      .filter((k) => k.includes('*'))
      .map((k) => ({ key: k, rx: new RegExp(`^${k.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`) }));
    tech.detectable = STATIC_TYPES.some((type) => (Array.isArray(tech[type]) ? tech[type].length : Object.keys(tech[type]).length) > 0);
    techs.set(name, tech);
    stats.technologies += 1;
    if (tech.detectable) stats.staticDetectable += 1;
  }
  // Drop references to technologies that do not exist in this snapshot.
  for (const tech of techs.values()) {
    tech.implies = tech.implies.filter((r) => techs.has(r.name) && r.name !== tech.name);
    tech.excludes = tech.excludes.filter((n) => techs.has(n) && n !== tech.name);
    tech.requires = tech.requires.filter((n) => techs.has(n));
  }
  const all = [...techs.values()];
  return {
    techs,
    categories,
    base: all.filter((t) => t.requires.length === 0 && t.requiresCategory.length === 0 && t.detectable),
    dependents: all.filter((t) => (t.requires.length > 0 || t.requiresCategory.length > 0) && t.detectable),
    stats,
    slowPatterns: 0,
  };
}

let cachedEngine = null;
/** Load and compile the vendored fingerprint file (cached per process). */
export function loadEngine(file = new URL('../fingerprints/technologies.json.gz', import.meta.url)) {
  if (cachedEngine && file.toString() === cachedEngine.file) return cachedEngine.engine;
  const data = JSON.parse(gunzipSync(readFileSync(file)).toString('utf8'));
  const engine = compileFingerprints(data);
  engine.source = data.source || null;
  cachedEngine = { file: file.toString(), engine };
  return engine;
}

// ---------------------------------------------------------------------------------------------
// Signal extraction
// ---------------------------------------------------------------------------------------------

const cap = (s, n) => (s.length > n ? s.slice(0, n) : s);

/** Keep head + tail of a long HTML document (trackers live near </body>, generators in <head>). */
export function capHtml(html) {
  const s = String(html ?? '');
  if (s.length <= LIMITS.htmlHead + LIMITS.htmlTail) return s;
  return `${s.slice(0, LIMITS.htmlHead)}\n${s.slice(-LIMITS.htmlTail)}`;
}

/** Set-Cookie header lines -> { lowercased name: [value] }. */
export function parseSetCookies(lines) {
  const out = {};
  for (const line of toArray(lines)) {
    const first = String(line).split(';')[0];
    const eq = first.indexOf('=');
    const name = (eq === -1 ? first : first.slice(0, eq)).trim().toLowerCase();
    if (!name) continue;
    (out[name] ||= []).push(cap(eq === -1 ? '' : first.slice(eq + 1).trim(), LIMITS.value));
  }
  return out;
}

/** Headers as a plain object / Headers / [[k,v]] -> { lowercased name: [values] } (no set-cookie). */
export function normalizeHeaders(headers) {
  const out = {};
  const entries = headers && typeof headers.entries === 'function' && !Array.isArray(headers)
    ? [...headers.entries()]
    : Array.isArray(headers) ? headers : Object.entries(headers || {});
  for (const [k, v] of entries) {
    const key = String(k).toLowerCase();
    if (key === 'set-cookie') continue;
    for (const val of toArray(v)) (out[key] ||= []).push(cap(String(val), LIMITS.value));
  }
  return out;
}

function absolutize(src, base) {
  try { return new URL(src, base).href; } catch { return src; }
}

/**
 * Collect every statically available signal from one HTTP response.
 * { url, headers, setCookies: string[], html, dns: {mx,txt,ns,soa,cname} } -> signals
 */
export function extractSignals({ url = '', headers = {}, setCookies = [], html = '', dns = null }) {
  const body = String(html ?? '');
  const signals = {
    url: cap(String(url), LIMITS.url),
    headers: normalizeHeaders(headers),
    cookies: parseSetCookies(setCookies),
    meta: {},
    scriptSrc: [],
    scripts: [],
    html: capHtml(body),
    htmlLower: '',
    htmlWords: null, // lazily built Set of alphanumeric words in htmlLower
    attrIndex: null, // { names, ids, classes, values: attr -> [values], joined: cache } (DOM pre-filter)
    text: '',
    dns: {},
    $: null,
  };
  for (const [k, vals] of Object.entries(dns || {})) {
    signals.dns[k.toLowerCase()] = toArray(vals).map((v) => cap(String(v), LIMITS.value));
  }
  if (!body) return signals;
  signals.htmlLower = signals.html.toLowerCase();

  const domSource = body.length > LIMITS.domHtml ? capHtml(body) : body;
  let $;
  try { $ = loadHtml(domSource); } catch { return signals; }
  signals.$ = $;
  signals.attrIndex = buildAttrIndex($);

  $('meta').each((_, el) => {
    const key = (el.attribs?.name || el.attribs?.property || '').toLowerCase().trim();
    const content = el.attribs?.content;
    if (key && content !== undefined) (signals.meta[key] ||= []).push(cap(String(content), LIMITS.value));
  });
  $('script').each((_, el) => {
    const src = el.attribs?.src;
    if (src) {
      if (!src.startsWith('data:') && signals.scriptSrc.length < LIMITS.scriptCount) {
        signals.scriptSrc.push(cap(absolutize(src.trim(), url), LIMITS.scriptSrc));
      }
    } else if (signals.scripts.length < LIMITS.scriptCount) {
      const txt = $(el).text();
      if (txt.trim()) signals.scripts.push(cap(txt, LIMITS.scriptLen));
    }
  });
  const bodyEl = $('body');
  if (bodyEl.length) {
    // Text of the visible body, without script/style contents (done on a detached clone).
    const clone = bodyEl.first().clone();
    clone.find('script,style,noscript,template').remove();
    signals.text = cap(clone.text().replace(/\s+/g, ' ').trim(), LIMITS.text);
  }
  return signals;
}

// ---------------------------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------------------------

function test(engine, p, value, hits, tech, via) {
  if (p.disabled) return;
  if (p.regex === null) { hits.push({ tech, via, confidence: p.confidence, version: resolveVersion(p.version, null, value) }); return; }
  const t0 = performance.now();
  const matched = p.regex.test(value);
  const dt = performance.now() - t0;
  if (dt > SLOW_PATTERN_MS) { p.disabled = true; engine.slowPatterns += 1; }
  if (matched) hits.push({ tech, via, confidence: p.confidence, version: p.version ? resolveVersion(p.version, p.regex, value) : '' });
}

function matchKeyed(engine, tech, type, items, hits, globs = []) {
  const patterns = tech[type];
  for (const [key, list] of Object.entries(patterns)) {
    let values = items[key];
    if (!values && globs.length) {
      const g = globs.find((x) => x.key === key);
      if (g) values = Object.entries(items).filter(([k]) => g.rx.test(k)).flatMap(([, v]) => v);
    }
    if (!values || !values.length) continue;
    for (const p of list) for (const v of values) test(engine, p, v, hits, tech, `${type}:${key}`);
  }
}

function matchList(engine, tech, type, values, hits) {
  for (const p of tech[type]) for (const v of values) test(engine, p, v, hits, tech, type);
}

/** Whole-page html patterns: skip the regex when its required literal is provably absent. */
function matchHtml(engine, tech, signals, hits) {
  if (!signals.html) return;
  for (const p of tech.html) {
    if (p.word) {
      signals.htmlWords ||= new Set(signals.htmlLower.match(/[a-z0-9]+/g) || []);
      if (!signals.htmlWords.has(p.word)) continue;
    } else if (p.literal && !signals.htmlLower.includes(p.literal)) continue;
    test(engine, p, signals.html, hits, tech, 'html');
  }
}

/** Attribute names, ids, classes and values of every element (lowercased), built once per page. */
export function buildAttrIndex($) {
  const idx = { names: new Set(), ids: new Set(), classes: new Set(), values: new Map(), joined: new Map() };
  $('*').each((_, el) => {
    for (const [k, v] of Object.entries(el.attribs || {})) {
      const name = k.toLowerCase();
      const value = String(v).toLowerCase();
      idx.names.add(name);
      let list = idx.values.get(name);
      if (!list) { list = []; idx.values.set(name, list); }
      list.push(value);
      if (name === 'id') idx.ids.add(value.trim());
      else if (name === 'class') for (const c of value.split(/\s+/)) if (c) idx.classes.add(c);
    }
  });
  return idx;
}

function valuesOf(idx, attr) {
  let s = idx.joined.get(attr);
  if (s === undefined) { s = (idx.values.get(attr) || []).join('\n'); idx.joined.set(attr, s); }
  return s;
}

/** Can this selector possibly match? (necessary condition, cheap) */
export function domCandidate(entry, idx) {
  if (!idx) return false;
  return entry.branches.some((r) => r.attrs.every((a) => idx.names.has(a))
    && r.ids.every((id) => idx.ids.has(id))
    && r.classes.every((c) => idx.classes.has(c))
    && r.values.every(({ attr, value }) => valuesOf(idx, attr).includes(value)));
}

function matchDom(engine, tech, signals, hits) {
  const { $ } = signals;
  if (!$) return;
  for (const entry of tech.dom) {
    if (entry.bad || !domCandidate(entry, signals.attrIndex)) continue;
    let els;
    try { els = $(entry.selector); } catch { entry.bad = true; continue; }
    if (!els.length) continue;
    const list = els.slice(0, LIMITS.domElements);
    const via = `dom:${entry.selector}`;
    if (entry.exists) hits.push({ tech, via, confidence: entry.exists.confidence, version: resolveVersion(entry.exists.version, null, '') });
    if (entry.text) list.each((_, el) => test(engine, entry.text, cap($(el).text(), LIMITS.value), hits, tech, via));
    if (entry.attributes) {
      for (const [attr, patterns] of Object.entries(entry.attributes)) {
        list.each((_, el) => {
          const v = el.attribs?.[attr] ?? el.attribs?.[attr.toLowerCase()];
          if (v === undefined) return;
          for (const p of patterns) test(engine, p, cap(String(v), LIMITS.value), hits, tech, via);
        });
      }
    }
  }
}

/** Raw pattern hits ({ tech, via: "type:key", confidence, version }) for a list of technologies. */
export function analyze(engine, signals, techs) {
  const hits = [];
  const urlList = signals.url ? [signals.url] : [];
  const textList = signals.text ? [signals.text] : [];
  for (const tech of techs) {
    matchKeyed(engine, tech, 'headers', signals.headers, hits);
    matchKeyed(engine, tech, 'cookies', signals.cookies, hits, tech.cookieGlobs);
    matchKeyed(engine, tech, 'meta', signals.meta, hits);
    matchKeyed(engine, tech, 'dns', signals.dns, hits);
    matchList(engine, tech, 'scriptSrc', signals.scriptSrc, hits);
    matchList(engine, tech, 'scripts', signals.scripts, hits);
    matchHtml(engine, tech, signals, hits);
    matchList(engine, tech, 'text', textList, hits);
    matchList(engine, tech, 'url', urlList, hits);
    if (tech.dom.length) matchDom(engine, tech, signals, hits);
  }
  return hits;
}

/** Longest plausible version wins (<= 15 chars, not a timestamp-like number). */
function betterVersion(current, candidate) {
  if (!candidate) return current;
  if (candidate.length > current.length && candidate.length <= 15 && (Number.parseInt(candidate, 10) || 0) < 10000) return candidate;
  return current;
}

/** Evidence class of a hit: "server" (headers/cookies/url), "page" (markup/scripts/dom), "dns". */
export function evidenceOf(via) {
  const type = String(via || '').split(':')[0];
  if (type === 'dns') return 'dns';
  if (type === 'headers' || type === 'cookies' || type === 'url') return 'server';
  return 'page';
}

/**
 * Pattern hits -> resolved technologies: confidences summed per technology (max 100), best version,
 * then excludes, then implies (transitively; implied confidence = min(parent, implies-confidence);
 * an implied technology inherits its parent's evidence classes).
 */
export function resolve(engine, hits) {
  const byName = new Map();
  for (const { tech, confidence, version, via } of hits) {
    const r = byName.get(tech.name) || { tech, confidence: 0, version: '', implied: false, evidence: new Set() };
    r.confidence = Math.min(100, r.confidence + confidence);
    r.version = betterVersion(r.version, version);
    r.evidence.add(evidenceOf(via));
    byName.set(tech.name, r);
  }
  const list = [...byName.values()];
  // excludes (sequential, like the reference engine: an already-removed tech excludes nothing)
  for (let i = 0; i < list.length; i += 1) {
    for (const ex of list[i].tech.excludes) {
      const idx = list.findIndex((r) => r.tech.name === ex);
      if (idx !== -1) { list.splice(idx, 1); if (idx < i) i -= 1; }
    }
  }
  // implies, transitively
  for (let i = 0; i < list.length; i += 1) {
    const parent = list[i];
    for (const imp of parent.tech.implies) {
      const existing = list.find((r) => r.tech.name === imp.name);
      if (existing) {
        if (existing.implied) for (const e of parent.evidence) existing.evidence.add(e);
        continue;
      }
      list.push({
        tech: engine.techs.get(imp.name),
        confidence: Math.min(parent.confidence, imp.confidence),
        version: imp.version && !/\\\d/.test(imp.version) ? imp.version : '',
        implied: true,
        evidence: new Set(parent.evidence),
      });
    }
  }
  return list;
}

function categoryPriority(engine, tech) {
  return tech.cats.reduce((min, id) => Math.min(min, engine.categories.get(id)?.priority ?? 9), 9);
}

const dnsOnly = (r) => !r.evidence.has('server') && !r.evidence.has('page');

/**
 * Resolved list -> { technologies, evidence } where technologies are output objects sorted by
 * confidence, website evidence before DNS-only, category priority, direct before implied, name;
 * evidence maps name -> Set of "server" | "page" | "dns" (used for the flat convenience fields).
 */
export function toOutput(engine, resolved) {
  const sorted = resolved
    .filter((r) => r.confidence > 0)
    .sort((a, b) => b.confidence - a.confidence
      || Number(dnsOnly(a)) - Number(dnsOnly(b))
      || categoryPriority(engine, a.tech) - categoryPriority(engine, b.tech)
      || Number(a.implied) - Number(b.implied)
      || a.tech.name.localeCompare(b.tech.name));
  return {
    technologies: sorted.map((r) => ({
      name: r.tech.name,
      categories: r.tech.cats.map((id) => engine.categories.get(id).name),
      version: r.version || null,
      confidence: r.confidence,
    })),
    evidence: new Map(sorted.map((r) => [r.tech.name, r.evidence])),
  };
}

/**
 * Full detection for one page: base technologies, then technologies that require an
 * already-detected technology or category, then excludes/implies over everything.
 * -> { technologies, evidence }
 */
export function detectWithEvidence(engine, signals) {
  const hits = analyze(engine, signals, engine.base);
  const first = resolve(engine, hits);
  const names = new Set(first.map((r) => r.tech.name));
  const cats = new Set(first.flatMap((r) => r.tech.cats));
  const deps = engine.dependents.filter((t) => t.requires.some((n) => names.has(n)) || t.requiresCategory.some((id) => cats.has(id)));
  const all = deps.length ? resolve(engine, hits.concat(analyze(engine, signals, deps))) : first;
  return toOutput(engine, all);
}

/** Technologies only (see detectWithEvidence). */
export function detect(engine, signals) {
  return detectWithEvidence(engine, signals).technologies;
}
