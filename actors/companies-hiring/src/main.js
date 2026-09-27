import { Actor, log } from 'apify';
import { writeRunSummary } from './lib/run_summary.js';
import { INDEX_BASE_URL } from './core/feed.js';
import { normalizeCompaniesInput, runCompanies } from './companies.js';

await Actor.init();
const started = Date.now();
const raw = (await Actor.getInput()) ?? {};

let input;
try {
  input = normalizeCompaniesInput(raw);
} catch (e) {
  await writeRunSummary(Actor, { errors: 1, failure_class: 'input_error', duration_ms: Date.now() - started });
  await Actor.fail(`Invalid input: ${e.message}`);
}

let summary;
try {
  summary = await runCompanies(input, {
    indexBaseUrl: process.env.JOBS_INDEX_URL || INDEX_BASE_URL,
    pushData: (row) => Actor.pushData(row),
    charge: (ev) => Actor.charge(ev),
    log: (m) => log.info(m),
  });
} catch (e) {
  await writeRunSummary(Actor, { errors: 1, failure_class: e.failureClass || 'unknown', duration_ms: Date.now() - started });
  throw e;
}

const allLiveFailed = summary.boards_requested > 0 && summary.boards_ok === 0;
const { failed_boards, ...rest } = summary;
await writeRunSummary(Actor, {
  ...rest,
  errors: summary.boards_failed + summary.shards_failed,
  failure_class: allLiveFailed ? (failed_boards[0]?.failure_class || 'site_down') : null,
  duration_ms: Date.now() - started,
  failed_boards: failed_boards.slice(0, 50),
});
if (summary.stop_reason === 'charge_limit') {
  await Actor.exit({ statusMessage: `Charge limit reached after ${summary.rows} companies` });
} else if (allLiveFailed && summary.rows === 0) {
  await Actor.fail(`Jobs index unreachable and all ${summary.boards_requested} fallback boards failed`);
} else {
  await Actor.exit({ statusMessage: `${summary.rows} companies delivered (${summary.jobs_matched} matching jobs${summary.used_fallback ? ', index unreachable - live fallback' : ''})` });
}
