import { runJobsActor } from './core/actor_main.js';

// P3 (2026-11-03): $0.01 per run that delivers >= 1 job; dormant until the event is added to the Store pricing.
await runJobsActor({ slug: 'ats-jobs-feed', runFeeEvent: 'run-with-results' });
