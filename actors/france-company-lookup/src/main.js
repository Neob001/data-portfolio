import { Actor } from 'apify';
import { fetchJson, rateLimiter } from './lib/http.js';
import { writeRunSummary } from './lib/run_summary.js';
import { runQueries } from './lookup.js';

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const queries = (input.queries || []).map((q) => String(q ?? '').trim()).filter(Boolean);

if (queries.length === 0) {
  await writeRunSummary(Actor, { rows: 0, errors: 1, failure_class: 'http_error', duration_ms: Date.now() - started });
  throw new Error('Provide at least one query: a company name, a 9-digit SIREN or a 14-digit SIRET.');
}

// API limit is 7 req/s per IP (30 req/s per ASN on shared clouds); stay at <= 5 req/s.
const limit = rateLimiter(220);

let rows = 0;
let charged = 0;

async function emit(record, { charge }) {
  await Actor.pushData(record);
  rows += 1;
  if (!charge) return { stop: false };
  // PPE: one `company-found` per delivered company. Misses, invalid ids,
  // excluded sole proprietors and API failures are never charged.
  const { eventChargeLimitReached } = await Actor.charge({ eventName: 'company-found' });
  charged += 1;
  return { stop: Boolean(eventChargeLimitReached) };
}

let stats;
try {
  stats = await runQueries(queries, input, { fetchJson, limit, emit });
} catch (e) {
  await writeRunSummary(Actor, {
    rows, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown', duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, {
  rows,
  charged_events: charged,
  errors: stats.errors,
  failure_class: stats.failure_class,
  queries: stats.queries,
  found: stats.found,
  not_found: stats.not_found,
  excluded_individuals_or_restricted: stats.excluded,
  irrelevant_skipped: stats.irrelevant_skipped,
  charge_limit_reached: stats.stopped,
  duration_ms: Date.now() - started,
});

if (stats.errors > 0 && stats.found === 0 && stats.errors === stats.queries) {
  await Actor.fail(`All ${stats.errors} queries failed (${stats.failure_class}).`);
} else {
  await Actor.exit();
}
