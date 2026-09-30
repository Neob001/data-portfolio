// Pure logic: input normalization + dedupe, DNS signal helpers, error classification, flat
// convenience fields, row assembly and the PPE charge decision. No network access here.

import { getDomain } from 'tldts';

export const EVENT_NAME = 'domain-analyzed';

export const ERROR_CODES = ['invalid_url', 'dns_not_found', 'timeout', 'http_error', 'blocked', 'tls_error', 'connection_error'];

// Declared dataset fields, in output order (kept in sync with .actor/actor.json by tests).
export const OUTPUT_FIELDS = [
  'url', 'final_url', 'domain', 'status_code', 'ok', 'error',
  'technologies', 'technology_names', 'categories',
  'cms', 'ecommerce_platform', 'analytics', 'tag_managers', 'cdn', 'hosting_or_paas',
  'javascript_frameworks', 'web_server', 'programming_languages', 'marketing_automation', 'payment_processors',
  'mail_provider', 'dns_provider', 'has_spf', 'has_dmarc', 'verification_tokens',
  'technology_count', 'source_url', 'fetched_at',
];

// ---------------------------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------------------------

const HOST_RX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/**
 * Domain or URL -> { url, host, key } or null.
 * "Shopify.com" -> https://shopify.com/ ; "http://x.com/a?b" keeps scheme and path.
 * key = host without a leading "www." (www and apex are the same site for dedupe).
 */
export function normalizeTarget(raw) {
  let s = String(raw ?? '').trim();
  if (!s || /\s/.test(s)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^[^:]+:\d+/.test(s)) return null; // mailto:, javascript:, ...
    s = `https://${s.replace(/^\/+/, '')}`;
  }
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase().replace(/\.$/, '');
  if (!HOST_RX.test(host) || /^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (!/[a-z]/.test(host.split('.').pop())) return null;
  u.hash = '';
  return { url: u.href, host, key: host.replace(/^www\./, '') };
}

/** Dedupe by normalized host (www-insensitive), keeping the first URL given for each host. */
export function dedupeTargets(list) {
  const valid = [];
  const invalid = [];
  const seen = new Set();
  for (const raw of Array.isArray(list) ? list : []) {
    const t = normalizeTarget(raw);
    if (!t) { if (String(raw ?? '').trim()) invalid.push(String(raw)); continue; }
    if (seen.has(t.key)) continue;
    seen.add(t.key);
    valid.push({ raw: String(raw).trim(), ...t });
  }
  return { valid, invalid };
}

/** Registrable domain for MX/NS/TXT lookups ("shop.example.co.uk" -> "example.co.uk"). */
export function registrableDomain(host) {
  const h = String(host || '').toLowerCase();
  return getDomain(h, { allowPrivateDomains: false }) || h.replace(/^www\./, '');
}

/** Case-insensitive category filter -> Set of canonical names (unknown names reported). */
export function sanitizeCategoriesFilter(filter, knownNames) {
  const byLower = new Map(knownNames.map((n) => [n.toLowerCase(), n]));
  const keep = new Set();
  const unknown = [];
  for (const f of Array.isArray(filter) ? filter : []) {
    const k = String(f ?? '').trim().toLowerCase();
    if (!k) continue;
    if (byLower.has(k)) keep.add(byLower.get(k)); else unknown.push(String(f));
  }
  return { keep: keep.size ? keep : null, unknown };
}

// ---------------------------------------------------------------------------------------------
// DNS helpers (copied from actors/dns-records-lookup/src/transform.js — pure, no import across actors)
// ---------------------------------------------------------------------------------------------

/** resolveTxt output (string[][]) or {error} -> joined strings. */
export function joinTxt(answer) {
  return Array.isArray(answer) ? answer.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks))) : [];
}

const MAIL_PROVIDERS = [
  ['Google Workspace', [/aspmx\.l\.google\.com$/, /\.googlemail\.com$/, /google\.com$/]],
  ['Microsoft 365', [/\.protection\.outlook\.com$/, /mail\.protection\.outlook\.com$/]],
  ['Zoho', [/\.zoho\.com$/, /\.zohomail\.com$/, /\.zoho\.eu$/]],
  ['Proton', [/\.protonmail\.ch$/, /\.proton\.me$/]],
  ['Fastmail', [/\.messagingengine\.com$/]],
  ['Mimecast', [/\.mimecast\.com$/]],
  ['Proofpoint', [/\.pphosted\.com$/, /\.ppe-hosted\.com$/]],
  ['Amazon SES', [/\.amazonses\.com$/, /inbound-smtp\..*\.amazonaws\.com$/]],
];

/** Detect a mail hosting provider from MX exchange hostnames. */
export function detectMailProvider(mxHosts) {
  const hosts = (mxHosts || []).map((h) => String(h).toLowerCase());
  for (const [name, patterns] of MAIL_PROVIDERS) {
    if (hosts.some((h) => patterns.some((rx) => rx.test(h)))) return name;
  }
  return null;
}

const DNS_PROVIDERS = [
  ['Cloudflare', [/\.ns\.cloudflare\.com$/]],
  ['AWS Route 53', [/awsdns-\d+\.(com|net|org|co\.uk)$/]],
  ['Google Cloud DNS', [/\.googledomains\.com$/, /^ns-cloud-.*\.googledomains\.com$/]],
  ['Azure DNS', [/\.azure-dns\.(com|net|org|info)$/]],
  ['GoDaddy', [/\.domaincontrol\.com$/]],
  ['Namecheap', [/\.registrar-servers\.com$/]],
  ['DigitalOcean', [/\.digitalocean\.com$/]],
  ['Vercel', [/\.vercel-dns\.com$/]],
  ['NS1', [/\.nsone\.net$/]],
];

/** Detect an authoritative DNS provider from NS hostnames. */
export function detectDnsProvider(nsHosts) {
  const hosts = (nsHosts || []).map((h) => String(h).toLowerCase());
  for (const [name, patterns] of DNS_PROVIDERS) {
    if (hosts.some((h) => patterns.some((rx) => rx.test(h)))) return name;
  }
  return null;
}

const VERIFICATION_PATTERNS = [
  ['google', /^google-site-verification=/i],
  ['microsoft', /^MS=/i],
  ['facebook', /^facebook-domain-verification=/i],
  ['atlassian', /^atlassian-domain-verification=/i],
  ['apple', /^apple-domain-verification=/i],
  ['stripe', /^stripe-verification=/i],
  ['docusign', /^docusign=/i],
  ['zoom', /^zoom-domain-verification=/i, /^zoom_verify_/i],
];

/** Detect known TXT-based domain-verification services, deduplicated, in a stable order. */
export function detectVerificationTokens(txtRecords) {
  const found = [];
  for (const rec of txtRecords || []) {
    const s = String(rec).trim();
    for (const [name, ...patterns] of VERIFICATION_PATTERNS) {
      if (patterns.some((rx) => rx.test(s)) && !found.includes(name)) found.push(name);
    }
  }
  return found;
}

/** NXDOMAIN on both NS and SOA of the registrable domain: the domain does not exist. */
export function isNxDomain(answers) {
  if (!answers) return false;
  return [answers.ns, answers.soa].every((r) => r && !Array.isArray(r) && r.error === 'ENOTFOUND');
}

// Our DNS mail-provider names -> the fingerprint technology that represents them.
const MAIL_PROVIDER_TECH = {
  'Google Workspace': 'Google Workspace',
  'Microsoft 365': 'Microsoft 365',
  Zoho: 'Zoho Mail',
  Proton: 'Proton Mail',
  'Amazon SES': 'Amazon SES',
};

const arr = (a) => (Array.isArray(a) ? a : []);

/**
 * Raw resolver answers { mx, txt, ns, soa, cname, dmarcTxt } (arrays, objects or {error})
 * -> { signals (Wappalyzer "dns" input), mail_provider, dns_provider, has_spf, has_dmarc, verification_tokens }.
 */
export function dnsSummary(answers) {
  if (!answers) {
    return { signals: {}, mail_provider: null, dns_provider: null, has_spf: null, has_dmarc: null, verification_tokens: [] };
  }
  const { mx, txt, ns, soa, cname, dmarcTxt } = answers;
  const mxHosts = arr(mx).map((m) => String(m.exchange ?? '')).filter(Boolean);
  const txtStrings = joinTxt(txt);
  const nsHosts = arr(ns).map(String);
  const soaValues = soa && !Array.isArray(soa) && !soa.error ? [Object.values(soa).join(' ')] : [];
  const signals = { mx: mxHosts, txt: txtStrings, ns: nsHosts, soa: soaValues, cname: arr(cname).map(String) };
  const answered = (a) => Array.isArray(a) || (a && !a.error) || (a && ['ENODATA', 'ENOTFOUND'].includes(a.error));
  return {
    signals,
    mail_provider: detectMailProvider(mxHosts),
    dns_provider: detectDnsProvider(nsHosts),
    has_spf: answered(txt) ? txtStrings.some((t) => /^v=spf1(\s|$)/i.test(t.trim())) : null,
    has_dmarc: answered(dmarcTxt) ? joinTxt(dmarcTxt).some((t) => /^v=DMARC1/i.test(t.trim())) : null,
    verification_tokens: detectVerificationTokens(txtStrings),
  };
}

/**
 * Merge the MX-derived mail provider into the technology list when the fingerprints did not
 * already report it. `lookupCategories(name)` returns the fingerprint's category names or null.
 */
export function mergeDnsTechnologies(technologies, dns, lookupCategories, evidence = null) {
  const out = [...technologies];
  const techName = dns?.mail_provider ? MAIL_PROVIDER_TECH[dns.mail_provider] : null;
  if (techName && !out.some((t) => t.name === techName)) {
    const categories = lookupCategories(techName);
    if (categories) {
      out.push({ name: techName, categories, version: null, confidence: 100 });
      evidence?.set(techName, new Set(['dns']));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------------------------

const TLS_CODE_RX = /^(CERT_|ERR_TLS_|ERR_SSL_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT|HOSTNAME_MISMATCH|ERR_OSSL)/;

/** Network-level failure -> error code. */
export function classifyFetchError(err) {
  if (!err) return 'connection_error';
  if (err.errorCode && ERROR_CODES.includes(err.errorCode)) return err.errorCode;
  const chain = [];
  for (let e = err, i = 0; e && i < 5; e = e.cause, i += 1) chain.push(e);
  const codes = chain.map((e) => String(e.code || ''));
  const names = chain.map((e) => String(e.name || ''));
  const msgs = chain.map((e) => String(e.message || '')).join(' | ');
  if (names.includes('TimeoutError') || names.includes('AbortError') || codes.some((c) => /TIMEOUT|ETIMEDOUT/.test(c))) return 'timeout';
  if (codes.some((c) => c === 'ENOTFOUND' || c === 'EAI_AGAIN' || c === 'EAI_NONAME' || c === 'EAI_NODATA')) return 'dns_not_found';
  if (codes.some((c) => TLS_CODE_RX.test(c)) || /certificate|ssl|tls/i.test(msgs)) return 'tls_error';
  return 'connection_error';
}

const CHALLENGE_MARKERS = [
  /<title>\s*Just a moment\.\.\.\s*<\/title>/i,
  /<title>\s*Attention Required! \| Cloudflare/i,
  /cf-chl-|challenge-platform/i,
  /captcha-delivery\.com/i, // DataDome
  /px-captcha|_pxCaptcha/i, // PerimeterX / HUMAN
  /_Incapsula_Resource|Incapsula incident ID/i,
  /<title>\s*Access Denied\s*<\/title>[\s\S]{0,2000}Reference\s*#/i, // Akamai
];

/** Is this response a bot-protection challenge rather than the site? */
export function isChallengePage(status, headers, html) {
  const h = (k) => (typeof headers?.get === 'function' ? headers.get(k) : headers?.[k]);
  if (String(h('cf-mitigated') || '').toLowerCase() === 'challenge') return true;
  if (status < 400 && status !== 202) return false;
  const head = String(html || '').slice(0, 20000);
  return CHALLENGE_MARKERS.some((rx) => rx.test(head));
}

/** Final HTTP response -> null (usable) or an error code. */
export function classifyResponse(status, headers, html) {
  if (isChallengePage(status, headers, html)) return 'blocked';
  if (status === 401 || status === 403 || status === 429) return 'blocked';
  if (status >= 400) return 'http_error';
  return null;
}

/** Worth one retry? (timeouts, connection resets, 429/5xx that are not bot challenges) */
export function isRetryable(error, status) {
  if (error === 'timeout' || error === 'connection_error') return true;
  if (error === 'http_error' && [500, 502, 503, 504].includes(status)) return true;
  return false;
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

const GENERIC_ECOMMERCE = new Set(['Cart Functionality']);

/**
 * Flat convenience columns from the (already sorted) technology list.
 * evidence: name -> Set("server" | "page" | "dns") from detectWithEvidence (null = treat every
 * technology as seen on the website). Website-level columns ignore DNS-only detections (a TXT
 * verification record says the organization uses a service, not that the site runs on it);
 * cdn / hosting_or_paas / web_server prefer server evidence (response headers) over page markup,
 * so a public library CDN in a <script src> does not beat the CDN actually serving the page.
 */
export function flatFields(techs, evidence = null) {
  const ev = (t) => (evidence ? evidence.get(t.name) || new Set(['dns']) : new Set(['server', 'page']));
  const web = (t) => ev(t).has('server') || ev(t).has('page');
  const server = (t) => ev(t).has('server');
  const inCats = (cats) => techs.filter((t) => t.categories.some((c) => cats.includes(c)));
  const names = (list) => list.map((t) => t.name);
  const infra = (cats, skip = () => false) => {
    const list = inCats(cats).filter((t) => !skip(t));
    return (list.find(server) || list.find(web))?.name ?? null;
  };
  const webServers = inCats(['Web servers']).filter(web);
  return {
    cms: inCats(['CMS']).find(web)?.name ?? null,
    ecommerce_platform: inCats(['Ecommerce']).find((t) => web(t) && !GENERIC_ECOMMERCE.has(t.name))?.name ?? null,
    analytics: names(inCats(['Analytics']).filter(web)),
    tag_managers: names(inCats(['Tag managers']).filter(web)),
    cdn: infra(['CDN']),
    hosting_or_paas: infra(['PaaS', 'Hosting', 'IaaS']),
    javascript_frameworks: names(inCats(['JavaScript frameworks']).filter(web)),
    web_server: infra(['Web servers'], (t) => t.categories.includes('Web frameworks') && webServers.some((w) => !w.categories.includes('Web frameworks')))
      ?? null,
    programming_languages: names(inCats(['Programming languages']).filter(web)),
    marketing_automation: names(inCats(['Marketing automation'])),
    payment_processors: names(inCats(['Payment processors'])),
  };
}

/** Keep only technologies in at least one of the wanted categories (null = keep all). */
export function filterTechnologies(techs, keep) {
  if (!keep) return techs;
  return techs.filter((t) => t.categories.some((c) => keep.has(c)));
}

/**
 * Assemble one output row (every declared field present, in OUTPUT_FIELDS order, before stamping).
 * techs = full detection list (flat fields use it, with `evidence` from detectWithEvidence);
 * keep = categories filter (null = all).
 */
export function buildRow({ url, finalUrl = null, domain = null, statusCode = null, error = null, techs = [], evidence = null, keep = null, dns = null }) {
  const listed = filterTechnologies(techs, keep);
  const d = dns || dnsSummary(null);
  return {
    url: String(url),
    final_url: finalUrl,
    domain,
    status_code: Number.isInteger(statusCode) ? statusCode : null,
    ok: error === null,
    error,
    technologies: listed,
    technology_names: listed.map((t) => t.name),
    categories: [...new Set(listed.flatMap((t) => t.categories))],
    ...flatFields(techs, evidence),
    mail_provider: d.mail_provider,
    dns_provider: d.dns_provider,
    has_spf: d.has_spf,
    has_dmarc: d.has_dmarc,
    verification_tokens: d.verification_tokens,
    technology_count: listed.length,
  };
}

/** PPE: charge once per URL that loaded (ok) and returned at least one technology. */
export function isChargeable(row) {
  return Boolean(row && row.ok === true && row.technology_count > 0);
}
