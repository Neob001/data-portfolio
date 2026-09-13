// Pure transforms for the MediaWiki Action API and Wikidata responses.

export const LICENSE = 'CC BY-SA 4.0';
export const LICENSE_URL = 'https://creativecommons.org/licenses/by-sa/4.0/';

const LANG_RE = /^[a-z][a-z0-9-]{1,15}$/;

export function isValidLanguage(lang) {
  return LANG_RE.test(String(lang || ''));
}

/**
 * Article title or Wikipedia URL -> { lang, title } or null.
 * URLs carry their own language (de.wikipedia.org, de.m.wikipedia.org).
 */
export function parseArticleRef(raw, defaultLang = 'en') {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    const host = u.hostname.match(/^([a-z0-9-]+)(?:\.m)?\.wikipedia\.org$/i);
    if (!host) return null;
    let title = null;
    if (u.pathname.startsWith('/wiki/')) title = u.pathname.slice(6);
    else if (u.searchParams.get('title')) title = u.searchParams.get('title');
    if (!title) return null;
    try {
      title = decodeURIComponent(title);
    } catch {
      return null;
    }
    title = title.replace(/_/g, ' ').trim();
    return title ? { lang: host[1].toLowerCase(), title } : null;
  }
  if (s.length > 255 || /[#<>[\]{}|]/.test(s)) return null;
  return { lang: defaultLang, title: s.replace(/_/g, ' ') };
}

export function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

/** Search response -> ordered list of article titles. */
export function parseSearch(response) {
  const hits = response?.query?.search;
  if (!Array.isArray(hits)) {
    if (response?.error) {
      const e = new Error(`MediaWiki search error: ${response.error.code}`);
      e.failureClass = 'http_error';
      throw e;
    }
    const e = new Error('Unexpected MediaWiki search response: query.search missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  return hits.map((h) => h.title);
}

/**
 * Merge one page of a (possibly continued) query response into acc:
 * { pages: Map(key -> page), aliases: Map(requestedTitle -> finalTitle) }.
 * Array props (categories, revisions) are concatenated across continuations.
 */
export function mergeQueryResponse(acc, response) {
  const q = response?.query;
  if (!q || !Array.isArray(q.pages)) {
    const e = new Error('Unexpected MediaWiki query response: query.pages missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  for (const n of q.normalized || []) acc.aliases.set(n.from, n.to);
  for (const r of q.redirects || []) acc.aliases.set(r.from, r.to);
  for (const p of q.pages) {
    const key = p.title;
    const prev = acc.pages.get(key);
    if (!prev) {
      acc.pages.set(key, { ...p });
      continue;
    }
    for (const [k, v] of Object.entries(p)) {
      if (Array.isArray(v) && Array.isArray(prev[k])) prev[k] = prev[k].concat(v);
      else if (prev[k] === undefined) prev[k] = v;
    }
  }
  return acc;
}

/** Follow normalization + redirect chain (max 5 hops) to the final page. */
export function resolvePage(acc, title) {
  let t = title;
  for (let i = 0; i < 5 && acc.aliases.has(t); i++) t = acc.aliases.get(t);
  return acc.pages.get(t) || null;
}

/** wbgetclaims(P31) response -> true when the item is an instance of human (Q5). */
export function isHumanClaims(response) {
  const claims = response?.claims?.P31;
  if (!Array.isArray(claims)) return false;
  return claims.some((c) => c?.mainsnak?.datavalue?.value?.id === 'Q5');
}

/** Strip the localized namespace prefix: "Category:Physics" / "Kategorie:Physik" -> name. */
function categoryName(t) {
  const i = String(t).indexOf(':');
  return i >= 0 ? t.slice(i + 1) : t;
}

/** Final page object -> flat article record (without query / stamp). */
export function toArticleRecord(page, lang, fullText = null) {
  const rev = Array.isArray(page.revisions) ? page.revisions[0] : null;
  const coord = Array.isArray(page.coordinates) ? page.coordinates[0] : null;
  const url = page.canonicalurl || page.fullurl || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`;
  const summary = page.extract || null;
  const text = fullText ?? null;
  return {
    found: true,
    language: lang,
    page_id: page.pageid,
    title: page.title,
    description: page.description || null,
    summary,
    full_text: text,
    word_count: text ? text.split(/\s+/).filter(Boolean).length : null,
    is_disambiguation: page.pageprops ? 'disambiguation' in page.pageprops : false,
    categories: [...new Set((page.categories || []).map((c) => categoryName(c.title)))],
    wikidata_id: page.pageprops?.wikibase_item || null,
    thumbnail_url: page.thumbnail?.source || null,
    latitude: coord?.lat ?? null,
    longitude: coord?.lon ?? null,
    last_edited_at: rev?.timestamp || null,
    revision_id: rev?.revid ?? page.lastrevid ?? null,
    length_bytes: page.length ?? null,
    article_url: url,
    license: LICENSE,
    license_url: LICENSE_URL,
    attribution_url: `https://${lang}.wikipedia.org/w/index.php?curid=${page.pageid}&action=history`,
  };
}

/** Full-text extracts response -> plain text for the single page, or null. */
export function parseFullText(response) {
  const pages = response?.query?.pages;
  if (!Array.isArray(pages) || !pages[0]) return null;
  return pages[0].extract || null;
}
