import { Actor } from 'apify';
import { fetchJson, rateLimiter, FetchError } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { loadTracker } from './lib/incremental.js';
import { parseEnforcementResponse, buildUrl } from './transform.js';

const PAGE = 100;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const {
  category = 'food',
  searchTerm = null,
  classifications = [],
  reportedAfter = null,
  maxResults = 100,
  sinceLastRun = false,
} = input;

// Incremental mode: named-store cursor; the report_date range is inclusive, boundary day deduplicated.
const inc = sinceLastRun ? await loadTracker(Actor, 'fda-recalls-monitor', { category, searchTerm, classifications }) : null;
const effectiveAfter = inc?.tracker.since || reportedAfter;

const limit = rateLimiter(300); // openFDA: 240 req/min keyless
let pushed = 0;
let charged = 0;

try {
  for (let skip = 0; pushed < maxResults; skip += PAGE) {
    await limit();
    const url = buildUrl({ category, searchTerm, classifications, reportedAfter: effectiveAfter, skip, limit: PAGE });
    let response;
    try {
      response = await fetchJson(url);
    } catch (e) {
      // openFDA returns HTTP 404 for empty result sets - that's "no matches", not an error.
      if (e instanceof FetchError && e.status === 404) break;
      throw e;
    }
    const { records, rawCount } = parseEnforcementResponse(response);
    if (rawCount === 0) break;
    for (const rec of records) {
      if (pushed >= maxResults) break;
      if (inc?.tracker.isDuplicate(rec.report_date, rec.recall_number)) continue;
      await Actor.pushData(stamp(rec, url));
      inc?.tracker.observe(rec.report_date, rec.recall_number);
      pushed += 1;
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'recall-result' });
      charged += 1;
      if (eventChargeLimitReached) {
        await inc?.save({ truncated: true, runSince: effectiveAfter });
        await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
        await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
      }
    }
    // Page size is judged on the raw API count: a malformed record must not end pagination early.
    if (rawCount < PAGE) break;
  }
  await inc?.save({ truncated: pushed >= maxResults, runSince: effectiveAfter });
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
