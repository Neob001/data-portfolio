import { Actor } from 'apify';
import { fetchJson, rateLimiter } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { loadTracker } from './lib/incremental.js';
import { parseDocumentsResponse, buildUrl } from './transform.js';

const PER_PAGE = 100;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const {
  searchTerm = null,
  documentTypes = [],
  agencySlugs = [],
  publishedAfter = null,
  maxResults = 100,
  sinceLastRun = false,
} = input;

// Incremental mode: named-store cursor; the API date filter is inclusive, boundary day deduplicated.
const inc = sinceLastRun ? await loadTracker(Actor, 'federal-register-monitor', { searchTerm, documentTypes, agencySlugs }) : null;
const effectiveAfter = inc?.tracker.since || publishedAfter;

const limit = rateLimiter(600);
let pushed = 0;
let charged = 0;

try {
  for (let page = 1; pushed < maxResults; page += 1) {
    await limit();
    const url = buildUrl({ term: searchTerm, documentTypes, agencySlugs, publishedAfter: effectiveAfter, page, perPage: PER_PAGE });
    const response = await fetchJson(url);
    const { records, rawCount } = parseDocumentsResponse(response);
    if (rawCount === 0) break;
    for (const rec of records) {
      if (pushed >= maxResults) break;
      if (inc?.tracker.isDuplicate(rec.published_at, rec.document_number)) continue;
      await Actor.pushData(stamp(rec, rec.html_url || 'https://www.federalregister.gov'));
      inc?.tracker.observe(rec.published_at, rec.document_number);
      pushed += 1;
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'document-result' });
      charged += 1;
      if (eventChargeLimitReached) {
        await inc?.save({ truncated: true, runSince: effectiveAfter });
        await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
        await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
      }
    }
    if (rawCount < PER_PAGE) break;
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
