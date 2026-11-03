// Run-deadline guard. Apify kills a run at its timeout and marks it TIMED-OUT (a failed run in the
// Store quality score) even when most results were delivered. Long per-item loops ask
// `deadline.hasTimeFor(ms)` before starting an item and finish SUCCEEDED instead.
// Synced into each actor's src/lib/ by scripts/sync_shared.py — edit ONLY in shared/js/.

/** Parse the platform deadline from ACTOR_TIMEOUT_AT / APIFY_TIMEOUT_AT (ISO date or epoch ms). */
export function deadlineFromEnv(env = process.env) {
  const raw = env.ACTOR_TIMEOUT_AT || env.APIFY_TIMEOUT_AT;
  if (!raw) return null;
  const ms = /^\d+$/.test(String(raw)) ? Number(raw) : Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * createDeadline({ deadlineMs, now }) -> { timeLeftMs(), hasTimeFor(ms), stoppedEarly, skipped }.
 * Without a platform deadline (local runs) there is always time.
 */
export function createDeadline({ deadlineMs = deadlineFromEnv(), now = () => Date.now() } = {}) {
  const state = {
    stoppedEarly: false,
    skipped: 0,
    timeLeftMs() {
      return deadlineMs == null ? Infinity : deadlineMs - now();
    },
    /** True when `ms` (the worst-case duration of the next item plus a safety margin) still fits. */
    hasTimeFor(ms) {
      const ok = this.timeLeftMs() > ms;
      if (!ok) state.stoppedEarly = true;
      return ok;
    },
  };
  return state;
}
