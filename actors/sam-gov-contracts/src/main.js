import { Actor } from 'apify';
import { FetchError } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { loadTracker } from './lib/incremental.js';
import { SAM_CSV_URL, createCsvParser, headerIndex, rowToRecord, buildMatcher } from './transform.js';

const DEFAULT_LOOKBACK_DAYS = 3;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const {
  keywords = [], naicsCodes = [], setAsideCodes = [], noticeTypes = [], agencies = [], states = [],
  postedAfter = null, maxResults = 1000, sinceLastRun = false, descriptionChars = 2000,
} = input;

if (postedAfter && !/^\d{4}-\d{2}-\d{2}$/.test(postedAfter)) throw new Error('postedAfter must be YYYY-MM-DD.');

const matches = buildMatcher({ keywords, naicsCodes, setAsideCodes, noticeTypes, agencies, states });
const inc = sinceLastRun ? await loadTracker(Actor, 'sam-gov-contracts', { keywords, naicsCodes, setAsideCodes, noticeTypes, agencies, states }) : null;

const defaultCutoff = new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10);
// Incremental mode re-reads the cursor's own date and skips notices already delivered that day.
const cutoff = inc?.tracker.since || postedAfter || defaultCutoff;

let pushed = 0;
let charged = 0;
let scanned = 0;
let idx = null;
let stop = false;
let chargeLimitHit = false;
const pending = [];

const parser = createCsvParser((row) => {
  if (!idx) { idx = headerIndex(row); return true; }
  if (row.length < 5) return true;
  const rec = rowToRecord(row, idx, descriptionChars);
  if (!rec || !rec.posted_date) return true;
  scanned += 1;
  if (rec.posted_date < cutoff) { stop = true; return false; } // file is sorted newest-first
  if (inc?.tracker.isDuplicate(rec.posted_date, rec.notice_id)) return true;
  if (!matches(rec)) return true;
  pending.push(rec);
  return true;
});

async function drain() {
  while (pending.length > 0) {
    const rec = pending.shift();
    if (pushed >= maxResults) { stop = true; return; }
    await Actor.pushData(stamp(rec, rec.notice_url || SAM_CSV_URL));
    inc?.tracker.observe(rec.posted_date, rec.notice_id);
    pushed += 1;
    // PPE: one charge per matching opportunity delivered; scanned non-matches are free.
    const { eventChargeLimitReached } = await Actor.charge({ eventName: 'opportunity-result' });
    charged += 1;
    if (eventChargeLimitReached) { stop = true; chargeLimitHit = true; return; }
  }
}

const controller = new AbortController();
try {
  let res;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    res = await fetch(SAM_CSV_URL, { redirect: 'follow', signal: controller.signal, headers: { 'User-Agent': 'apify-actor-sam-gov-contracts' } });
    if (res.ok) break;
    if (res.status < 500) throw new FetchError(`HTTP ${res.status} downloading SAM.gov extract`, 'http_error', res.status);
    await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
  }
  if (!res.ok) throw new FetchError(`HTTP ${res.status} downloading SAM.gov extract`, 'site_down', res.status);

  // The extract is Windows-1252 encoded (e.g. 0x96 en dashes).
  const decoder = new TextDecoder('windows-1252');
  const reader = res.body.getReader();
  while (!stop) {
    const { done, value } = await reader.read();
    if (done) { parser.end(); await drain(); break; }
    parser.feed(decoder.decode(value, { stream: true }));
    await drain();
  }
  if (stop) controller.abort();
  if (!idx) {
    const e = new Error('SAM.gov extract was empty');
    e.failureClass = 'schema_change';
    throw e;
  }
  await inc?.save({ truncated: pushed >= maxResults || chargeLimitHit, runSince: cutoff });
} catch (e) {
  if (!(e.name === 'AbortError' && stop)) {
    await writeRunSummary(Actor, {
      rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown', duration_ms: Date.now() - started,
    });
    throw e;
  }
}

await writeRunSummary(Actor, { rows: pushed, charged_events: charged, scanned, cutoff, duration_ms: Date.now() - started });
await Actor.exit();
