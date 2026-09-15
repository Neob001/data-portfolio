// Shared incremental-mode state ("only new results since last run").
// Synced into each actor's src/lib/ by scripts/sync_shared.py — edit ONLY in shared/js/.
//
// Cursors must live in a NAMED key-value store: every run gets a fresh default store, so a
// cursor saved there is lost and the next run re-delivers (and re-charges) the same records.
// A named store persists in the account of whoever runs the Actor.
//
// Many sources are not sorted by date, so a run cut short by maxResults or the charge limit
// cannot advance a date watermark without silently skipping undelivered records. Truncated
// runs therefore keep their start date and remember every delivered ID; only a complete run
// moves the watermark forward.

const MAX_IDS = 20000;

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

export function createTracker(cursor) {
  const complete = cursor ? cursor.complete !== false : true;
  const lastDate = cursor?.last_date || null;
  const knownIds = new Set((cursor?.ids || cursor?.ids_on_last_date || []).map(String));
  const deliveredIds = [];
  const deliveredSet = new Set();
  let maxSeenDate = null;
  let maxDeliveredDate = null;

  return {
    /** Date to request from the source (inclusive), or null to query without a lower bound. */
    since: cursor ? (complete ? lastDate : cursor.since ?? null) : null,

    /** True when this record was delivered before (previous runs or earlier in this run). */
    isDuplicate(date, id) {
      if (date && (!maxSeenDate || date > maxSeenDate)) maxSeenDate = date;
      const key = String(id);
      if (knownIds.has(key) || deliveredSet.has(key)) return true;
      return Boolean(complete && lastDate && date && date < lastDate);
    },

    /** Call for every record actually delivered. */
    observe(date, id) {
      const key = String(id);
      if (deliveredSet.has(key)) return;
      deliveredSet.add(key);
      deliveredIds.push({ key, date });
      if (date && (!maxDeliveredDate || date > maxDeliveredDate)) maxDeliveredDate = date;
    },

    /**
     * Cursor to persist, or null to keep the previous one unchanged.
     * @param {{truncated: boolean, runSince: string|null}} opts runSince = lower bound this run queried with
     */
    next({ truncated, runSince }) {
      if (truncated) {
        return {
          complete: false,
          since: cursor && !complete ? cursor.since ?? runSince : runSince,
          last_date: [lastDate, maxDeliveredDate].filter(Boolean).sort().pop() || null,
          ids: [...knownIds, ...deliveredIds.map((d) => d.key)].slice(-MAX_IDS),
        };
      }
      const newest = [lastDate, maxSeenDate, maxDeliveredDate].filter(Boolean).sort().pop() || null;
      if (!newest) return cursor ? null : null;
      if (complete && deliveredIds.length === 0 && newest === lastDate) return null;
      // Complete run: keep only IDs on the new boundary date (the date is re-read next time).
      const prevBoundary = complete && lastDate === newest ? [...knownIds] : [];
      const boundary = deliveredIds.filter((d) => d.date === newest).map((d) => d.key);
      const carriedFromIncomplete = !complete ? [...knownIds] : [];
      return {
        complete: true,
        last_date: newest,
        ids: [...new Set([...prevBoundary, ...carriedFromIncomplete, ...boundary])].slice(-MAX_IDS),
      };
    },
  };
}

export async function loadTracker(Actor, actorSlug, filters) {
  const store = await Actor.openKeyValueStore(storeNameFor(actorSlug));
  const key = cursorKeyFor(filters);
  const tracker = createTracker(await store.getValue(key));
  return {
    tracker,
    async save(opts) {
      const next = tracker.next(opts);
      if (next) await store.setValue(key, next);
    },
  };
}
