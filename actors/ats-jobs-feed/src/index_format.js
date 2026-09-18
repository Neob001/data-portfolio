// Jobs-index format shared by the builder (scripts/jobs_index/build_index.mjs) and the Actor.
//
//   <base>/manifest.json         { format, built_at, boards, jobs, bytes, ats_counts, directory, shards: [...] }
//   <base>/directory.json.gz     [[ats, token, company_name, jobs, [shardIndex, ...]], ...]
//   <base>/shards/<file>.jsonl.gz one output record per line, newest posted_at first
//
// A shard holds one ATS and one posted-date band, so the Actor can skip whole shards for the
// `ats`, `postedWithinDays`, `sinceLastRun` and `companies` filters and stream the rest newest-first.
import { companyMatches } from './filters.js';

export const INDEX_FORMAT = 1;

/** Posted-date bands, in days before build time: [minAgeDays, maxAgeDays). null posted_at -> last band. */
export const AGE_BANDS = [[0, 2], [2, 4], [4, 8], [8, 15], [15, 31], [31, 61], [61, 121], [121, 366], [366, Infinity]];

export function ageBand(postedAt, builtAtMs) {
  const t = postedAt ? Date.parse(postedAt) : NaN;
  if (!Number.isFinite(t)) return AGE_BANDS.length - 1;
  const age = (builtAtMs - t) / 86400000;
  const i = AGE_BANDS.findIndex(([lo, hi]) => age >= lo && age < hi);
  return i < 0 ? 0 : i; // future-dated -> newest band
}

/** Date window [posted_from, posted_to] (YYYY-MM-DD) that a band covers for a given build time. */
export function bandWindow(band, builtAtMs) {
  const [lo, hi] = AGE_BANDS[band];
  const day = (ms) => new Date(ms).toISOString().slice(0, 10);
  return {
    posted_from: hi === Infinity ? null : day(builtAtMs - hi * 86400000),
    posted_to: band === 0 ? day(builtAtMs + 86400000) : day(builtAtMs - lo * 86400000),
  };
}

/**
 * Which shards (indices into manifest.shards) to read, newest band first.
 * @param manifest parsed manifest.json
 * @param opts normalized input (ats, postedWithinDays)
 * @param extra { since: 'YYYY-MM-DD'|null, now: ms, shardAllow: Set<number>|null }
 */
export function selectShards(manifest, opts, { since = null, now = Date.now(), shardAllow = null } = {}) {
  const ats = new Set(opts.ats || []);
  const cutoffs = [];
  if (opts.postedWithinDays) cutoffs.push(new Date(now - opts.postedWithinDays * 86400000).toISOString().slice(0, 10));
  if (since) cutoffs.push(since);
  const cutoff = cutoffs.sort().pop() || null;
  return manifest.shards
    .map((s, i) => ({ ...s, i }))
    .filter((s) => !ats.size || ats.has(s.ats))
    .filter((s) => !shardAllow || shardAllow.has(s.i))
    // A dated shard entirely older than the cutoff cannot match; undated shards stay only without cutoff.
    .filter((s) => !cutoff || (s.posted_to !== null && s.posted_to >= cutoff))
    .sort((a, b) => (a.band - b.band) || a.ats.localeCompare(b.ats) || (a.part - b.part))
    .map((s) => s.i);
}

/** companies filter -> set of shard indices holding those boards (from directory.json.gz rows). */
export function shardsForCompanies(directory, companies) {
  const allow = new Set();
  const matched = [];
  for (const [ats, token, name, , shards] of directory) {
    const probe = { ats, company_board: token, company_name: name };
    if (companies.some((c) => companyMatches(c, probe))) {
      matched.push(`${ats}:${token}`);
      for (const s of shards) allow.add(s);
    }
  }
  return { allow, matched };
}
