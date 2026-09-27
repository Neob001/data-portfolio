import { runJobsActor } from './core/actor_main.js';
import { toScraperOptions } from './scraper.js';

await runJobsActor({ slug: 'ats-jobs-scraper', toOptions: toScraperOptions });
