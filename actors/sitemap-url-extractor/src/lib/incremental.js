// Shared incremental-mode state ("only new results since last run").
// Synced into each actor's src/lib/ by scripts/sync_shared.py — edit ONLY in shared/js/.
//
// Cursors must live in a NAMED key-value store: every run gets a fresh default store, so a
// cursor saved there is lost and the next run re-delivers (and re-charges) the same records.
// A named store persists in the account of whoever runs the Actor.

const MAX_BOUNDARY_IDS = 5000;

export function storeNameFor(actorSlug) {
  return `factpipe-${actorSlug}-state`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 63);
}

/** Filters -> stable, valid key-value store key (a-zA-Z0-9!-_.'(), max 256). */
export function cursorKeyFor(filters) {
  const raw = JSON.stringify(filters ?? {});
  let h = 0;
  for (let i = 0; i < raw.length; i += 1) h = (Math.imul(31, h) + raw.charCodeAt(i)) | 0;
  const readable = raw.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 120);
  return `CURSOR-${readable || 'all'}-${(h >>> 0).toString(36)}`;
}

/**
 * Tracks the newest date seen and the IDs delivered on that date, so a later run can re-read
 * the boundary date (sources publish more records during the day) without duplicates.
 */
export function createTracker(cursor) {
  const lastDate = cursor?.last_date || null;
  const boundaryIds = new Set(cursor?.ids_on_last_date || []);
  let newestDate = null;
  let newestIds = [];
  return {
    /** Date to request from the source (inclusive), or null when there is no cursor. */
    since: lastDate,
    /** True when this record was already delivered by a previous run. */
    isDuplicate(date, id) {
      if (!lastDate || !date) return false;
      if (date < lastDate) return true;
      return date === lastDate && boundaryIds.has(String(id));
    },
    /** Call for every record actually delivered. */
    observe(date, id) {
      if (!date) return;
      if (!newestDate || date > newestDate) { newestDate = date; newestIds = []; }
      if (date === newestDate && newestIds.length < MAX_BOUNDARY_IDS) newestIds.push(String(id));
    },
    /** Cursor to persist, or null when nothing new was delivered (keep the old cursor). */
    next() {
      if (!newestDate) return null;
      const carry = newestDate === lastDate ? [...boundaryIds, ...newestIds] : newestIds;
      return { last_date: newestDate, ids_on_last_date: [...new Set(carry)].slice(-MAX_BOUNDARY_IDS) };
    },
  };
}

export async function loadTracker(Actor, actorSlug, filters) {
  const store = await Actor.openKeyValueStore(storeNameFor(actorSlug));
  const key = cursorKeyFor(filters);
  const tracker = createTracker(await store.getValue(key));
  return {
    tracker,
    async save() {
      const next = tracker.next();
      if (next) await store.setValue(key, next);
    },
  };
}
