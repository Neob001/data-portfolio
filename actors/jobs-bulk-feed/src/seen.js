// Incremental state for whole-index delivery: "every job this Actor has not delivered before for the same
// filters", at 1M-job scale.
//
// Why not shared/js/incremental.js (the core tracker the search Actors use)? It keeps a posting-date watermark
// plus at most 20,000 delivered ids. A bulk run delivers 100,000+ jobs, so a run cut short by maxResults or the
// charge limit would forget most of what it delivered and re-deliver (re-charge) it next time; and a date
// watermark skips jobs that join the index with an older posting date (a newly validated board, a Workday site
// whose older jobs move into its newest 500). This set stores a 52-bit hash of every delivered job_id instead
// (8 bytes + a 2-byte "last seen" day each, ~10 MB per million jobs) in the same NAMED key-value store pattern
// (factpipe-<slug>-state, one cursor key per filter set).
//
// Pruning: only after a COMPLETE run (every shard read, nothing cut short) are ids dropped, and only those that
// have not matched the filters in the index for GRACE_DAYS (a board missing from one nightly build must not
// make its jobs "new" again the next day). Truncated runs never prune.
import { createHash } from 'node:crypto';
import { storeNameFor, cursorKeyFor } from './lib/incremental.js';

export const SEEN_FORMAT = 1;
export const GRACE_DAYS = 14;
// Entries per stored record: 400k x 10 bytes = 4 MB, well under Apify's key-value record limits.
export const CHUNK_ENTRIES = 400000;

/** job_id -> 52-bit integer hash (exact in a float64). Collision odds per new job vs 1M stored ~2e-10. */
export function idHash(id) {
  const b = createHash('sha1').update(String(id)).digest();
  return b.readUInt32BE(0) * 1048576 + (b.readUInt32BE(4) >>> 12);
}

/** Epoch ms -> day number (fits a Uint16 until 2149). */
export const dayOf = (ms) => Math.floor(ms / 86400000);

export class SeenSet {
  /** @param hashes sorted ascending, unique  @param days last day each hash matched the filters in the index */
  constructor(hashes = new Float64Array(0), days = new Uint16Array(0)) {
    if (hashes.length !== days.length) throw new Error('seen-set arrays differ in length');
    this.hashes = hashes;
    this.days = days;
    this.present = new Uint8Array(hashes.length);
    this.added = [];
  }

  get size() { return this.hashes.length; }

  indexOf(h) {
    let lo = 0;
    let hi = this.hashes.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >>> 1;
      const v = this.hashes[mid];
      if (v === h) return mid;
      if (v < h) lo = mid + 1; else hi = mid - 1;
    }
    return -1;
  }

  /** True when an earlier run delivered this job (and remembers that it is still in the index). */
  seen(h) {
    const i = this.indexOf(h);
    if (i < 0) return false;
    this.present[i] = 1;
    return true;
  }

  /** Record a job delivered in this run. */
  add(h) { this.added.push(h); }

  /**
   * Set to persist after the run. complete: every shard was read and the run was not cut short (only then
   * can an id that did not match be pruned). today: day number of the index build.
   */
  next({ complete, today }) {
    const added = Float64Array.from(this.added).sort();
    const outH = new Float64Array(this.hashes.length + added.length);
    const outD = new Uint16Array(outH.length);
    let n = 0;
    let i = 0;
    let j = 0;
    const push = (h, d) => {
      if (n && outH[n - 1] === h) { outD[n - 1] = Math.max(outD[n - 1], d); return; }
      outH[n] = h;
      outD[n] = d;
      n += 1;
    };
    while (i < this.hashes.length || j < added.length) {
      if (j >= added.length || (i < this.hashes.length && this.hashes[i] <= added[j])) {
        const keepDay = this.present[i] ? today : this.days[i];
        if (!complete || this.present[i] || today - this.days[i] <= GRACE_DAYS) push(this.hashes[i], keepDay);
        i += 1;
      } else {
        push(added[j], today);
        j += 1;
      }
    }
    return new SeenSet(outH.slice(0, n), outD.slice(0, n));
  }

  /** -> Buffers of at most CHUNK_ENTRIES entries: [float64 LE hashes][uint16 LE days]. */
  toChunks(chunkEntries = CHUNK_ENTRIES) {
    const out = [];
    for (let s = 0; s < this.hashes.length || (s === 0 && out.length === 0); s += chunkEntries) {
      const h = this.hashes.subarray(s, s + chunkEntries);
      const d = this.days.subarray(s, s + chunkEntries);
      const buf = Buffer.alloc(h.length * 10);
      for (let k = 0; k < h.length; k += 1) {
        buf.writeDoubleLE(h[k], k * 8);
        buf.writeUInt16LE(d[k], h.length * 8 + k * 2);
      }
      out.push(buf);
      if (!h.length) break;
    }
    return out;
  }

  static fromChunks(buffers) {
    const total = buffers.reduce((a, b) => a + b.length / 10, 0);
    const hashes = new Float64Array(total);
    const days = new Uint16Array(total);
    let n = 0;
    for (const buf of buffers) {
      if (buf.length % 10) throw new Error('corrupt seen-set chunk');
      const len = buf.length / 10;
      for (let k = 0; k < len; k += 1) {
        hashes[n + k] = buf.readDoubleLE(k * 8);
        days[n + k] = buf.readUInt16LE(len * 8 + k * 2);
      }
      n += len;
    }
    for (let k = 1; k < total; k += 1) if (!(hashes[k] > hashes[k - 1])) throw new Error('corrupt seen-set: hashes not sorted');
    return new SeenSet(hashes, days);
  }
}

/**
 * Load the seen set of one filter set from a key-value store ({ getValue, setValue }), or an empty one.
 * A missing chunk is an error, not an empty set: an empty set would re-deliver (and re-charge) everything.
 * -> { seen, key, meta, save({ complete, today, indexBuiltAt }) }
 */
export async function loadSeen(store, filters) {
  const key = cursorKeyFor(filters);
  const meta = await store.getValue(key);
  let seen = new SeenSet();
  if (meta) {
    if (meta.format !== SEEN_FORMAT) throw new Error(`incremental state ${key} has unknown format ${meta.format}`);
    const bufs = await Promise.all(Array.from({ length: meta.chunks }, (_, i) => store.getValue(`${key}-g${meta.gen}-${i}`)));
    const missing = bufs.findIndex((b) => !b);
    if (missing >= 0) {
      throw new Error(`incremental state ${key} is incomplete (chunk ${missing} of generation ${meta.gen} missing). `
        + `Delete the key ${key} in the "${storeNameFor('jobs-bulk-feed')}" key-value store to start over, or run with sinceLastRun: false`);
    }
    seen = SeenSet.fromChunks(bufs.map((b) => Buffer.from(b)));
  }
  return {
    seen,
    key,
    meta,
    /** Write the next generation's chunks, then the meta record (the switch), then drop the old chunks. */
    async save({ complete, today, indexBuiltAt = null }) {
      const next = seen.next({ complete, today });
      const chunks = next.toChunks();
      const gen = (meta?.gen || 0) + 1;
      for (let i = 0; i < chunks.length; i += 1) await store.setValue(`${key}-g${gen}-${i}`, chunks[i], { contentType: 'application/octet-stream' });
      await store.setValue(key, {
        format: SEEN_FORMAT, gen, chunks: chunks.length, count: next.size, complete, index_built_at: indexBuiltAt, saved_at: new Date().toISOString(),
      });
      if (meta) for (let i = 0; i < meta.chunks; i += 1) await store.setValue(`${key}-g${meta.gen}-${i}`, null);
      return { count: next.size, chunks: chunks.length };
    },
  };
}
