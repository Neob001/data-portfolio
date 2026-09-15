// Query orchestration, independent of the Apify SDK so it can be tested with
// golden fixtures and smoke-tested locally. main.js wires it to Actor.pushData/charge.
import { FetchError } from './lib/http.js';
import { stamp } from './lib/records.js';
import {
  parseQuery,
  buildSearchUrl,
  companyToRecord,
  exclusionReason,
  matchesCompanyText,
  bestNameMatch,
  resultsOf,
  MAX_PER_PAGE,
  RESULT_WINDOW,
  API_BASE,
} from './transform.js';

export const USER_AGENT = 'factpipe-france-company-lookup/0.1 (+https://apify.com/factpipe)';

const miss = (query, reason, sourceUrl) => stamp({ query, found: false, reason }, sourceUrl);

/**
 * Run all queries.
 * deps: { fetchJson(url, opts), limit(): Promise, emit(record, { charge }): Promise<{ stop }> }
 * Only rows with found:true are emitted with charge:true.
 */
export async function runQueries(queries, options, deps) {
  const {
    maxResultsPerQuery = 5,
    postalCode = null,
    department = null,
    nafCode = null,
    onlyActive = true,
    minEmployeeRange = null,
  } = options || {};
  const max = Math.min(100, Math.max(1, Number(maxResultsPerQuery) || 5));
  const filters = { postalCode, department, nafCode, onlyActive, minEmployeeRange };
  const { fetchJson, limit, emit } = deps;
  const stats = { queries: 0, found: 0, not_found: 0, excluded: 0, irrelevant_skipped: 0, errors: 0, failure_class: null, stopped: false };

  const get = async (url) => {
    await limit();
    return fetchJson(url, { headers: { 'user-agent': USER_AGENT }, retries: 4, minDelayMs: 1500 });
  };
  const deliver = async (record, sourceUrl) => {
    stats.found += 1;
    const { stop } = await emit(stamp({ query: record.query, found: true, reason: null, ...record }, sourceUrl), { charge: true });
    if (stop) stats.stopped = true;
    return stop;
  };
  const deliverMiss = async (query, reason, sourceUrl) => {
    if (reason.endsWith('_excluded')) stats.excluded += 1;
    else stats.not_found += 1;
    await emit(miss(query, reason, sourceUrl), { charge: false });
  };

  async function lookupIdentifier(query, parsed) {
    const siren = parsed.value.slice(0, 9);
    const url = buildSearchUrl({ q: parsed.value, perPage: 5 });
    const units = resultsOf(await get(url));
    const unit = units.find((u) => String(u?.siren) === siren);
    if (!unit) return deliverMiss(query, 'not_found', url);
    const excluded = exclusionReason(unit);
    if (excluded) return deliverMiss(query, excluded, url);
    const rec = companyToRecord(unit, { siret: parsed.type === 'siret' ? parsed.value : null });
    if (!rec) return deliverMiss(query, 'not_found', url);
    if (parsed.type === 'siret' && rec.matched_siret !== parsed.value) return deliverMiss(query, 'siret_not_found', url);
    return deliver({ query, ...rec }, url);
  }

  async function searchBest(query, name) {
    const url = buildSearchUrl({ q: name, perPage: 10, filters });
    const units = resultsOf(await get(url));
    const candidates = units.filter((u) => {
      if (exclusionReason(u)) {
        stats.excluded += 1;
        return false;
      }
      return matchesCompanyText(u, name);
    });
    const best = bestNameMatch(candidates, name);
    if (!best) return deliverMiss(query, units.length ? 'no_confident_match' : 'no_results', url);
    const rec = companyToRecord(best);
    if (!rec) return deliverMiss(query, 'no_confident_match', url);
    return deliver({ query, ...rec }, url);
  }

  async function searchMany(query, name) {
    const perPage = Math.min(MAX_PER_PAGE, max);
    const maxPages = Math.ceil(max / perPage) + 3; // headroom for skipped sole proprietors
    const seen = new Set();
    let delivered = 0;
    let lastUrl = buildSearchUrl({ q: name, perPage, filters });
    for (let page = 1; page <= maxPages && page * perPage <= RESULT_WINDOW; page++) {
      lastUrl = buildSearchUrl({ q: name, page, perPage, filters });
      const payload = await get(lastUrl);
      const units = resultsOf(payload);
      for (const u of units) {
        if (delivered >= max) break;
        if (!u || seen.has(u.siren)) continue;
        seen.add(u.siren);
        if (exclusionReason(u)) {
          stats.excluded += 1; // silently skipped, never charged
          continue;
        }
        if (!matchesCompanyText(u, name)) {
          stats.irrelevant_skipped += 1;
          continue;
        }
        const rec = companyToRecord(u);
        if (!rec) continue;
        delivered += 1;
        if (await deliver({ query, ...rec }, lastUrl)) return true;
      }
      const totalPages = Number(payload.total_pages) || 0;
      if (delivered >= max || units.length < perPage || page >= totalPages) break;
    }
    if (delivered === 0) await deliverMiss(query, 'no_results', lastUrl);
    return false;
  }

  for (const raw of queries || []) {
    const query = String(raw ?? '');
    const parsed = parseQuery(query);
    stats.queries += 1;
    try {
      let stop = false;
      if (parsed.type === 'invalid') {
        await deliverMiss(query, parsed.reason, API_BASE);
      } else if (parsed.type === 'siren' || parsed.type === 'siret') {
        stop = await lookupIdentifier(query, parsed);
      } else if (max === 1) {
        stop = await searchBest(query, parsed.value);
      } else {
        stop = await searchMany(query, parsed.value);
      }
      if (stop) break;
    } catch (e) {
      if (e instanceof FetchError && e.status === 400) {
        await deliverMiss(query, 'invalid_query', API_BASE);
        continue;
      }
      stats.errors += 1;
      stats.failure_class = e.failureClass || 'unknown';
      await emit(miss(query, 'api_error', API_BASE), { charge: false });
    }
  }
  return stats;
}
