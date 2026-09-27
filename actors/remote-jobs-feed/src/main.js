import { runJobsActor } from './core/actor_main.js';
import { toFeedOptions } from './remote.js';

await runJobsActor({ slug: 'remote-jobs-feed', toOptions: toFeedOptions });
