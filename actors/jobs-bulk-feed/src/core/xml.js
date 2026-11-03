// Minimal, dependency-free XML reader for the job feeds the core parses (Personio /xml, Teamtailor
// /jobs.rss). Pure and deterministic: well-formed XML -> element tree. Handles the XML declaration,
// comments, processing instructions, a DOCTYPE without an internal subset, CDATA sections, attributes,
// self-closing tags, namespaced names ("tt:location", kept as written) and the predefined + numeric
// entities. Anything else (unbalanced tags, text outside the root) throws, so a changed or broken feed
// surfaces as a schema_change instead of half-parsed jobs.
import { decodeEntities } from './text.js';

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>[]*>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)((?:\s+[A-Za-z_][\w.:-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)|(<)/g;
const ATTR = /([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

function xmlError(msg) {
  return Object.assign(new Error(`XML: ${msg}`), { failureClass: 'schema_change' });
}

/**
 * XML text -> root element { name, attrs, children: [element], text } where `text` is the element's
 * own character data (CDATA included, entities decoded, not trimmed).
 */
export function parseXml(xml) {
  const s = String(xml ?? '').replace(/^﻿/, '');
  const stack = [];
  let root = null;
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(s)) !== null) {
    const [, cdata, close, open, attrs, selfClose, text, stray] = m;
    const top = stack[stack.length - 1];
    if (stray !== undefined) throw xmlError(`unexpected "<" at ${m.index}`);
    if (cdata !== undefined) {
      if (!top) throw xmlError('CDATA outside the root element');
      top.text += cdata;
    } else if (text !== undefined) {
      if (top) top.text += decodeEntities(text);
      else if (text.trim()) throw xmlError('text outside the root element');
    } else if (open !== undefined) {
      const el = { name: open, attrs: {}, children: [], text: '' };
      if (attrs) for (const a of attrs.matchAll(ATTR)) el.attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
      if (top) top.children.push(el);
      else if (root) throw xmlError('more than one root element');
      else root = el;
      if (!selfClose) stack.push(el);
    } else if (close !== undefined) {
      if (!top || top.name !== close) throw xmlError(`unexpected </${close}>`);
      stack.pop();
    }
  }
  if (stack.length) throw xmlError(`unclosed <${stack[stack.length - 1].name}>`);
  if (!root) throw xmlError('no root element');
  return root;
}

// A name without a prefix also matches a prefixed element of that local name ("location" ~ "tt:location"), so a
// feed that renames its namespace prefix still parses.
const named = (name) => (name.includes(':') ? (c) => c.name === name : (c) => c.name === name || c.name.endsWith(`:${name}`));
/** First child element named `name` (or null). */
export const child = (el, name) => el?.children?.find(named(name)) || null;
/** All child elements named `name`. */
export const childrenOf = (el, name) => (el?.children || []).filter(named(name));
/** Trimmed text of the first child named `name` ('' when absent). */
export const textOf = (el, name) => (child(el, name)?.text || '').trim();
