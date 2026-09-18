import { Actor, log } from 'apify';
import { writeRunSummary } from './lib/run_summary.js';
import { loadTracker } from './lib/incremental.js';
import { normalizeInput, filterIdentity } from './filters.js';
import { runFeed, INDEX_BASE_URL } from './feed.js';

const SLUG = 'ats-jobs-feed';

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};

let opts;
try {
  opts = normalizeInput(input);
} catch (e) {
  await writeRunSummary(Actor, { errors: 1, failure_class: 'input_error', duration_ms: Date.now() - started });
  await Actor.fail(`Invalid input: ${e.message}`);
}
if (opts.badRefs.length) log.warning(`Ignored ${opts.badRefs.length} unsupported board reference(s): ${opts.badRefs.slice(0, 5).join(', ')}`);

// Incremental mode: per-filter-set cursor in a NAMED store (shared/js/incremental.js), dedupe by job_id.
const inc = opts.sinceLastRun ? await loadTracker(Actor, SLUG, filterIdentity(opts)) : null;
const runSince = inc?.tracker.since ?? null;

let summary;
try {
  summary = await runFeed(opts, {
    indexBaseUrl: process.env.JOBS_INDEX_URL || INDEX_BASE_URL,
    pushData: (row) => Actor.pushData(row),
    charge: (ev) => Actor.charge(ev),
    tracker: inc?.tracker ?? null,
    log: (m) => log.info(m),
  });
  await inc?.save({ truncated: summary.stop_reason !== 'exhausted', runSince });
} catch (e) {
  await writeRunSummary(Actor, {
    errors: 1, failure_class: e.failureClass || 'unknown', duration_ms: Date.now() - started,
  });
  throw e;
}

const allLiveFailed = summary.boards_requested > 0 && summary.boards_ok === 0;
await writeRunSummary(Actor, {
  rows: summary.rows,
  charged_events: summary.charged_events,
  errors: summary.boards_failed,
  failure_class: allLiveFailed ? (summary.failed_boards[0]?.failure_class || 'site_down') : null,
  duration_ms: Date.now() - started,
  mode: summary.mode,
  stop_reason: summary.stop_reason,
  matched: summary.matched,
  skipped_seen: summary.skipped_seen,
  skipped_closed: summary.skipped_closed,
  descriptions_unavailable: summary.descriptions_unavailable,
  description_boards_fetched: summary.description_boards_fetched,
  description_boards_failed: summary.description_boards_failed,
  shards_read: summary.shards_read,
  index_built_at: summary.index_built_at,
  used_fallback: summary.used_fallback,
  failed_boards: summary.failed_boards.slice(0, 50),
});
if (summary.stop_reason === 'charge_limit') {
  await Actor.exit({ statusMessage: `Charge limit reached after ${summary.rows} jobs` });
} else if (allLiveFailed && summary.rows === 0) {
  await Actor.fail(`All ${summary.boards_requested} job boards failed to load (${summary.failed_boards.map((b) => b.board).slice(0, 5).join(', ')})`);
} else {
  await Actor.exit({ statusMessage: `${summary.rows} jobs delivered (${summary.mode}${summary.used_fallback ? ', index unreachable - live fallback' : ''})` });
}
