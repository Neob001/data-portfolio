import { Actor } from 'apify';
import { writeRunSummary } from './lib/run_summary.js';
import { loadTracker } from './lib/incremental.js';
import { createGdeltFetcher } from './client.js';
import { runMonitor } from './monitor.js';

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const {
  queries = ['"OpenAI"', '"supply chain" recall'],
  mode = 'news',
  languages = [],
  countries = [],
  domains = [],
  lookbackHours = 24,
  sinceLastRun = false,
  maxResultsPerQuery = 100,
} = input;

if (!Array.isArray(queries) || queries.length === 0) {
  throw new Error('At least one query is required.');
}
if (mode !== 'news' && mode !== 'adverse_media') {
  throw new Error('mode must be "news" or "adverse_media".');
}

// One shared, throttled fetcher for the whole run: GDELT asks for one request per 5 seconds
// regardless of how many queries/windows this run makes.
const fetchGdelt = createGdeltFetcher();

let pushed = 0;
let charged = 0;

try {
  const results = await runMonitor(
    { queries, mode, languages, countries, domains, lookbackHours, sinceLastRun, maxResultsPerQuery },
    {
      fetchGdelt,
      pushData: (row) => Actor.pushData(row),
      charge: () => Actor.charge({ eventName: 'article-result' }),
      openTracker: (filters) => loadTracker(Actor, 'news-monitor', filters),
    },
  );
  pushed = results.reduce((n, r) => n + r.pushed, 0);
  charged = results.reduce((n, r) => n + r.charged, 0);
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
