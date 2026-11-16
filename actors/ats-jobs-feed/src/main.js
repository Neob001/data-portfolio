import { runJobsActor } from './core/actor_main.js';

// P3 (2026-11-03): $0.01 per run that delivers >= 1 job; dormant until the event is added to the Store pricing.
// S-2 (2026-11-17): `mode: "companies-by-technology"`; fails fast, charging nothing, until the Store pricing has the
// company-result event (company rows are never charged as job-result).
await runJobsActor({ slug: 'ats-jobs-feed', runFeeEvent: 'run-with-results', modes: true });
