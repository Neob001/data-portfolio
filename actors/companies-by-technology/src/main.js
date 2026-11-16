// Companies by technology: one row per company whose open job posts name the requested technologies.
// All logic lives in the shared jobs core (src/core/technographics.js, synced by scripts/sync_jobs_core.py).
import { runTechActor } from './core/tech_actor_main.js';

await runTechActor();
