import { Actor } from 'apify';
import { fetchJson, rateLimiter } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
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

const store = await Actor.openKeyValueStore();
const cursorKey = `CURSOR-${[searchTerm || '', ...documentTypes, ...agencySlugs].join('_').replace(/\W+/g, '_').slice(0, 60)}`;
let effectiveAfter = publishedAfter;
if (sinceLastRun) {
  const cursor = await store.getValue(cursorKey);
  if (cursor?.last_published_at) effectiveAfter = cursor.last_published_at;
}

const limit = rateLimiter(600);
let pushed = 0;
let charged = 0;
let newest = null;

try {
  for (let page = 1; pushed < maxResults; page += 1) {
    await limit();
    const url = buildUrl({ term: searchTerm, documentTypes, agencySlugs, publishedAfter: effectiveAfter, page, perPage: PER_PAGE });
    const response = await fetchJson(url);
    const { records } = parseDocumentsResponse(response);
    if (records.length === 0) break;
    for (const rec of records) {
      if (pushed >= maxResults) break;
      if (rec.published_at && (!newest || rec.published_at > newest)) newest = rec.published_at;
      await Actor.pushData(stamp(rec, rec.html_url || 'https://www.federalregister.gov'));
      pushed += 1;
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'document-result' });
      charged += 1;
      if (eventChargeLimitReached) {
        await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
        await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
      }
    }
    if (records.length < PER_PAGE) break;
  }
  if (sinceLastRun && newest) await store.setValue(cursorKey, { last_published_at: newest });
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
