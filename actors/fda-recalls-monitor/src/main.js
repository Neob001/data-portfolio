import { Actor } from 'apify';
import { fetchJson, rateLimiter, FetchError } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
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

const store = await Actor.openKeyValueStore();
const cursorKey = `CURSOR-${[category, searchTerm || '', ...classifications].join('_').replace(/\W+/g, '_').slice(0, 60)}`;
let effectiveAfter = reportedAfter;
if (sinceLastRun) {
  const cursor = await store.getValue(cursorKey);
  if (cursor?.last_report_date) effectiveAfter = cursor.last_report_date;
}

const limit = rateLimiter(300); // openFDA: 240 req/min keyless
let pushed = 0;
let charged = 0;
let newest = null;

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
    const { records } = parseEnforcementResponse(response);
    if (records.length === 0) break;
    for (const rec of records) {
      if (pushed >= maxResults) break;
      if (rec.report_date && (!newest || rec.report_date > newest)) newest = rec.report_date;
      await Actor.pushData(stamp(rec, url));
      pushed += 1;
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'recall-result' });
      charged += 1;
      if (eventChargeLimitReached) {
        await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
        await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
      }
    }
    if (records.length < PAGE) break;
  }
  if (sinceLastRun && newest) await store.setValue(cursorKey, { last_report_date: newest });
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
