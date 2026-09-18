// Writes the sharded, gzip-compressed jobs index (format: see index_format.js).
// Used by scripts/jobs_index/build_index.mjs and by the tests (tiny index in a temp dir).
// Memory stays bounded by streaming every job to a temp file first: only a small dedupe map
// (key -> winner id) is held for the whole corpus, and one (ATS, date band) group at a time.
import { createWriteStream, createReadStream } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { dedupeKey, dedupeLite, preferLite, boardKey } from './transform.js';
import { ageBand, bandWindow, AGE_BANDS, INDEX_FORMAT } from './index_format.js';

export const SHARD_MAX_GZ = 5 * 1024 * 1024; // hard cap per shard
const RAW_CHUNK = 16 * 1024 * 1024; // raw JSONL bytes gzipped at once (~3-4 MB gz)

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

export class IndexWriter {
  /** @param outDir index output directory  @param opts { builtAt: Date, tmpDir? } */
  constructor(outDir, { builtAt = new Date(), tmpDir = null } = {}) {
    this.outDir = outDir;
    this.tmpDir = tmpDir || join(outDir, '.tmp');
    this.builtAt = builtAt;
    this.best = new Map(); // dedupe key -> { lite, dups: [] }
    this.boards = new Map(); // boardKey -> { ats, token, name, jobs }
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

  /** Add one board's normalized jobs (full output records incl. source_url / fetched_at). */
  async addBoard(board, companyName, jobs) {
    const bk = boardKey(board);
    this.boards.set(bk, { ats: board.ats, token: board.token, name: companyName || board.token, jobs: 0 });
    for (const job of jobs) {
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
      await writeLine(this.raw, JSON.stringify(job));
      this.rawJobs += 1;
    }
  }

  /** Dedupe, group by (ATS, posted-date band), sort newest first, shard, gzip, write manifest. */
  async finish() {
    await endStream(this.raw);
    const builtAtMs = this.builtAt.getTime();
    const groups = new Map(); // `${ats}|${band}` -> write stream
    const groupPath = (ats, band) => join(this.tmpDir, `g-${ats}-${band}.jsonl`);
    let kept = 0;
    for await (const line of readLines(join(this.tmpDir, 'raw.jsonl'))) {
      const job = JSON.parse(line);
      const entry = this.best.get(dedupeKey(job));
      if (!entry || entry.lite.job_id !== job.job_id) continue;
      if (entry.done) continue; // same job_id twice (identical posting listed twice) -> keep once
      entry.done = true;
      job.duplicate_sources = [...new Set(entry.dups)].filter((id) => id !== job.job_id).sort();
      const band = ageBand(job.posted_at, builtAtMs);
      const gk = `${job.ats}|${band}`;
      if (!groups.has(gk)) groups.set(gk, createWriteStream(groupPath(job.ats, band)));
      await writeLine(groups.get(gk), JSON.stringify(job));
      kept += 1;
    }
    for (const s of groups.values()) await endStream(s);

    const shards = [];
    const boardShards = new Map();
    const boardCounts = new Map();
    const atsCounts = {};
    let totalBytes = 0;
    const order = [...groups.keys()].map((k) => k.split('|')).map(([ats, band]) => [ats, Number(band)])
      .sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
    for (const [ats, band] of order) {
      const rows = [];
      for await (const line of readLines(groupPath(ats, band))) {
        const j = JSON.parse(line);
        rows.push({ p: j.posted_at || '', id: j.job_id, b: `${j.ats}:${j.company_board.toLowerCase()}`, line });
      }
      rows.sort((a, b) => (b.p.localeCompare(a.p)) || a.id.localeCompare(b.id));
      const win = bandWindow(band, builtAtMs);
      let part = 0;
      const writeChunk = async (chunk) => {
        const gz = gzipSync(Buffer.from(`${chunk.map((r) => r.line).join('\n')}\n`), { level: 9 });
        if (gz.length > SHARD_MAX_GZ && chunk.length > 1) {
          const mid = Math.ceil(chunk.length / 2);
          await writeChunk(chunk.slice(0, mid));
          await writeChunk(chunk.slice(mid));
          return;
        }
        const file = `shards/${ats}-b${band}-p${part}.jsonl.gz`;
        await writeFile(join(this.outDir, file), gz);
        const idx = shards.length;
        shards.push({
          file, ats, band, part, jobs: chunk.length, bytes: gz.length,
          posted_from: win.posted_from, posted_to: win.posted_to,
          newest: chunk[0].p || null, oldest: chunk[chunk.length - 1].p || null,
        });
        for (const r of chunk) {
          if (!boardShards.has(r.b)) boardShards.set(r.b, new Set());
          boardShards.get(r.b).add(idx);
          boardCounts.set(r.b, (boardCounts.get(r.b) || 0) + 1);
        }
        part += 1;
        totalBytes += gz.length;
        atsCounts[ats] = (atsCounts[ats] || 0) + chunk.length;
      };
      let chunk = [];
      let size = 0;
      for (const r of rows) {
        chunk.push(r);
        size += r.line.length + 1;
        if (size >= RAW_CHUNK) { await writeChunk(chunk); chunk = []; size = 0; }
      }
      if (chunk.length) await writeChunk(chunk);
    }

    const directory = [];
    for (const b of [...this.boards.values()].sort((x, y) => boardKey(x).localeCompare(boardKey(y)))) {
      const key = `${b.ats}:${String(b.token).toLowerCase()}`;
      const s = boardShards.get(key);
      if (!s) continue; // board had no kept jobs
      directory.push([b.ats, b.token, b.name, boardCounts.get(key) || 0, [...s].sort((x, y) => x - y)]);
    }
    const dirGz = gzipSync(Buffer.from(JSON.stringify(directory)), { level: 9 });
    await writeFile(join(this.outDir, 'directory.json.gz'), dirGz);

    const manifest = {
      format: INDEX_FORMAT,
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
