import { Actor } from 'apify';
import { fetchJson, rateLimiter } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { parseSearchResponse, buildQuery, TED_SEARCH_URL, TED_FIELDS } from './transform.js';

const PAGE_SIZE = 100;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const {
  cpvCodes = [],
  countries = [],
  fullTextSearch = null,
  publishedAfter = null,
  maxResults = 200,
  sinceLastRun = false,
} = input;

// Incremental mode: remember the newest publication date per filter set.
const store = await Actor.openKeyValueStore();
const cursorKey = `CURSOR-${[...cpvCodes, ...countries, fullTextSearch || ''].join('_').replace(/\W+/g, '_').slice(0, 60)}`;
let effectiveAfter = publishedAfter;
if (sinceLastRun) {
  const cursor = await store.getValue(cursorKey);
  if (cursor?.last_published_at) effectiveAfter = cursor.last_published_at;
}

const query = buildQuery({ cpvCodes, countries, text: fullTextSearch, publishedAfter: effectiveAfter });
const limit = rateLimiter(700);
let pushed = 0;
let charged = 0;
let newest = null;
let failureClass = null;

try {
  for (let page = 1; pushed < maxResults; page += 1) {
    await limit();
    const response = await fetchJson(TED_SEARCH_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: { query, fields: TED_FIELDS, page, limit: PAGE_SIZE },
    });
    const { records } = parseSearchResponse(response);
    if (records.length === 0) break;

    for (const rec of records) {
      if (pushed >= maxResults) break;
      if (rec.published_at && (!newest || rec.published_at > newest)) newest = rec.published_at;
      await Actor.pushData(stamp(rec, rec.notice_url || `https://ted.europa.eu/en/notice/-/detail/${rec.publication_number}`));
      pushed += 1;
      // PPE: charge only for real, non-empty tender records.
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'tender-result' });
      charged += 1;
      if (eventChargeLimitReached) {
        await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
        await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
      }
    }
    if (records.length < PAGE_SIZE) break;
  }

  if (sinceLastRun && newest) {
    await store.setValue(cursorKey, { last_published_at: newest });
  }
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
