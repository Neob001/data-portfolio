// Writes the slim, sharded jobs search index (format v2: see index_format.js).
// Used by scripts/jobs_index/build_index.mjs and by the tests (tiny index in a temp dir).
// Memory stays bounded: every slim record is streamed to a temp file first; only a small dedupe
// map (key -> winner id) is held for the whole corpus, and one (ATS, date band) group at a time.
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { gzipSync, brotliCompressSync, constants as Z } from 'node:zlib';
import { join } from 'node:path';
import { dedupeKey, dedupeLite, preferLite, boardKey } from './transform.js';
import { factorBoardKeywords } from './keywords.js';
import { ageBand, bandWindow, AGE_BANDS, INDEX_FORMAT, SLIM_FIELDS, defaultApplyUrl } from './index_format.js';

export const SHARD_MAX_BYTES = 5 * 1024 * 1024; // hard cap per compressed shard
const RAW_CHUNK = { br: 32 * 1024 * 1024, gz: 16 * 1024 * 1024 }; // raw JSONL per shard before compression

export function compress(buf, codec) {
  if (codec === 'gz') return gzipSync(buf, { level: 9 });
  return brotliCompressSync(buf, {
    params: {
      [Z.BROTLI_PARAM_QUALITY]: 11,
      [Z.BROTLI_PARAM_LGWIN]: 24, // 16 MB window: repeated company text across a board's postings compresses away
      [Z.BROTLI_PARAM_SIZE_HINT]: buf.length,
      [Z.BROTLI_PARAM_MODE]: Z.BROTLI_MODE_TEXT,
    },
  });
}

function writeLine(stream, line) {
  if (stream.write(`${line}\n`)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onError = (e) => { stream.off('drain', onDrain); reject(e); };
    const onDrain = () => { stream.off('error', onError); resolve(); };
    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}
const endStream = (s) => new Promise((resolve, reject) => { s.end(resolve); s.once('error', reject); });

async function* readLines(path) {
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) if (line) yield line;
}

/** Full output record (+ kw) -> slim index record: searchable fields only, derivable fields omitted. */
export function slimRecord(job, kw) {
  const r = {};
  for (const k of SLIM_FIELDS) if (job[k] !== undefined) r[k] = job[k];
  if (r.apply_url === defaultApplyUrl(job.ats, job.job_url)) delete r.apply_url;
  r.kw = kw;
  return r;
}

export class IndexWriter {
  /** @param outDir index output directory  @param opts { builtAt: Date, tmpDir?, codec: 'br'|'gz' } */
  constructor(outDir, { builtAt = new Date(), tmpDir = null, codec = 'br' } = {}) {
    this.outDir = outDir;
    this.tmpDir = tmpDir || join(outDir, '.tmp');
    this.builtAt = builtAt;
    this.codec = codec;
    this.best = new Map(); // dedupe key -> { lite, dups: [] }
    this.boards = new Map(); // boardKey -> { ats, token, region, name, kw, fetched_at }
    this.rawJobs = 0;
    this.raw = null;
  }

  async open() {
    await rm(this.outDir, { recursive: true, force: true });
    await mkdir(join(this.outDir, 'shards'), { recursive: true });
    await mkdir(this.tmpDir, { recursive: true });
    this.raw = createWriteStream(join(this.tmpDir, 'raw.jsonl'));
    return this;
  }

  /** Add one board's normalized jobs (full output records incl. description_text / fetched_at). */
  async addBoard(board, companyName, jobs) {
    const bk = boardKey(board);
    const { boardKw, jobKw } = factorBoardKeywords(jobs);
    this.boards.set(bk, {
      ats: board.ats, token: board.token, region: board.region || null, name: companyName || board.token,
      kw: boardKw, fetched_at: jobs[0]?.fetched_at || this.builtAt.toISOString(),
    });
    for (let i = 0; i < jobs.length; i += 1) {
      const job = jobs[i];
      const key = dedupeKey(job);
      const lite = dedupeLite(job);
      const cur = this.best.get(key);
      if (!cur) {
        this.best.set(key, { lite, dups: [] });
      } else {
        const win = preferLite(cur.lite, lite);
        cur.dups.push(win === lite ? cur.lite.job_id : lite.job_id);
        cur.lite = win;
      }
      await writeLine(this.raw, JSON.stringify({ bk, key, rec: slimRecord(job, jobKw[i]) }));
      this.rawJobs += 1;
    }
  }

  /** Dedupe, group by (ATS, posted-date band), order by board, shard, compress, write manifest. */
  async finish() {
    await endStream(this.raw);
    const builtAtMs = this.builtAt.getTime();
    const groups = new Map();
    const groupPath = (ats, band) => join(this.tmpDir, `g-${ats}-${band}.jsonl`);
    let kept = 0;
    for await (const line of readLines(join(this.tmpDir, 'raw.jsonl'))) {
      const { bk, key, rec } = JSON.parse(line);
      const entry = this.best.get(key);
      if (!entry || entry.lite.job_id !== rec.job_id || entry.done) continue;
      entry.done = true;
      const dups = [...new Set(entry.dups)].filter((id) => id !== rec.job_id).sort();
      if (dups.length) rec.duplicate_sources = dups;
      const band = ageBand(rec.posted_at, builtAtMs);
      const gk = `${rec.ats}|${band}`;
      if (!groups.has(gk)) groups.set(gk, createWriteStream(groupPath(rec.ats, band)));
      await writeLine(groups.get(gk), JSON.stringify({ bk, rec }));
      kept += 1;
    }
    for (const s of groups.values()) await endStream(s);

    const shards = [];
    const boardShards = new Map();
    const boardCounts = new Map();
    const atsCounts = {};
    let totalBytes = 0;
    const ext = this.codec === 'gz' ? 'gz' : 'br';
    const order = [...groups.keys()].map((k) => k.split('|')).map(([ats, band]) => [ats, Number(band)])
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
    for (const [ats, band] of order) {
      const rows = [];
      for await (const line of readLines(groupPath(ats, band))) {
        const { bk, rec } = JSON.parse(line);
        rows.push({ bk, p: rec.posted_at || '', id: rec.job_id, line: JSON.stringify(rec) });
      }
      // Board-contiguous order lets the compressor fold a company's repeated text; the Actor sorts
      // each shard's matches by posted_at before delivering.
      rows.sort((a, b) => a.bk.localeCompare(b.bk) || b.p.localeCompare(a.p) || a.id.localeCompare(b.id));
      const win = bandWindow(band, builtAtMs);
      let part = 0;
      const writeChunk = async (chunk) => {
        const header = { _boards: {} };
        for (const r of chunk) {
          if (header._boards[r.bk]) continue;
          const b = this.boards.get(r.bk);
          header._boards[r.bk] = { t: b.token, ...(b.region ? { r: b.region } : {}), f: b.fetched_at, kw: b.kw };
        }
        const body = Buffer.from(`${JSON.stringify(header)}\n${chunk.map((r) => r.line).join('\n')}\n`);
        const packed = compress(body, this.codec);
        if (packed.length > SHARD_MAX_BYTES && chunk.length > 1) {
          const mid = Math.ceil(chunk.length / 2);
          await writeChunk(chunk.slice(0, mid));
          await writeChunk(chunk.slice(mid));
          return;
        }
        const file = `shards/${ats}-b${band}-p${part}.jsonl.${ext}`;
        await writeFile(join(this.outDir, file), packed);
        const idx = shards.length;
        const dates = chunk.map((r) => r.p).filter(Boolean).sort();
        shards.push({
          file, ats, band, part, jobs: chunk.length, bytes: packed.length, raw_bytes: body.length,
          posted_from: win.posted_from, posted_to: win.posted_to,
          newest: dates[dates.length - 1] || null, oldest: dates[0] || null,
        });
        for (const r of chunk) {
          if (!boardShards.has(r.bk)) boardShards.set(r.bk, new Set());
          boardShards.get(r.bk).add(idx);
          boardCounts.set(r.bk, (boardCounts.get(r.bk) || 0) + 1);
        }
        part += 1;
        totalBytes += packed.length;
        atsCounts[ats] = (atsCounts[ats] || 0) + chunk.length;
      };
      let chunk = [];
      let size = 0;
      for (const r of rows) {
        chunk.push(r);
        size += r.line.length + 1;
        if (size >= RAW_CHUNK[this.codec === 'gz' ? 'gz' : 'br']) { await writeChunk(chunk); chunk = []; size = 0; }
      }
      if (chunk.length) await writeChunk(chunk);
    }

    const directory = [];
    for (const [bk, b] of [...this.boards.entries()].sort((x, y) => x[0].localeCompare(y[0]))) {
      const s = boardShards.get(bk);
      if (!s) continue; // board had no kept jobs
      directory.push([b.ats, b.token, b.name, boardCounts.get(bk) || 0, [...s].sort((x, y) => x - y)]);
    }
    const dirGz = gzipSync(Buffer.from(JSON.stringify(directory)), { level: 9 });
    await writeFile(join(this.outDir, 'directory.json.gz'), dirGz);

    const manifest = {
      format: INDEX_FORMAT,
      codec: this.codec === 'gz' ? 'gzip' : 'brotli',
      built_at: this.builtAt.toISOString(),
      boards: directory.length,
      boards_fetched: this.boards.size,
      jobs: kept,
      jobs_before_dedupe: this.rawJobs,
      bytes: totalBytes + dirGz.length,
      ats_counts: atsCounts,
      age_bands_days: AGE_BANDS.map(([lo, hi]) => [lo, hi === Infinity ? null : hi]),
      directory: 'directory.json.gz',
      shards,
    };
    await writeFile(join(this.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
    await rm(this.tmpDir, { recursive: true, force: true });
    return manifest;
  }
}
