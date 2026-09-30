// Network layer: one page over plain HTTP (manual redirects so cookies from every hop are kept,
// size-capped body, charset-aware decoding) and the DNS lookups used as detection signals.

import { Resolver } from 'node:dns/promises';

export const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
export const MAX_BODY_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 10;

const BROWSER_HEADERS = {
  'user-agent': USER_AGENT,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9',
  'upgrade-insecure-requests': '1',
};

const TEXTUAL = /html|xml|text\/plain|^$/i;

/** Charset from Content-Type, else from a <meta charset> in the first bytes, else utf-8. */
export function pickCharset(contentType, firstBytes) {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType || '');
  if (fromHeader) return fromHeader[1].toLowerCase();
  const head = Buffer.from(firstBytes || []).subarray(0, 2048).toString('latin1');
  const fromMeta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return fromMeta ? fromMeta[1].toLowerCase() : 'utf-8';
}

export function decodeBody(buf, contentType) {
  const charset = pickCharset(contentType, buf);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}

/** Read at most maxBytes of a response body, then cancel the stream. */
export async function readCapped(res, maxBytes = MAX_BODY_BYTES) {
  if (!res.body) return { buf: Buffer.alloc(0), truncated: false };
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = maxBytes - total;
    if (value.byteLength >= room) {
      chunks.push(Buffer.from(value.buffer, value.byteOffset, room));
      total += room;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    total += value.byteLength;
  }
  return { buf: Buffer.concat(chunks, total), truncated };
}

/**
 * GET a page following redirects manually.
 * -> { finalUrl, status, headers (final Headers), setCookies (all hops), html, truncated }
 * Throws on network errors (classified by transform.classifyFetchError).
 */
export async function fetchPage(url, { timeoutMs = 20000, maxBytes = MAX_BODY_BYTES, fetchImpl = fetch } = {}) {
  const signal = AbortSignal.timeout(timeoutMs);
  const setCookies = [];
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const res = await fetchImpl(current, { method: 'GET', headers: BROWSER_HEADERS, redirect: 'manual', signal });
    const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    setCookies.push(...cookies);
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location && hop < MAX_REDIRECTS) {
      await res.body?.cancel().catch(() => {});
      let next;
      try { next = new URL(location, current).href; } catch { next = null; }
      if (!next || !/^https?:/i.test(next)) {
        return { finalUrl: current, status: res.status, headers: res.headers, setCookies, html: '', truncated: false };
      }
      current = next;
      continue;
    }
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      throw Object.assign(new Error(`Too many redirects at ${url}`), { errorCode: 'http_error', status: res.status });
    }
    const contentType = res.headers.get('content-type') || '';
    let html = '';
    let truncated = false;
    if (TEXTUAL.test(contentType)) {
      const body = await readCapped(res, maxBytes);
      truncated = body.truncated;
      html = decodeBody(body.buf, contentType);
    } else {
      await res.body?.cancel().catch(() => {});
    }
    return { finalUrl: current, status: res.status, headers: res.headers, setCookies, html, truncated };
  }
  throw Object.assign(new Error(`Too many redirects at ${url}`), { errorCode: 'http_error' });
}

const TRANSIENT_DNS = new Set(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EREFUSED']);

export function createResolver(servers = ['1.1.1.1', '8.8.8.8']) {
  const resolver = new Resolver({ timeout: 3000, tries: 2 });
  resolver.setServers(servers);
  return resolver;
}

async function q(fn) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { return await fn(); } catch (e) {
      if (!TRANSIENT_DNS.has(e.code) || attempt === 1) return { error: e.code || 'ERROR' };
    }
  }
  return { error: 'ERROR' };
}

/** MX/TXT/NS/SOA on the registrable domain, _dmarc TXT, and CNAME on the fetched host. */
export async function lookupDns(resolver, { domain, host }) {
  const [mx, txt, ns, soa, dmarcTxt, cname] = await Promise.all([
    q(() => resolver.resolveMx(domain)),
    q(() => resolver.resolveTxt(domain)),
    q(() => resolver.resolveNs(domain)),
    q(() => resolver.resolveSoa(domain)),
    q(() => resolver.resolveTxt(`_dmarc.${domain}`)),
    q(() => resolver.resolveCname(host)),
  ]);
  return { mx, txt, ns, soa, dmarcTxt, cname };
}
