// Apify entry for "companies by technology" (actors/companies-by-technology, and the `mode: "companies-by-technology"`
// of actors/ats-jobs-feed via actor_main.js). Call after Actor.init() with the run input.
import { Actor, log } from 'apify';
import { writeRunSummary } from '../lib/run_summary.js';
import { INDEX_BASE_URL } from './feed.js';
import { normalizeTechInput, runTechnographics, hasTechEvent, missingEventMessage } from './technographics.js';

/**
 * @param input raw run input
 * @param opts.requireEvent fail fast (charging nothing) unless the run's pay-per-event pricing has the company-result
 *   event. Jobs Feed sets it: its pricing changes at most once a month, and company rows must never be charged as
 *   job-result.
 */
export async function runTechMode(input, { requireEvent = false } = {}) {
  const started = Date.now();
  if (requireEvent) {
    let prices = null;
    try { prices = Actor.getChargingManager().getPricingInfo().perEventPrices; } catch { prices = null; }
    if (!hasTechEvent(prices)) {
      await writeRunSummary(Actor, { rows: 0, charged_events: 0, errors: 1, failure_class: 'input_error', mode: 'companies-by-technology', duration_ms: Date.now() - started });
      await Actor.fail(missingEventMessage());
      return;
    }
  }
  let opts;
  try {
    opts = normalizeTechInput(input);
  } catch (e) {
    await writeRunSummary(Actor, { errors: 1, failure_class: 'input_error', mode: 'companies-by-technology', duration_ms: Date.now() - started });
    await Actor.fail(`Invalid input: ${e.message}`);
    return;
  }
  let summary;
  try {
    summary = await runTechnographics(opts, {
      indexBaseUrl: process.env.JOBS_INDEX_URL || INDEX_BASE_URL,
      pushData: (row) => Actor.pushData(row),
      charge: (ev) => Actor.charge(ev),
      log: (m) => log.info(m),
    });
  } catch (e) {
    await writeRunSummary(Actor, { errors: 1, failure_class: e.failureClass || 'site_down', mode: 'companies-by-technology', duration_ms: Date.now() - started });
    throw e;
  }
  await writeRunSummary(Actor, { ...summary, errors: 0, failure_class: null, duration_ms: Date.now() - started });
  if (summary.stop_reason === 'charge_limit') {
    await Actor.exit({ statusMessage: `Charge limit reached after ${summary.rows} companies` });
  } else {
    const unknown = opts.unknown.length ? ` Unknown technologies ignored: ${opts.unknown.join(', ')}.` : '';
    await Actor.exit({ statusMessage: `${summary.rows} companies delivered (${summary.companies_qualified} matched).${unknown}` });
  }
}

/** Standalone Actor entry. */
export async function runTechActor() {
  await Actor.init();
  const input = (await Actor.getInput()) ?? {};
  await runTechMode(input);
}
