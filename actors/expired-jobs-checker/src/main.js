import { Actor, log } from 'apify';
import { writeRunSummary } from './lib/run_summary.js';
import { INDEX_BASE_URL } from './core/feed.js';
import { normalizeCheckInput, runCheck, EVENT } from './check.js';

await Actor.init();
const started = Date.now();
const raw = (await Actor.getInput()) ?? {};

let input;
try {
  input = normalizeCheckInput(raw);
} catch (e) {
  await writeRunSummary(Actor, { errors: 1, failure_class: 'input_error', duration_ms: Date.now() - started });
  await Actor.fail(`Invalid input: ${e.message}`);
}

const charging = Actor.getChargingManager();
let summary;
try {
  summary = await runCheck(input, {
    indexBaseUrl: process.env.JOBS_INDEX_URL || INDEX_BASE_URL,
    room: () => charging.calculateMaxEventChargeCountWithinLimit(EVENT),
    deliver: async (rows, chargeCount) => {
      await Actor.pushData(rows);
      return chargeCount ? Actor.charge({ eventName: EVENT, count: chargeCount }) : null;
    },
    log: (m) => log.info(m),
  });
} catch (e) {
  await writeRunSummary(Actor, { errors: 1, failure_class: e.failureClass || 'site_down', duration_ms: Date.now() - started });
  await Actor.fail(`Jobs index unreadable: ${e.message}`);
}

await writeRunSummary(Actor, { ...summary, errors: summary.shards_failed, failure_class: null, duration_ms: Date.now() - started });
const counts = `${summary.open} open, ${summary.closed} closed, ${summary.unknown} unknown`;
const left = summary.inputs - summary.rows;
const tail = {
  exhausted: '',
  charge_limit: ` Stopped at your maximum charge per run: ${left} jobs not checked (not charged).`,
  deadline: ` Run timeout approaching - stopped cleanly: ${left} jobs not checked (not charged).`,
}[summary.stop_reason];
await Actor.exit({ statusMessage: `${summary.rows} jobs checked against the index built ${summary.index_built_at}: ${counts}.${tail}` });
