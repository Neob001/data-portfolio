#!/usr/bin/env node
// Regenerates fingerprints/technologies.json.gz from the last MIT-licensed Wappalyzer release on
// npm (wappalyzer@6.10.54, published 2023-01-15; 6.10.55+ switched to GPL-3.0 and 7.x is empty).
// See FINGERPRINTS_LICENSE.md. Run from the actor dir:
//   node scripts_local/build_fingerprints.mjs            # downloads the pinned tarball
//   node scripts_local/build_fingerprints.mjs --from wappalyzer-6.10.54.tgz
//
// What it does: verifies the tarball checksum and its "license": "MIT" field, keeps only the
// fields the static detector can use, applies the documented local overrides below, drops regexes
// that do not compile or are slow on adversarial input, drops CSS selectors the DOM engine cannot
// parse, and writes a gzipped JSON file plus a small manifest.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { load as loadHtml } from 'cheerio/lib/slim';
import { compilePattern, parsePattern } from '../src/detect.js';

const PKG = 'wappalyzer';
const VERSION = '6.10.54';
const TARBALL = `https://registry.npmjs.org/${PKG}/-/${PKG}-${VERSION}.tgz`;
const SHA1 = 'de8e0f0386f66bc6ce858408de9faa477f304c5e';
const OUT_DIR = new URL('../fingerprints/', import.meta.url);

const KEEP = ['cats', 'headers', 'cookies', 'meta', 'scriptSrc', 'scripts', 'html', 'text', 'url', 'dns', 'dom', 'implies', 'excludes', 'requires', 'requiresCategory'];

// Local precision overrides (MIT permits modification). Each entry is documented in the README
// "Coverage" section; keep this list short and evidence-based (smoke-run false positives).
const OVERRIDES = {
  // NS records on Route 53 mean "DNS hosted on AWS", not "website hosted on AWS"; the original
  // rule reported every Route 53 customer (e.g. github.com) as hosted on AWS.
  'Amazon Web Services': (t) => { delete t.dns; return t; },
  // TXT "apple-domain" matches every apple-domain-verification token (Apple Business/Apple Pay),
  // which is not iCloud Mail. MX mail.icloud.com and SPF redirect=icloud.com stay.
  'Apple iCloud Mail': (t) => { t.dns.TXT = ['redirect=icloud\\.com']; return t; },
  // A Content-Security-Policy that allow-lists some S3 bucket is not evidence that S3 serves the
  // site (it made S3 the "CDN" of github.com, stripe.com, webflow.com). Server header + script URLs stay.
  'Amazon S3': (t) => { delete t.headers['Content-Security-Policy']; delete t.headers['Content-Security-Policy-Report-Only']; return t; },
  // Generic "any link to /checkout or class*=checkout" heuristics fired on non-store marketing pages
  // (stripe.com, shopify.com). Keep only the specific Google Trusted Stores script.
  'Cart Functionality': (t) => { delete t.dom; delete t.url; return t; },
  // "C" (implementation language of the web server) is noise in programming_languages.
  Nginx: (t) => dropImplies(t, 'C'),
  Angie: (t) => dropImplies(t, 'C'),
  H2O: (t) => dropImplies(t, 'C'),
};

function dropImplies(t, name) {
  if (t.implies) t.implies = [].concat(t.implies).filter((r) => r.split('\\;')[0] !== name);
  return t;
}

// ---------------------------------------------------------------------------------------------

function readTar(buf) {
  const files = new Map();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('utf8').replace(/\0.*$/s, '').trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    const full = prefix ? `${prefix}/${name}` : name;
    if (type === '0' || type === '\0') files.set(full, buf.subarray(off + 512, off + 512 + size));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}

const ADVERSARIAL = [
  'a'.repeat(20000),
  ' '.repeat(20000),
  '<'.repeat(20000),
  '<div class="a">'.repeat(2000),
  '<script src="/'.repeat(2000),
  `${'/'.repeat(10000)}${'.'.repeat(10000)}`,
  `${'-'.repeat(10000)}${'x'.repeat(10000)}!`,
  'aaaa.bbbb.'.repeat(2000),
  '"\'="\'='.repeat(4000),
  '0.1.2.3.'.repeat(3000),
  // Realistic-size page: catches patterns that are linear per position but with a 250x factor.
  '<div class="x" data-a="1"><a href="/p/q">text, more text</a></div>\n'.repeat(3000),
];

function isSlow(regex, budgetMs = 30) {
  for (const s of ADVERSARIAL) {
    const t0 = performance.now();
    regex.test(s);
    if (performance.now() - t0 > budgetMs) return true;
  }
  return false;
}

const toArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const dropped = { invalid: [], slow: [], selectors: [] };

function cleanList(name, type, list) {
  const out = [];
  for (const raw of toArray(list)) {
    const p = compilePattern(raw);
    if (!p) { dropped.invalid.push(`${name} ${type}: ${raw}`); continue; }
    if (p.regex && isSlow(p.regex)) { dropped.slow.push(`${name} ${type}: ${raw}`); continue; }
    out.push(raw);
  }
  return out;
}

function cleanKeyed(name, type, obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const list = cleanList(name, `${type}.${k}`, v);
    if (list.length) out[k] = list.length === 1 ? list[0] : list;
  }
  return Object.keys(out).length ? out : undefined;
}

const $empty = loadHtml('<html><body></body></html>');
function cleanDom(name, dom) {
  if (!dom) return undefined;
  let obj = dom;
  if (typeof dom === 'string' || Array.isArray(dom)) {
    obj = {};
    for (const sel of toArray(dom)) obj[sel] = { exists: '' };
  }
  const out = {};
  for (const [sel, spec] of Object.entries(obj)) {
    try { $empty(sel); } catch { dropped.selectors.push(`${name}: ${sel}`); continue; }
    const s = {};
    if ('exists' in spec) s.exists = spec.exists;
    if ('text' in spec) {
      const l = cleanList(name, 'dom.text', spec.text);
      if (l.length) s.text = l[0];
    }
    if (spec.attributes) {
      const a = cleanKeyed(name, 'dom.attributes', spec.attributes);
      if (a) s.attributes = a;
    }
    if (Object.keys(s).length) out[sel] = s;
  }
  return Object.keys(out).length ? out : undefined;
}

async function main() {
  const fromIdx = process.argv.indexOf('--from');
  let tgz;
  if (fromIdx !== -1) tgz = readFileSync(process.argv[fromIdx + 1]);
  else {
    const res = await fetch(TARBALL);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${TARBALL}`);
    tgz = Buffer.from(await res.arrayBuffer());
  }
  const sha1 = createHash('sha1').update(tgz).digest('hex');
  if (sha1 !== SHA1) throw new Error(`checksum mismatch: ${sha1} != ${SHA1}`);
  const files = readTar(gunzipSync(tgz));
  const pkg = JSON.parse(files.get('package/package.json').toString('utf8'));
  if (pkg.version !== VERSION || pkg.license !== 'MIT') throw new Error(`unexpected package ${pkg.version} ${pkg.license}`);

  const rawCats = JSON.parse(files.get('package/categories.json').toString('utf8'));
  const categories = {};
  for (const [id, c] of Object.entries(rawCats)) categories[id] = { name: c.name, priority: c.priority };

  const raw = {};
  for (const [path, buf] of files) {
    if (/^package\/technologies\/[^/]+\.json$/.test(path)) Object.assign(raw, JSON.parse(buf.toString('utf8')));
  }

  const technologies = {};
  for (const name of Object.keys(raw).sort((a, b) => a.localeCompare(b))) {
    let t = {};
    for (const k of KEEP) if (raw[name][k] !== undefined) t[k] = structuredClone(raw[name][k]);
    if (OVERRIDES[name]) t = OVERRIDES[name](t);
    for (const k of ['headers', 'cookies', 'meta', 'dns']) if (t[k]) t[k] = cleanKeyed(name, k, t[k]);
    for (const k of ['scriptSrc', 'scripts', 'html', 'text', 'url']) {
      if (t[k] !== undefined) {
        const l = cleanList(name, k, t[k]);
        t[k] = l.length === 0 ? undefined : l.length === 1 ? l[0] : l;
      }
    }
    if (t.dom) t.dom = cleanDom(name, t.dom);
    // implies/excludes/requires are names (with optional \;confidence) -> keep as-is but validated.
    for (const k of ['implies', 'excludes', 'requires']) {
      if (t[k] !== undefined) t[k] = toArray(t[k]).filter((r) => raw[parsePattern(r).source]);
    }
    for (const k of Object.keys(t)) if (t[k] === undefined || (Array.isArray(t[k]) && t[k].length === 0)) delete t[k];
    technologies[name] = t;
  }

  const data = {
    source: {
      package: `${PKG}@${VERSION}`,
      tarball: TARBALL,
      sha1: SHA1,
      license: 'MIT',
      copyright: 'Copyright 2008 Wappalyzer',
      modified: 'Stripped to static-detection fields; local overrides and pattern drops listed in manifest.json.',
    },
    categories,
    technologies,
  };
  mkdirSync(OUT_DIR, { recursive: true });
  const json = JSON.stringify(data);
  const gz = gzipSync(json, { level: 9 });
  writeFileSync(new URL('technologies.json.gz', OUT_DIR), gz);
  const manifest = {
    source: data.source,
    technologies: Object.keys(technologies).length,
    categories: Object.keys(categories).length,
    overrides: Object.keys(OVERRIDES),
    dropped_invalid_regex: dropped.invalid,
    dropped_slow_regex: dropped.slow,
    dropped_selectors: dropped.selectors,
    bytes_json: json.length,
    bytes_gz: gz.length,
  };
  writeFileSync(new URL('manifest.json', OUT_DIR), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`technologies=${manifest.technologies} categories=${manifest.categories} gz=${gz.length}B `
    + `invalid=${dropped.invalid.length} slow=${dropped.slow.length} selectors=${dropped.selectors.length}`);
}

await main();
