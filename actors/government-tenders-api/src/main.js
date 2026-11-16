import { Actor } from 'apify';
import { writeRunSummary } from './lib/run_summary.js';
import { loadTracker } from './lib/incremental.js';
import { normalizeInput, cursorFilters } from './tenders.js';
import { indexBase, loadManifest } from './index_reader.js';
import { search, firstSeenDay } from './search.js';

const SLUG = 'government-tenders-api';

await Actor.init();
const started = Date.now();
let pushed = 0;
let charged = 0;

try {
  const o = normalizeInput((await Actor.getInput()) ?? {});
  const base = indexBase();
  const manifest = await loadManifest(base);
  const inc = o.sinceLastRun ? await loadTracker(Actor, SLUG, cursorFilters(o)) : null;
  const { rows, matched, shardsRead, shardsTotal } = await search({ base, manifest, o, tracker: inc?.tracker });

  let chargeLimit = false;
  for (const row of rows) {
    await Actor.pushData(row);
    inc?.tracker.observe(firstSeenDay(row), row.notice_id);
    pushed += 1;
    // PPE: one charge per delivered notice; runs with no match cost nothing.
    const { eventChargeLimitReached } = await Actor.charge({ eventName: 'notice-result' });
    charged += 1;
    if (eventChargeLimitReached) { chargeLimit = true; break; }
  }
  await inc?.save({ truncated: chargeLimit || matched > pushed, runSince: inc.tracker.since });
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, matched, shards_read: shardsRead, shards_total: shardsTotal,
    index_built_at: manifest.built_at, charge_limit_reached: chargeLimit, duration_ms: Date.now() - started,
  });
  if (!pushed) await Actor.setStatusMessage(`No notices match these filters in the index of ${manifest.built_at} (nothing charged).`);
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown', duration_ms: Date.now() - started,
  });
  if (e.inputError) await Actor.fail(`Invalid input: ${e.message}`);
  throw e;
}
await Actor.exit();
