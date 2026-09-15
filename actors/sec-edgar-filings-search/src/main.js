import { Actor } from 'apify';
import { fetchJson, rateLimiter } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { loadTracker } from './lib/incremental.js';
import { parseFtsResponse, buildFtsUrl } from './transform.js';

// SEC fair-access policy: max 10 req/s; we stay far below and identify ourselves.
const SEC_HEADERS = { 'User-Agent': 'apify-actor-sec-edgar-filings-search contact@apify.com' };
const PAGE_SIZE = 10; // fixed by the SEC FTS API

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const {
  query,
  forms = [],
  startDate = null,
  endDate = null,
  maxResults = 100,
  sinceLastRun = false,
} = input;

if (!query || typeof query !== 'string') {
  throw new Error('Input "query" (search phrase) is required.');
}

// Incremental mode: named-store cursor; the boundary date is re-read and deduplicated by document.
const inc = sinceLastRun ? await loadTracker(Actor, 'sec-edgar-filings-search', { query, forms, endDate }) : null;
const effectiveStart = inc?.tracker.since || startDate;

const limit = rateLimiter(350);
let pushed = 0;
let charged = 0;
let failureClass = null;

try {
  for (let from = 0; pushed < maxResults; from += PAGE_SIZE) {
    await limit();
    const url = buildFtsUrl({ query, forms, startDate: effectiveStart, endDate, from });
    const response = await fetchJson(url, { headers: SEC_HEADERS });
    const { records } = parseFtsResponse(response);
    if (records.length === 0) break;

    for (const rec of records) {
      if (pushed >= maxResults) break;
      if (inc?.tracker.isDuplicate(rec.filed_at, rec.document_url)) continue;
      await Actor.pushData(stamp(rec, rec.document_url));
      inc?.tracker.observe(rec.filed_at, rec.document_url);
      pushed += 1;
      // PPE: charge only for real, non-empty filing records.
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'filing-result' });
      charged += 1;
      if (eventChargeLimitReached) {
        await inc?.save();
        await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
        await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
      }
    }
    if (records.length < PAGE_SIZE) break;
  }

  await inc?.save();
} catch (e) {
  failureClass = e.failureClass || 'unknown';
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: failureClass,
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
