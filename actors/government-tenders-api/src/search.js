// Scan the selected shards and return the best `maxResults` matches (no Apify SDK here, so tests can run it).
import { readShard } from './index_reader.js';
import { selectShards, keywordScorer, recordMatcher, comparator, topN, toRow } from './tenders.js';

/** Incremental key of a notice: the day our nightly index first read it (late-published notices still count as new). */
export const firstSeenDay = (r) => String(r.fetched_at || r.published_at).slice(0, 10);

/**
 * @param {{ base: string, manifest: object, o: object, tracker?: object, now?: number }} p
 *   tracker: shared incremental tracker keyed on (firstSeenDay, notice_id); its `since` skips shards and
 *   notices first indexed before that day.
 * @returns {{ rows: object[], matched: number, shardsRead: number, shardsTotal: number }}
 */
export async function search({ base, manifest, o, tracker = null, now = Date.now() }) {
  const since = tracker?.since ? `${tracker.since}T00:00:00Z` : null;
  const shards = selectShards(manifest, o, { now }).filter((s) => !since || !s.fetched_max || s.fetched_max >= since);
  const score = keywordScorer(o);
  const matches = recordMatcher(o, now);
  const best = topN(o.maxResults, comparator(o.sortBy));
  for (const s of shards) {
    for await (const r of readShard(base, s.file)) {
      if (since && r.fetched_at && r.fetched_at < since) continue;
      if (!matches(r)) continue;
      const sc = score(r);
      if (!sc) continue;
      if (tracker && tracker.isDuplicate(firstSeenDay(r), r.notice_id)) continue;
      best.push({ r, score: sc });
    }
  }
  return { rows: best.result().map((x) => toRow(x.r)), matched: best.total, shardsRead: shards.length, shardsTotal: (manifest.shards || []).length };
}
