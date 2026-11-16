// Pure helper (no apify import) so it is testable without node_modules.

/**
 * Per-run fee (owner decision P3, 2026-11-03): one `runFeeEvent` per run, charged only when the run delivered at
 * least one job (CLAUDE.md rule 4: charge only successful, non-empty results) and only once the event exists in the
 * Actor's Store pricing (before that the code ships dormant). Pure, exported for tests.
 */
export function shouldChargeRunFee(runFeeEvent, rows, perEventPrices) {
  return Boolean(runFeeEvent) && rows > 0 && perEventPrices != null && Object.prototype.hasOwnProperty.call(perEventPrices, runFeeEvent);
}
