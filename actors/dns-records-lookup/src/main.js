import { Actor } from 'apify';
import { Resolver } from 'node:dns/promises';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { normalizeDomain, sanitizeRecordTypes, isNxDomain, isAllTransientFailure, assemble, isChargeable } from './transform.js';

const RESOLVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];
const CONCURRENCY = 10;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { domains = [], recordTypes, stripWww = false } = input;

if (!Array.isArray(domains) || domains.length === 0) {
  throw new Error('Provide "domains": domain names, website URLs or email addresses.');
}

const wantedTypes = sanitizeRecordTypes(recordTypes);

const resolver = new Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(RESOLVERS);

// Transient resolver failures are retried; definitive answers (ENODATA/ENOTFOUND) are returned as data.
const TRANSIENT = new Set(['ETIMEOUT', 'ESERVFAIL', 'ECONNREFUSED', 'EREFUSED']);
async function q(fn) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await fn(); } catch (e) {
      if (!TRANSIENT.has(e.code) || attempt === 2) return { error: e.code || 'ERROR' };
      await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
    }
  }
  return { error: 'ERROR' };
}

// A, NS, SOA, MX, apex TXT and _dmarc TXT are always fetched: they drive existence
// checks and the derived hints (mail_provider, dns_provider, has_spf, has_dmarc,
// verification_tokens) regardless of which record types the caller asked to see.
// AAAA, CNAME and CAA are only fetched when requested, to save queries.
async function lookup(domain) {
  const want = new Set(wantedTypes);
  const [a, ns, soa, mx, txt, dmarcTxt, aaaa, cname, caa] = await Promise.all([
    q(() => resolver.resolve4(domain)),
    q(() => resolver.resolveNs(domain)),
    q(() => resolver.resolveSoa(domain)),
    q(() => resolver.resolveMx(domain)),
    q(() => resolver.resolveTxt(domain)),
    q(() => resolver.resolveTxt(`_dmarc.${domain}`)),
    want.has('AAAA') ? q(() => resolver.resolve6(domain)) : Promise.resolve(null),
    want.has('CNAME') ? q(() => resolver.resolveCname(domain)) : Promise.resolve(null),
    want.has('CAA') ? q(() => resolver.resolveCaa(domain)) : Promise.resolve(null),
  ]);
  return { a, ns, soa, mx, txt, dmarcTxt, aaaa, cname, caa };
}

let pushed = 0;
let charged = 0;
let misses = 0;
let stop = false;
const seen = new Set();
const queue = [];
for (const raw of domains) {
  const d = normalizeDomain(raw, stripWww);
  if (!d) { queue.push({ raw, domain: null }); continue; }
  if (seen.has(d)) continue;
  seen.add(d);
  queue.push({ raw, domain: d });
}

async function worker() {
  while (queue.length > 0 && !stop) {
    const item = queue.shift();
    const { raw, domain } = item;
    const src = domain ? `dns:${domain}` : 'input';
    if (!domain) {
      await Actor.pushData(stamp({ query: String(raw), domain: null, found: false, reason: 'invalid_domain' }, src));
      misses += 1;
      continue;
    }
    const answers = await lookup(domain);
    if (isNxDomain(answers)) {
      await Actor.pushData(stamp({ query: String(raw), domain, found: false, reason: 'domain_does_not_exist' }, src));
      misses += 1;
      continue;
    }
    if (isAllTransientFailure(Object.values(answers))) {
      await Actor.pushData(stamp({ query: String(raw), domain, found: false, reason: 'dns_unreachable_retry_later' }, src));
      misses += 1;
      continue;
    }
    const record = assemble(domain, wantedTypes, answers);
    const out = { query: String(raw), domain, found: true, reason: null, ...record };
    await Actor.pushData(stamp(out, src));
    pushed += 1;
    // PPE: charge once per domain that exists AND delivered at least one requested record.
    if (isChargeable(out)) {
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'domain-resolved' });
      charged += 1;
      if (eventChargeLimitReached) stop = true;
    }
  }
}

try {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed + misses, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
