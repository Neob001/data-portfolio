import { Actor, log } from 'apify';
import { writeRunSummary } from './lib/run_summary.js';
import { storeNameFor } from './lib/incremental.js';
import { INDEX_BASE_URL } from './core/feed.js';
import { normalizeBulkInput, bulkFilterIdentity, runBulk, EVENT } from './bulk.js';
import { loadSeen, dayOf } from './seen.js';

const SLUG = 'jobs-bulk-feed';

await Actor.init();
const started = Date.now();
const raw = (await Actor.getInput()) ?? {};

let opts;
try {
  opts = normalizeBulkInput(raw);
} catch (e) {
  await writeRunSummary(Actor, { errors: 1, failure_class: 'input_error', duration_ms: Date.now() - started });
  await Actor.fail(`Invalid input: ${e.message}`);
}

// sinceLastRun: hashed job_ids of every job delivered for this filter set, in a NAMED store (persists across runs).
const state = opts.sinceLastRun ? await loadSeen(await Actor.openKeyValueStore(storeNameFor(SLUG)), bulkFilterIdentity(opts)) : null;
if (state) log.info(`sinceLastRun: ${state.seen.size} jobs delivered by earlier runs with these filters will be skipped.`);

const charging = Actor.getChargingManager();
let summary = null;
let failure = null;
try {
  summary = await runBulk(opts, {
    indexBaseUrl: process.env.JOBS_INDEX_URL || INDEX_BASE_URL,
    room: () => charging.calculateMaxEventChargeCountWithinLimit(EVENT),
    deliver: async (rows) => {
      await Actor.pushData(rows);
      return Actor.charge({ eventName: EVENT, count: rows.length });
    },
    seen: state?.seen ?? null,
    log: (m) => log.info(m),
  });
} catch (e) {
  failure = e;
}

// Remember what was delivered even when the run failed midway: those jobs were pushed and charged.
let saved = null;
if (state) {
  const builtAt = summary?.index_built_at ?? null;
  saved = await state.save({
    complete: Boolean(summary?.complete),
    today: dayOf(builtAt ? Date.parse(builtAt) : Date.now()),
    indexBuiltAt: builtAt,
  });
}

if (failure) {
  await writeRunSummary(Actor, { errors: 1, failure_class: failure.failureClass || 'site_down', duration_ms: Date.now() - started });
  await Actor.fail(`Jobs index unreadable: ${failure.message}`);
}

await writeRunSummary(Actor, {
  ...summary,
  errors: summary.shards_failed,
  failure_class: null,
  duration_ms: Date.now() - started,
  seen_after: saved?.count ?? null,
});
const more = summary.stop_reason === 'exhausted' ? '' : ' Run it again (sinceLastRun) to continue where it stopped.';
const why = {
  exhausted: 'all matching jobs not delivered before',
  max_results: `maxResults (${opts.maxResults}) reached`,
  charge_limit: 'your maximum charge per run reached',
  deadline: 'run timeout approaching - stopped cleanly',
}[summary.stop_reason];
const skipped = summary.shards_failed
  ? ` ${summary.shards_failed} of ${summary.shards_total} index parts could not be downloaded and were skipped${opts.sinceLastRun ? ' (their jobs come with the next run)' : ''}.`
  : '';
await Actor.exit({
  statusMessage: `${summary.rows} jobs delivered from the index built ${summary.index_built_at} (${why}; ${summary.skipped_seen} already delivered earlier, not charged).${opts.sinceLastRun ? more : ''}${skipped}`,
});
