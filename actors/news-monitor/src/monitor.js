// Stateful orchestration: walks each query's time window (splitting it when a slice comes back
// at the API cap), dedupes by URL, applies the incremental cursor, and charges per delivered
// article. Pure decision logic lives in transform.js; this module only sequences I/O (fetchGdelt,
// pushData, charge, the incremental tracker) around it, so it takes everything as injected deps
// and is fully testable against a fake fetchGdelt (see tests/monitor.test.mjs).
import { buildUrl, parseArtList, articleToRecord, filterNewByUrl, needsSplit, splitWindow, GDELT_MAX_RECORDS } from './transform.js';
import { stamp } from './lib/records.js';

/** Recursively fetch+deliver one [startMs, endMs) window, splitting on truncation. */
async function fetchWindow({ queryInput, startMs, endMs, depth, fetchGdelt, seenUrls, state, deliver }) {
  if (state.stopped) return;
  const requestUrl = buildUrl({ ...queryInput, startDate: new Date(startMs), endDate: new Date(endMs), maxrecords: GDELT_MAX_RECORDS });
  const response = await fetchGdelt(requestUrl);
  const articles = parseArtList(response);

  if (needsSplit(articles.length, startMs, endMs, depth)) {
    const [a, b] = splitWindow(startMs, endMs);
    // Newest-first: the API's own DateDesc sort means the second (later) half holds the newest
    // articles, so walk it first -- matters when maxResultsPerQuery caps delivery mid-window.
    await fetchWindow({ queryInput, startMs: b[0], endMs: b[1], depth: depth + 1, fetchGdelt, seenUrls, state, deliver });
    if (state.stopped) return;
    await fetchWindow({ queryInput, startMs: a[0], endMs: a[1], depth: depth + 1, fetchGdelt, seenUrls, state, deliver });
    return;
  }

  for (const article of filterNewByUrl(articles, seenUrls)) {
    if (state.stopped) return;
    seenUrls.add(article.url);
    await deliver(article, requestUrl);
  }
}

/**
 * Run one query end-to-end.
 * deps: { fetchGdelt, pushData, charge, openTracker?, nowMs? }
 *  - openTracker(filters) -> { tracker, save(opts) } (see src/lib/incremental.js); omit for sinceLastRun:false.
 */
export async function runQuery(queryText, input, deps) {
  const { mode = 'news', languages = [], countries = [], domains = [], lookbackHours = 24, maxResultsPerQuery = 100, sinceLastRun = false } = input;
  const { fetchGdelt, pushData, charge, openTracker, nowMs = () => Date.now() } = deps;

  const queryInput = { query: queryText, mode, languages, countries, domains };
  const filters = { query: queryText, mode, languages, countries, domains };
  const inc = sinceLastRun && openTracker ? await openTracker(filters) : null;

  const endMs = nowMs();
  const cappedLookbackMs = Math.min(Math.max(lookbackHours, 1), 2160) * 3600 * 1000;
  let startMs = endMs - cappedLookbackMs;
  if (inc?.tracker.since) {
    const sinceMs = Date.parse(inc.tracker.since);
    if (!Number.isNaN(sinceMs) && sinceMs > startMs) startMs = sinceMs;
  }

  const state = { stopped: false };
  const seenUrls = new Set();
  let pushed = 0;
  let charged = 0;
  let chargeLimitReached = false;

  await fetchWindow({
    queryInput,
    startMs,
    endMs,
    depth: 0,
    fetchGdelt,
    seenUrls,
    state,
    deliver: async (article, requestUrl) => {
      if (pushed >= maxResultsPerQuery) { state.stopped = true; return; }
      const rec = articleToRecord(article, { query: queryText, mode });
      if (!rec) return;
      if (inc?.tracker.isDuplicate(rec.published_at, rec.article_id)) return;
      await pushData(stamp(rec, requestUrl));
      inc?.tracker.observe(rec.published_at, rec.article_id);
      pushed += 1;
      const { eventChargeLimitReached } = await charge();
      charged += 1;
      if (eventChargeLimitReached) { chargeLimitReached = true; state.stopped = true; }
    },
  });

  const truncated = chargeLimitReached || pushed >= maxResultsPerQuery;
  await inc?.save({ truncated, runSince: new Date(startMs).toISOString() });

  return { query: queryText, pushed, charged, chargeLimitReached };
}

/** Run every query in `input.queries` in sequence, stopping early once the run-wide charge limit hits. */
export async function runMonitor(input, deps) {
  const results = [];
  let runLimitReached = false;
  for (const queryText of input.queries || []) {
    if (runLimitReached) {
      results.push({ query: queryText, pushed: 0, charged: 0, chargeLimitReached: true, skipped: true });
      continue;
    }
    const r = await runQuery(queryText, input, deps);
    results.push(r);
    if (r.chargeLimitReached) runLimitReached = true;
  }
  return results;
}
