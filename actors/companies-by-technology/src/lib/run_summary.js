// Shared run-summary emitter: writes machine-readable health signals to the
// default key-value store so scripts/health.py can read them without a model.
// Synced into each actor's src/lib/ by scripts/sync_shared.py — edit ONLY in shared/js/.

export async function writeRunSummary(Actor, summary) {
  const full = {
    rows: 0,
    charged_events: 0,
    errors: 0,
    failure_class: null,
    duration_ms: null,
    ...summary,
    finished_at: new Date().toISOString(),
  };
  await Actor.setValue('RUN_SUMMARY', full);
  await Actor.setStatusMessage(
    `rows=${full.rows} charged=${full.charged_events} errors=${full.errors}` +
      (full.failure_class ? ` failure=${full.failure_class}` : ''),
  );
  return full;
}
