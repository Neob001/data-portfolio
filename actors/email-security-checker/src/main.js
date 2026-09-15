import { Actor } from 'apify';
import { Resolver } from 'node:dns/promises';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { normalizeDomain, evaluate, isNxDomain, DKIM_SELECTORS } from './transform.js';

const RESOLVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];
const CONCURRENCY = 5;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { domains = [], extraDkimSelectors = [] } = input;

if (!Array.isArray(domains) || domains.length === 0) {
  throw new Error('Provide "domains": domain names, website URLs or email addresses.');
}

const resolver = new Resolver({ timeout: 4000, tries: 2 });
resolver.setServers(RESOLVERS);
const selectors = [...new Set([...DKIM_SELECTORS, ...extraDkimSelectors.map((s) => String(s).trim()).filter(Boolean)])];

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

async function lookup(domain) {
  const [mx, txt, dmarc, mtasts, tlsrpt, ...dkimAnswers] = await Promise.all([
    q(() => resolver.resolveMx(domain)),
    q(() => resolver.resolveTxt(domain)),
    q(() => resolver.resolveTxt(`_dmarc.${domain}`)),
    q(() => resolver.resolveTxt(`_mta-sts.${domain}`)),
    q(() => resolver.resolveTxt(`_smtp._tls.${domain}`)),
    ...selectors.map((s) => q(() => resolver.resolveTxt(`${s}._domainkey.${domain}`))),
  ]);
  return { mx, txt, dmarc, mtasts, tlsrpt, dkim: Object.fromEntries(selectors.map((s, i) => [s, dkimAnswers[i]])) };
}

let pushed = 0;
let charged = 0;
let misses = 0;
let stop = false;
const seen = new Set();
const queue = [];
for (const raw of domains) {
  const d = normalizeDomain(raw);
  if (!d) { queue.push({ raw, domain: null }); continue; }
  if (seen.has(d)) continue;
  seen.add(d);
  queue.push({ raw, domain: d });
}

async function worker() {
  while (queue.length > 0 && !stop) {
    const { raw, domain } = queue.shift();
    const src = domain ? `dns:${domain}` : 'input';
    if (!domain) {
      await Actor.pushData(stamp({ query: String(raw), found: false, reason: 'invalid_domain' }, src));
      misses += 1;
      continue;
    }
    const answers = await lookup(domain);
    if (isNxDomain(answers)) {
      await Actor.pushData(stamp({ query: String(raw), domain, found: false, reason: 'domain_does_not_exist' }, src));
      misses += 1;
      continue;
    }
    if ([answers.mx, answers.txt].every((a) => a && a.error && !['ENODATA', 'ENOTFOUND'].includes(a.error))) {
      await Actor.pushData(stamp({ query: String(raw), domain, found: false, reason: 'dns_unreachable_retry_later' }, src));
      misses += 1;
      continue;
    }
    await Actor.pushData(stamp({ query: String(raw), found: true, ...evaluate(domain, answers) }, src));
    pushed += 1;
    // PPE: charge once per domain audited; invalid, nonexistent and unreachable domains are free.
    const { eventChargeLimitReached } = await Actor.charge({ eventName: 'domain-audited' });
    charged += 1;
    if (eventChargeLimitReached) stop = true;
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
