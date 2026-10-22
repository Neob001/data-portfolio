// Career Page Jobs Scraper: company websites / careers pages -> job platform -> every open job.
// Discovery and detection: src/transform.js + src/scrape.js; job rows: the shared jobs core (src/core/).
import { Actor, log } from 'apify';
import { writeRunSummary } from './lib/run_summary.js';
import { runCompanies } from './scrape.js';

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};

const urls = Array.isArray(input.companyUrls) ? input.companyUrls.filter((u) => String(u ?? '').trim()) : [];
if (urls.length === 0) {
  await writeRunSummary(Actor, { rows: 0, errors: 1, failure_class: 'input_error', duration_ms: Date.now() - started });
  await Actor.exit({ statusMessage: 'No company URLs in input: add company websites, careers pages or job-board URLs to "companyUrls".' });
}

let summary;
try {
  summary = await runCompanies(input, {
    pushData: (row) => Actor.pushData(row),
    charge: (ev) => Actor.charge(ev),
    log: (m) => log.info(m),
  });
} catch (e) {
  // Only a bug gets here: every company-level problem becomes an explanatory row instead.
  await writeRunSummary(Actor, { errors: 1, failure_class: e.failureClass || 'unknown', duration_ms: Date.now() - started });
  throw e;
}

await writeRunSummary(Actor, {
  rows: summary.rows + summary.info_rows,
  charged_events: summary.charged_events,
  errors: summary.boards_failed,
  duration_ms: Date.now() - started,
  companies: summary.companies,
  companies_with_jobs: summary.companies_with_jobs,
  job_rows: summary.rows,
  info_rows: summary.info_rows,
  reasons: summary.reasons,
  platforms: summary.platforms,
  pages_fetched: summary.pages_fetched,
  stop_reason: summary.stop_reason,
  results: summary.results.slice(0, 100),
});
const misses = summary.companies - summary.companies_with_jobs;
const tail = misses ? `; ${misses} without jobs (explained in the "reason" field, not charged)` : '';
const msg = summary.stop_reason === 'charge_limit'
  ? `Charge limit reached after ${summary.rows} jobs`
  : `${summary.rows} jobs from ${summary.companies_with_jobs} of ${summary.companies} companies${tail}${summary.stop_reason === 'time_limit' ? ' (time limit reached)' : ''}`;
await Actor.exit({ statusMessage: msg });
