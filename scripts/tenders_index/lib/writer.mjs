// Shard writer: records grouped by (source, publication-age band), newest first, cut into parts of
// <= maxRawBytes, brotli (or gzip) compressed. The manifest describes each shard well enough for the
// Actor to skip it (source, countries, notice types, open count, publication window, latest deadline).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';

export const INDEX_FORMAT = 1;
// [from, to) days before built_at.
export const AGE_BANDS = [[0, 3], [3, 8], [8, 32], [32, 92], [92, Infinity]];
const DAY = 86400000;

export function ageBand(publishedAt, builtAtMs) {
  const age = (builtAtMs - Date.parse(publishedAt)) / DAY;
  const i = AGE_BANDS.findIndex(([lo, hi]) => age < hi && age >= lo);
  return i === -1 ? (age < 0 ? 0 : AGE_BANDS.length - 1) : i;
}

export function compress(buf, codec) {
  if (codec === 'gz') return zlib.gzipSync(buf, { level: 9 });
  return zlib.brotliCompressSync(buf, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 9, // q9: ~10x faster than q11 for a few % more bytes (keeps the nightly job well under 60 min)
      [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    },
  });
}

const count = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const obj = (m) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]));

/**
 * @param records iterable of normalized records (already retained + deduped)
 * @returns manifest (also written to outDir/manifest.json)
 */
export function writeIndex(records, { outDir, builtAt, codec = 'br', maxRawBytes = 24 * 1048576, extra = {} }) {
  rmSync(join(outDir, 'shards'), { recursive: true, force: true });
  mkdirSync(join(outDir, 'shards'), { recursive: true });
  const builtAtMs = Date.parse(builtAt);
  const groups = new Map();
  const bySource = new Map();
  const byCountry = new Map();
  const byType = new Map();
  const byStatus = new Map();
  let total = 0;
  for (const r of records) {
    const k = `${r.source}|${ageBand(r.published_at, builtAtMs)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
    count(bySource, r.source);
    count(byCountry, r.country_code || 'unknown');
    count(byType, r.notice_type);
    count(byStatus, r.status);
    total += 1;
  }
  const ext = codec === 'gz' ? 'gz' : 'br';
  const shards = [];
  let bytes = 0;
  const keys = [...groups.keys()].map((k) => k.split('|')).sort((a, b) => Number(a[1]) - Number(b[1]) || a[0].localeCompare(b[0]));
  for (const [source, bandStr] of keys) {
    const band = Number(bandStr);
    const recs = groups.get(`${source}|${band}`).sort((a, b) => (b.published_at > a.published_at ? 1 : b.published_at < a.published_at ? -1 : (a.notice_id < b.notice_id ? -1 : 1)));
    let part = 0;
    let chunk = [];
    let raw = 0;
    const flush = () => {
      if (!chunk.length) return;
      const body = Buffer.from(chunk.map((r) => JSON.stringify(r)).join('\n') + '\n');
      const packed = compress(body, codec);
      const file = `shards/${source}-b${band}-p${part}.jsonl.${ext}`;
      writeFileSync(join(outDir, file), packed);
      const countries = [...new Set(chunk.map((r) => r.country_code).filter(Boolean))].sort();
      const types = [...new Set(chunk.map((r) => r.notice_type))].sort();
      const deadlines = chunk.map((r) => r.deadline_at).filter(Boolean).sort();
      shards.push({
        file, source, band, part, notices: chunk.length, open: chunk.filter((r) => r.status === 'open').length,
        bytes: packed.length, raw_bytes: body.length, countries, notice_types: types,
        published_from: chunk[chunk.length - 1].published_at, published_to: chunk[0].published_at,
        deadline_max: deadlines[deadlines.length - 1] || null,
        fetched_max: chunk.reduce((m, r) => (r.fetched_at > m ? r.fetched_at : m), ''),
      });
      bytes += packed.length;
      part += 1;
      chunk = [];
      raw = 0;
    };
    for (const r of recs) {
      const len = JSON.stringify(r).length + 1;
      if (raw + len > maxRawBytes) flush();
      chunk.push(r);
      raw += len;
    }
    flush();
  }
  const manifest = {
    format: INDEX_FORMAT, codec: ext === 'gz' ? 'gzip' : 'brotli', built_at: builtAt, notices: total, bytes,
    source_counts: obj(bySource), country_counts: obj(byCountry), notice_type_counts: obj(byType), status_counts: obj(byStatus),
    age_bands_days: AGE_BANDS.map(([lo, hi]) => [lo, hi === Infinity ? null : hi]),
    ...extra, shards,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 1));
  return manifest;
}
