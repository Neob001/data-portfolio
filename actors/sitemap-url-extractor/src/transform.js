// Pure logic: sitemap XML parsing (urlset + sitemapindex) without deps.
import { isoDate } from './lib/records.js';

/** Extract <loc>/<lastmod>/<changefreq>/<priority> entries from sitemap XML. */
export function parseSitemap(xml) {
  const text = String(xml || '');
  if (!/<(urlset|sitemapindex)[\s>]/i.test(text)) {
    const e = new Error('Not a sitemap: missing <urlset> or <sitemapindex> root');
    e.failureClass = 'schema_change';
    throw e;
  }
  const kind = /<sitemapindex[\s>]/i.test(text) ? 'index' : 'urlset';
  const entries = [];
  const blockRx = kind === 'index' ? /<sitemap>([\s\S]*?)<\/sitemap>/gi : /<url>([\s\S]*?)<\/url>/gi;
  let m;
  while ((m = blockRx.exec(text)) !== null) {
    const block = m[1];
    const tag = (name) => {
      const t = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
      return t ? t[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/, '$1').trim() : null;
    };
    const loc = tag('loc');
    if (!loc) continue;
    entries.push({
      loc: decodeXml(loc),
      lastmod: isoDate(tag('lastmod')),
      changefreq: tag('changefreq'),
      priority: tag('priority') !== null ? Number(tag('priority')) : null,
    });
  }
  return { kind, entries };
}

function decodeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/** Sitemap URLs listed in robots.txt. */
export function sitemapsFromRobots(robotsTxt) {
  const out = [];
  for (const line of String(robotsTxt || '').split(/\r?\n/)) {
    const m = line.match(/^\s*sitemap:\s*(\S+)\s*$/i);
    if (m) out.push(m[1]);
  }
  return out;
}

export const DEFAULT_SITEMAP_PATHS = ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml', '/wp-sitemap.xml'];
