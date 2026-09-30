// One target end-to-end (fetch with retry/fallback + DNS + detection -> row). Network functions
// are injected so tests run against fakes; main.js wires in the real ones.

import { extractSignals, detectWithEvidence } from './detect.js';
import {
  registrableDomain, dnsSummary, mergeDnsTechnologies, classifyFetchError, classifyResponse,
  isRetryable, isNxDomain, buildRow,
} from './transform.js';

export const FETCH_TIMEOUT_MS = 20000;
const RETRY_MIN_TIME_LEFT_MS = 30000;

async function attempt(url, fetchPage, timeoutMs) {
  try {
    const page = await fetchPage(url, { timeoutMs });
    return { page, error: classifyResponse(page.status, page.headers, page.html) };
  } catch (e) {
    return { page: null, error: classifyFetchError(e), status: e.status ?? null };
  }
}

/**
 * target = { raw, url, host, key } from dedupeTargets.
 * deps = { engine, fetchPage, lookupDns|null, keep, timeLeftMs, sleep }
 */
export async function analyzeTarget(target, deps) {
  const { engine, fetchPage, lookupDns = null, keep = null, timeLeftMs = () => Infinity, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = deps;
  const timeout = () => Math.max(5000, Math.min(FETCH_TIMEOUT_MS, timeLeftMs() - 15000));
  const dnsPromise = lookupDns
    ? lookupDns({ domain: registrableDomain(target.host), host: target.host }).catch(() => null)
    : Promise.resolve(null);

  let r = await attempt(target.url, fetchPage, timeout());
  const status = () => r.page?.status ?? r.status ?? null;
  if (isRetryable(r.error, status()) && timeLeftMs() > RETRY_MIN_TIME_LEFT_MS) {
    await sleep(1000);
    r = await attempt(target.url, fetchPage, timeout());
  }
  // Bare domains are tried over https first; fall back to http when TLS/connection fails.
  const bare = !/^[a-z][a-z0-9+.-]*:\/\//i.test(target.raw || '');
  if (bare && ['tls_error', 'connection_error'].includes(r.error) && !r.page && timeLeftMs() > RETRY_MIN_TIME_LEFT_MS) {
    const httpUrl = target.url.replace(/^https:/i, 'http:');
    const r2 = await attempt(httpUrl, fetchPage, timeout());
    if (r2.page) r = r2;
  }

  const answers = await dnsPromise;
  // Our own resolvers are authoritative for "domain does not exist" even when the HTTP stack
  // (or a proxy in front of it) reports it as a TLS/connection failure.
  if (!r.page && isNxDomain(answers)) r = { page: null, error: 'dns_not_found' };
  const dns = lookupDns ? dnsSummary(answers) : dnsSummary(null);
  if (r.error === 'dns_not_found') {
    return buildRow({ url: target.url, domain: target.key, error: 'dns_not_found', keep, dns: dnsSummary(null) });
  }

  const signals = extractSignals({
    url: r.page?.finalUrl || '',
    headers: r.page?.headers || {},
    setCookies: r.page?.setCookies || [],
    html: r.page?.html || '',
    dns: dns.signals,
  });
  const lookupCategories = (name) => {
    const t = engine.techs.get(name);
    return t ? t.cats.map((id) => engine.categories.get(id).name) : null;
  };
  const { technologies, evidence } = detectWithEvidence(engine, signals);
  const techs = mergeDnsTechnologies(technologies, dns, lookupCategories, evidence);
  return buildRow({
    url: target.url,
    finalUrl: r.page?.finalUrl ?? null,
    domain: target.key,
    statusCode: status(),
    error: r.error,
    techs,
    evidence,
    keep,
    dns,
  });
}
