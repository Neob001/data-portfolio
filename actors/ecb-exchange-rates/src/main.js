import { Actor } from 'apify';
import { rateLimiter, FetchError } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { buildUrl, parseCsv, dropDiscontinued, toRows, normalizeCurrencies } from './transform.js';

const UA = { 'User-Agent': 'apify-actor-ecb-exchange-rates', Accept: 'text/csv' };
const MAX_RANGE_DAYS = 366 * 30;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const base = normalizeCurrencies([input.baseCurrency || 'EUR'])[0] || 'EUR';
let quotes = normalizeCurrencies(input.currencies);
const startDate = input.startDate || null;
const endDate = input.endDate || null;
const maxResults = Number(input.maxResults) || 10000;

for (const d of [startDate, endDate]) {
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Dates must be YYYY-MM-DD, got "${d}".`);
}
if (startDate && endDate && startDate > endDate) throw new Error('startDate must be on or before endDate.');
if (startDate && endDate && (new Date(endDate) - new Date(startDate)) / 86400000 > MAX_RANGE_DAYS) {
  throw new Error('Date range too large; split it into ranges of at most 30 years.');
}

const limit = rateLimiter(300);

async function fetchObs(currencies) {
  await limit();
  const url = buildUrl({ currencies, startDate, endDate });
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
  if (res.status === 404) return { url, obs: [] }; // unknown currency or no data in range
  if (!res.ok) throw new FetchError(`HTTP ${res.status} at ${url}`, res.status >= 500 ? 'site_down' : 'http_error', res.status);
  return { url, obs: parseCsv(await res.text()) };
}

let pushed = 0;
let charged = 0;

try {
  // Request the quote currencies plus the base leg; EUR itself is implicit (1.0).
  const legs = quotes.length === 0 ? [] : [...new Set([...quotes, base])].filter((c) => c !== 'EUR');
  let { url, obs } = await fetchObs(legs);
  // A multi-currency key 404s when any code is unknown: retry one by one to salvage valid ones.
  if (obs.length === 0 && legs.length > 1) {
    const merged = [];
    for (const c of legs) merged.push(...(await fetchObs([c])).obs);
    obs = merged;
  }
  // Staleness only means "discontinued" in latest-rate mode; historical ranges are legitimately old.
  const latestMode = !startDate && !endDate;
  const { kept, discontinued } = latestMode ? dropDiscontinued(obs) : { kept: obs, discontinued: [] };
  if (quotes.length === 0) quotes = ['EUR', ...new Set(kept.map((o) => o.currency))].sort();

  const rows = toRows(kept, base, quotes);
  const known = new Set(['EUR', ...kept.map((o) => o.currency)]);
  const unknown = [...new Set([base, ...quotes])].filter((c) => !known.has(c));

  for (const row of rows) {
    if (pushed >= maxResults) break;
    await Actor.pushData(stamp({ ...row, source: 'ECB euro foreign exchange reference rates' }, url));
    pushed += 1;
    // PPE: one charge per delivered rate row; unknown or discontinued currencies are free.
    const { eventChargeLimitReached } = await Actor.charge({ eventName: 'rate-result' });
    charged += 1;
    if (eventChargeLimitReached) break;
  }
  for (const c of new Set([...discontinued, ...unknown])) {
    if (quotes.includes(c) || c === base) {
      await Actor.pushData(stamp({ currency: c, found: false, reason: discontinued.includes(c) ? 'discontinued_by_ecb' : 'unknown_currency_or_no_data' }, url));
    }
  }
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
