import { Actor } from 'apify';
import { fetchJson, rateLimiter } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { loadTracker } from './lib/incremental.js';
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

// Incremental mode: named-store cursor. TED's date filter is exclusive, so ask from the day
// before the boundary date and deduplicate the boundary day by publication number.
const inc = sinceLastRun ? await loadTracker(Actor, 'eu-ted-tenders-monitor', { cpvCodes, countries, fullTextSearch }) : null;
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
const effectiveAfter = inc?.tracker.since ? dayBefore(inc.tracker.since) : publishedAfter;

const query = buildQuery({ cpvCodes, countries, text: fullTextSearch, publishedAfter: effectiveAfter });
const limit = rateLimiter(700);
let pushed = 0;
let charged = 0;
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
      if (inc?.tracker.isDuplicate(rec.published_at, rec.publication_number)) continue;
      await Actor.pushData(stamp(rec, rec.notice_url || `https://ted.europa.eu/en/notice/-/detail/${rec.publication_number}`));
      inc?.tracker.observe(rec.published_at, rec.publication_number);
      pushed += 1;
      // PPE: charge only for real, non-empty tender records.
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'tender-result' });
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
