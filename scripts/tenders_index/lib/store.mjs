// Rolling per-source record store kept between nights (state/records/<source>.jsonl.gz, restored from the
// Actions cache), plus the retention rule and the cross-source dedupe. Pure except load/save.
import { createReadStream, createWriteStream, existsSync, mkdirSync } from 'node:fs';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { join } from 'node:path';
import { deriveStatus } from './normalize.mjs';

const DAY = 86400000;

export class SourceStore {
  constructor(source) {
    this.source = source;
    this.map = new Map();
    this.loadedFromState = false;
  }

  /** Insert or refresh a notice. fetched_at keeps the night the index first read it (the Actor's sinceLastRun key). */
  upsert(rec, prevMap = this.map) {
    const prev = prevMap.get(rec.notice_id);
    if (prev?.fetched_at && prev.fetched_at < rec.fetched_at) rec.fetched_at = prev.fetched_at;
    this.map.set(rec.notice_id, rec);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }

  values() {
    return this.map.values();
  }

  async load(dir) {
    const f = join(dir, `${this.source}.jsonl.gz`);
    if (!existsSync(f)) return 0;
    const rl = createInterface({ input: createReadStream(f).pipe(createGunzip()), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      try {
        const r = JSON.parse(line);
        this.map.set(r.notice_id, r);
      } catch { /* a torn line from an interrupted save is skipped */ }
    }
    this.loadedFromState = true;
    return this.map.size;
  }

  async save(dir) {
    mkdirSync(dir, { recursive: true });
    const gz = createGzip({ level: 6 });
    const out = createWriteStream(join(dir, `${this.source}.jsonl.gz`));
    gz.pipe(out);
    for (const r of this.map.values()) {
      if (!gz.write(`${JSON.stringify(r)}\n`)) await once(gz, 'drain');
    }
    gz.end();
    await once(out, 'finish');
  }
}

/**
 * Retention: every notice published in the last `windowDays`, plus older planning/tender notices that are
 * still open (deadline in the future). Statuses are re-derived for `now` (open tenders close overnight).
 */
export function retain(rec, { now, windowDays }) {
  const pub = Date.parse(rec.published_at);
  if (!Number.isFinite(pub) || pub > now + 2 * DAY) return false;
  if (rec.deadline_at && rec.status !== 'cancelled' && (rec.notice_type === 'tender' || rec.notice_type === 'planning')) {
    rec.status = deriveStatus(rec, null, now);
  }
  if (pub >= now - windowDays * DAY) return true;
  return (rec.notice_type === 'tender' || rec.notice_type === 'planning') && Boolean(rec.deadline_at) && Date.parse(rec.deadline_at) > now
    && pub >= now - 730 * DAY;
}

// TED English titles read "Country – CPV label – original title"; national platforms carry only the original.
const titleCore = (t) => String(t || '').split(' – ').pop().toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 80);
const buyerCore = (b) => String(b || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 40);

export const SOURCE_PRIORITY = ['ted', 'uk-fts', 'uk-cf', 'sam'];
const rank = (s) => {
  const i = SOURCE_PRIORITY.indexOf(s);
  return i === -1 ? SOURCE_PRIORITY.length : i;
};
const filled = (r) => Object.values(r).filter((v) => v !== null && !(Array.isArray(v) && v.length === 0)).length;

export function dedupeKey(r) {
  const t = titleCore(r.title);
  if (t.length < 12 || !r.buyer_name) return null; // too generic to merge safely
  return `${r.buyer_country || r.country_code}|${r.notice_type}|${String(r.published_at).slice(0, 10)}|${buyerCore(r.buyer_name)}|${t}`;
}

/**
 * The same notice published on two platforms (e.g. an above-threshold German tender on TED and on
 * oeffentlichevergabe.de) is kept once: same buyer country, notice type, publication day, buyer and title.
 * Keeps the more complete copy (ties: SOURCE_PRIORITY). Returns { kept: Set(notice_id), duplicates }.
 */
export function crossSourceDedupe(records) {
  const best = new Map();
  let duplicates = 0;
  for (const r of records) {
    const k = dedupeKey(r);
    if (!k) continue;
    const prev = best.get(k);
    if (!prev) { best.set(k, r); continue; }
    if (prev.source === r.source) continue; // within one source, distinct notices may share a title
    duplicates += 1;
    const better = filled(r) > filled(prev) || (filled(r) === filled(prev) && rank(r.source) < rank(prev.source));
    if (better) best.set(k, r);
  }
  const drop = new Set();
  for (const r of records) {
    const k = dedupeKey(r);
    if (!k) continue;
    const b = best.get(k);
    if (b !== r && b.source !== r.source) drop.add(r.notice_id);
  }
  return { drop, duplicates };
}
