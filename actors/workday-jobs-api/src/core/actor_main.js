// Apify entry shared by the job-feed Actors (ats-jobs-feed, remote-jobs-feed, ats-jobs-scraper, the
// per-ATS greenhouse/lever/ashby/workday-jobs-api). Each Actor's main.js only maps its own input onto
// normalizeInput() options.
import { Actor, log } from 'apify';
import { writeRunSummary } from '../lib/run_summary.js';
import { loadTracker } from '../lib/incremental.js';
import { normalizeInput, filterIdentity } from './filters.js';
import { runFeed, INDEX_BASE_URL } from './feed.js';

/**
 * @param slug Actor slug (names the incremental-state store)
 * @param toOptions raw input -> normalizeInput() options (throws a readable Error on bad input)
 * @param noBoardsMessage badRefs -> status message when live mode has no usable board left
 */
export async function runJobsActor({ slug, toOptions = normalizeInput, noBoardsMessage = noSupportedBoardsMessage }) {
  await Actor.init();
  const started = Date.now();
  const input = (await Actor.getInput()) ?? {};

  let opts;
  try {
    opts = toOptions(input);
  } catch (e) {
    await writeRunSummary(Actor, { errors: 1, failure_class: 'input_error', duration_ms: Date.now() - started });
    await Actor.fail(`Invalid input: ${e.message}`);
    return;
  }
  if (opts.badRefs.length) log.warning(`Ignored ${opts.badRefs.length} unsupported board reference(s): ${opts.badRefs.slice(0, 5).join(', ')}`);
  // Only unsupported URLs (e.g. a company's own careers page): explain instead of failing the run.
  if (opts.mode === 'live' && opts.boards.length === 0) {
    await writeRunSummary(Actor, { rows: 0, errors: opts.badRefs.length, failure_class: 'input_error', duration_ms: Date.now() - started });
    await Actor.exit({ statusMessage: noBoardsMessage(opts.badRefs) });
    return;
  }

  // Incremental mode: per-filter-set cursor in a NAMED store (shared/js/incremental.js), dedupe by job_id.
  const inc = opts.sinceLastRun ? await loadTracker(Actor, slug, filterIdentity(opts)) : null;
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
    errors: summary.boards_failed + summary.shards_failed,
    failure_class: allLiveFailed ? (summary.failed_boards[0]?.failure_class || 'site_down') : null,
    duration_ms: Date.now() - started,
    mode: summary.mode,
    ranking: summary.ranking,
    stop_reason: summary.stop_reason,
    matched: summary.matched,
    skipped_seen: summary.skipped_seen,
    skipped_closed: summary.skipped_closed,
    descriptions_unavailable: summary.descriptions_unavailable,
    description_boards_fetched: summary.description_boards_fetched,
    description_boards_failed: summary.description_boards_failed,
    description_jobs_fetched: summary.description_jobs_fetched,
    description_jobs_failed: summary.description_jobs_failed,
    boards_truncated: summary.boards_truncated,
    shards_read: summary.shards_read,
    shards_failed: summary.shards_failed,
    ranking_passes: summary.ranking_passes,
    index_scan_ms: summary.index_scan_ms,
    delivery_ms: summary.delivery_ms,
    index_built_at: summary.index_built_at,
    used_fallback: summary.used_fallback,
    fallback_reason: summary.fallback_reason,
    failed_boards: summary.failed_boards.slice(0, 50),
  });
  if (summary.stop_reason === 'charge_limit') {
    await Actor.exit({ statusMessage: `Charge limit reached after ${summary.rows} jobs` });
  } else if (allLiveFailed && summary.rows === 0 && summary.failed_boards.some((b) => b.robots) && summary.failed_boards.every((b) => b.robots || b.status === 404)) {
    // A site whose robots.txt disallows its job pages is never read: an input choice, not an outage.
    const blocked = summary.failed_boards.filter((b) => b.robots).map((b) => b.board);
    await Actor.exit({ statusMessage: `Skipped ${blocked.length} job board(s) whose robots.txt disallows automated reading (${blocked.slice(0, 3).join(', ')}${blocked.length > 3 ? ', ...' : ''}). Nothing was charged.` });
  } else if (allLiveFailed && summary.rows === 0 && summary.failed_boards.every((b) => b.status === 404)) {
    // Boards that do not exist are an input problem, not an outage: explain instead of failing.
    await Actor.exit({ statusMessage: `None of the ${summary.boards_requested} job boards exist (HTTP 404: ${summary.failed_boards.map((b) => b.board).slice(0, 5).join(', ')}). Check the company's board URL on its careers page.` });
  } else if (allLiveFailed && summary.rows === 0) {
    await Actor.fail(`All ${summary.boards_requested} job boards failed to load (${summary.failed_boards.map((b) => b.board).slice(0, 5).join(', ')})`);
  } else {
    const why = summary.fallback_reason === 'platform_not_indexed' ? 'platform not in the index yet' : 'index unreachable';
    await Actor.exit({ statusMessage: `${summary.rows} jobs delivered (${summary.mode}${summary.used_fallback ? `, ${why} - live fallback` : ''})` });
  }
}

/** Status message for runs whose board references are all unsupported (exported for tests). */
export function noSupportedBoardsMessage(badRefs) {
  return `No supported job-board URL in input (${badRefs.slice(0, 3).join(', ')}${badRefs.length > 3 ? ', ...' : ''}). `
    + 'Use Greenhouse, Lever, Ashby, Workable, Recruitee or Workday board URLs, e.g. https://job-boards.greenhouse.io/<company>, '
    + 'https://jobs.lever.co/<company>, https://<company>.wd5.myworkdayjobs.com/<site>. For a company\'s own careers page use '
    + 'https://apify.com/factpipe/company-jobs-scraper';
}
