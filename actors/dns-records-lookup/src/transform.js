// Pure logic: normalize input, assemble a DNS record-lookup result from raw
// resolver answers, and decide what gets charged. Inputs are raw resolver
// results (or golden captures shaped just like them) so tests run without
// network access.

export const ALLOWED_RECORD_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'];
export const DEFAULT_RECORD_TYPES = [...ALLOWED_RECORD_TYPES];

// Resolver error codes that mean "try again later" rather than "definitive answer".
const TRANSIENT_CODES = ['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EREFUSED'];

const DOMAIN_RX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/;

/**
 * "https://mail.Example.com/path:8080" -> "mail.example.com".
 * Unlike an email-focused normalizer, subdomains are kept intact (DNS users
 * query hosts, not just registrable domains). Only scheme, path/query/port
 * and a trailing dot are stripped. A leading "www." is kept unless stripWww.
 */
export function normalizeDomain(raw, stripWww = false) {
  let s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@')) s = s.split('@').pop();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0];
  s = s.split(':')[0]; // strip a trailing port
  s = s.replace(/\.$/, '');
  if (stripWww) s = s.replace(/^www\./, '');
  return DOMAIN_RX.test(s) ? s : null;
}

/** Keep only recognized record types, de-duplicated, in ALLOWED_RECORD_TYPES order. */
export function sanitizeRecordTypes(recordTypes) {
  if (!Array.isArray(recordTypes) || recordTypes.length === 0) return [...DEFAULT_RECORD_TYPES];
  const requested = new Set(recordTypes.map((t) => String(t).trim().toUpperCase()));
  const kept = ALLOWED_RECORD_TYPES.filter((t) => requested.has(t));
  return kept.length > 0 ? kept : [...DEFAULT_RECORD_TYPES];
}

/** resolveTxt output (string[][]) or {error} -> joined strings. */
export function joinTxt(answer) {
  return Array.isArray(answer) ? answer.map((chunks) => (Array.isArray(chunks) ? chunks.join('') : String(chunks))) : [];
}

/** Mask mailbox local-parts (e.g. DMARC "rua=mailto:dmarc@x.com") as "***@domain". */
export function maskMailboxes(text) {
  return String(text ?? '').replace(/([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})/gi, '***@$2');
}

/** True when the resolver says the domain itself does not exist (NXDOMAIN). */
export function isNxDomain({ a, ns, soa }) {
  return [a, ns, soa].every((r) => r && !Array.isArray(r) && r.error === 'ENOTFOUND');
}

/** True when every DNS answer we actually queried came back as a transient failure. */
export function isAllTransientFailure(results) {
  const performed = results.filter((r) => r !== null && r !== undefined);
  if (performed.length === 0) return false;
  return performed.every((r) => r && !Array.isArray(r) && typeof r === 'object' && TRANSIENT_CODES.includes(r.error));
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

/** RFC 7505 null MX: a single record with an empty exchange ("0 ."), meaning the domain accepts no mail. */
export const isNullMx = (mxAnswer) => Array.isArray(mxAnswer) && mxAnswer.length === 1 && ['', '.'].includes(mxAnswer[0].exchange);

/** MX answer (array of {priority, exchange}) -> ["10 host", ...] sorted by priority; null MX -> []. */
export function formatMx(mxAnswer) {
  if (!Array.isArray(mxAnswer) || isNullMx(mxAnswer)) return [];
  return mxAnswer
    .slice()
    .sort((a, b) => a.priority - b.priority)
    .map((m) => `${m.priority} ${m.exchange}`);
}

/** CAA answer -> ['0 issue "letsencrypt.org"', ...]. */
export function formatCaa(caaAnswer) {
  if (!Array.isArray(caaAnswer)) return [];
  return caaAnswer.map((r) => {
    const tag = 'issue' in r ? 'issue' : 'issuewild' in r ? 'issuewild' : 'iodef';
    return `${r.critical ? 1 : 0} ${tag} "${r[tag]}"`;
  });
}

/** SOA answer -> flattened { soa_primary_ns, soa_serial, soa_minimum_ttl } (nulls if absent). */
export function formatSoa(soaAnswer) {
  if (!soaAnswer || Array.isArray(soaAnswer) || soaAnswer.error) {
    return { soa_primary_ns: null, soa_serial: null, soa_minimum_ttl: null };
  }
  return {
    soa_primary_ns: soaAnswer.nsname ?? null,
    soa_serial: typeof soaAnswer.serial === 'number' ? soaAnswer.serial : null,
    soa_minimum_ttl: typeof soaAnswer.minttl === 'number' ? soaAnswer.minttl : null,
  };
}

/** Plain resolver answer (array or {error}) -> string[] ("" and ENODATA both become []). */
function toArray(answer, mapFn = (x) => x) {
  return Array.isArray(answer) ? answer.map(mapFn) : [];
}

/**
 * Assemble the full output record for one domain from raw resolver answers.
 * `recordTypes` (sanitized, from ALLOWED_RECORD_TYPES) controls which fields are
 * populated; unrequested types are explicitly null. Derived hints (mail_provider,
 * dns_provider, has_spf, has_dmarc, verification_tokens) are always computed from
 * whatever apex/NS/MX/TXT data was fetched, independent of what was requested.
 */
export function assemble(domain, recordTypes, answers) {
  const want = new Set(recordTypes);
  const { a, aaaa, mx, txt, ns, cname, soa, caa, dmarcTxt } = answers;

  const txtStrings = joinTxt(txt).map(maskMailboxes);
  const mxFormatted = formatMx(mx);
  const nsHosts = toArray(ns);
  const soaFlat = formatSoa(soa);

  const record = {
    a: want.has('A') ? toArray(a) : null,
    aaaa: want.has('AAAA') ? toArray(aaaa) : null,
    mx: want.has('MX') ? mxFormatted : null,
    null_mx: isNullMx(mx),
    txt: want.has('TXT') ? txtStrings : null,
    ns: want.has('NS') ? nsHosts : null,
    cname: want.has('CNAME') ? (Array.isArray(cname) && cname.length > 0 ? cname[0] : null) : null,
    caa: want.has('CAA') ? formatCaa(caa) : null,
    ...(want.has('SOA') ? soaFlat : { soa_primary_ns: null, soa_serial: null, soa_minimum_ttl: null }),
    mail_provider: detectMailProvider(mx && !mx.error ? mx.map((m) => m.exchange) : []),
    dns_provider: detectDnsProvider(nsHosts),
    has_spf: txtStrings.some((t) => /^v=spf1(\s|$)/i.test(t.trim())),
    has_dmarc: joinTxt(dmarcTxt).some((t) => /^v=DMARC1/i.test(t.trim())),
    verification_tokens: detectVerificationTokens(txtStrings),
  };
  record.record_count = recordCount(record, recordTypes);
  return record;
}

/** Count populated records across only the requested record types. */
export function recordCount(record, recordTypes) {
  let n = 0;
  for (const t of recordTypes) {
    if (t === 'A') n += (record.a || []).length;
    else if (t === 'AAAA') n += (record.aaaa || []).length;
    else if (t === 'MX') n += (record.mx || []).length;
    else if (t === 'TXT') n += (record.txt || []).length;
    else if (t === 'NS') n += (record.ns || []).length;
    else if (t === 'CAA') n += (record.caa || []).length;
    else if (t === 'CNAME') n += record.cname ? 1 : 0;
    else if (t === 'SOA') n += record.soa_primary_ns ? 1 : 0;
  }
  return n;
}

/** PPE charge decision: only existing domains that delivered at least one requested record. */
export function isChargeable(record) {
  return Boolean(record && record.found === true && record.record_count > 0);
}
