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
import { detectTechIds, selfTechIds, boilerplateParagraphs, stripBoilerplate, TECHNOLOGIES, TECH_DICTIONARY_VERSION } from './tech.js';

export const TECH_ASSET_FILE = 'companies_tech.json.gz'; // read by technographics.js (TECH_ASSET)
export const TECH_SAMPLES_PER_TECH = 3;

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
  /**
   * @param outDir index output directory
   * @param opts { builtAt: Date, tmpDir?, codec: 'br'|'gz', tech: also write companies_tech.json.gz (technologies named
   *   in each job's title + full description, see tech.js / technographics.js) }
   */
  constructor(outDir, { builtAt = new Date(), tmpDir = null, codec = 'br', tech = false } = {}) {
    this.outDir = outDir;
    this.tmpDir = tmpDir || join(outDir, '.tmp');
    this.builtAt = builtAt;
    this.codec = codec;
    this.best = new Map(); // dedupe key -> { lite, dups: [] }
    this.boards = new Map(); // boardKey -> { ats, token, region, name, kw, fetched_at }
    this.rawJobs = 0;
    this.raw = null;
    this.tech = tech;
    this.techMs = 0; // CPU time spent detecting technologies (build report)
    this.techError = null; // set by techFailed(): detection switched off, no companies_tech asset
  }

  /** Switch technology detection off for the rest of the build and remember why (once). */
  techFailed(e) {
    this.tech = false;
    if (!this.techError) {
      this.techError = String(e?.stack || e).slice(0, 500);
      console.error(`technology detection disabled: ${this.techError}`);
    }
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
    // A vendor's own board names its own product everywhere (GitLab, Snowflake): not a technology it buys.
    // Technology detection must never fail the index build: on any error it is switched off for the rest of the build
    // (no companies_tech asset; the error goes to the manifest / build report).
    let self = null;
    if (this.tech) {
      try { self = selfTechIds(companyName, board.token); } catch (e) { this.techFailed(e); }
    }
    // Paragraphs repeated in most of this board's posts (customer lists, "about us") are not technologies it uses.
    let boiler = null;
    if (this.tech) {
      try { boiler = boilerplateParagraphs(jobs.map((j) => j.description_text)); } catch (e) { this.techFailed(e); }
    }
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
      let x;
      if (this.tech) {
        // Before truncation: the full description (up to DESCRIPTION_MAX) is only in memory here.
        try {
          const t0 = performance.now();
          let ids = detectTechIds(job.title, stripBoilerplate(job.description_text, boiler));
          if (self?.size) ids = ids.filter((id) => !self.has(id));
          this.techMs += performance.now() - t0;
          x = [ids.join('.'), job.description_text ? 1 : 0];
        } catch (e) { this.techFailed(e); x = undefined; }
      }
      await writeLine(this.raw, JSON.stringify(x ? { bk, key, rec: slimRecord(job, jobKw[i]), x } : { bk, key, rec: slimRecord(job, jobKw[i]) }));
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
    let tech = this.tech ? new TechAggregator() : null;
    for await (const line of readLines(join(this.tmpDir, 'raw.jsonl'))) {
      const { bk, key, rec, x } = JSON.parse(line);
      const entry = this.best.get(key);
      if (!entry || entry.lite.job_id !== rec.job_id || entry.done) continue;
      entry.done = true;
      if (tech) {
        try { tech.add(bk, rec, x); } catch (e) { this.techFailed(e); tech = null; }
      }
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
    if (tech && this.tech) {
      try {
        const t0 = Date.now();
        const out = tech.finish(this.boards, this.builtAt);
        const gz = gzipSync(Buffer.from(JSON.stringify(out.data)), { level: 9 });
        await writeFile(join(this.outDir, TECH_ASSET_FILE), gz);
        manifest.companies_tech = TECH_ASSET_FILE;
        manifest.companies_tech_stats = {
          ...out.stats, bytes: gz.length, extract_ms: Math.round(this.techMs), write_ms: Date.now() - t0,
        };
        manifest.bytes += gz.length;
      } catch (e) { this.techFailed(e); }
    }
    if (this.techError) manifest.companies_tech_stats = { error: this.techError };
    await writeFile(join(this.outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 1)}\n`);
    await rm(this.tmpDir, { recursive: true, force: true });
    return manifest;
  }
}

/**
 * Per-board technology counts for companies_tech.json.gz (format: technographics.js). Fed with the jobs the index
 * keeps after its dedupe, so the same opening on two boards counts once. Memory: one small tuple per job that names a
 * technology.
 */
export class TechAggregator {
  constructor() {
    this.boards = new Map(); // bk -> { o, x, L: Map(location -> i), D: Map(dept -> i), jobs: [...] }
    this.byAts = {};
  }

  /** One kept slim record + its [tech ids "3.17", has description 0|1] from addBoard(). */
  add(bk, rec, x) {
    let b = this.boards.get(bk);
    if (!b) { b = { o: 0, x: 0, L: new Map(), D: new Map(), jobs: [] }; this.boards.set(bk, b); }
    const a = this.byAts[rec.ats] || (this.byAts[rec.ats] = { jobs: 0, with_text: 0, with_tech: 0 });
    b.o += 1;
    a.jobs += 1;
    if (x?.[1]) { b.x += 1; a.with_text += 1; }
    if (!x?.[0]) return;
    a.with_tech += 1;
    const li = [];
    for (const l of rec.locations || []) {
      if (!b.L.has(l)) b.L.set(l, b.L.size);
      li.push(b.L.get(l));
    }
    const dept = rec.department || rec.team || null;
    if (dept && !b.D.has(dept)) b.D.set(dept, b.D.size);
    b.jobs.push({ t: x[0], n: x[0].split('.').length, cc: (rec.country_codes || []).join('.'), li: li.join('.'),
      di: dept ? b.D.get(dept) : -1, url: rec.job_url || null, p: rec.posted_at || '' });
  }

  /** -> { data (the asset), stats }. Sample job URLs: per board, up to TECH_SAMPLES_PER_TECH jobs per technology,
   * picking the jobs that name the most technologies first (newest first among equals). */
  finish(boardMeta, builtAt) {
    const out = [];
    let jobs = 0;
    let samples = 0;
    for (const [bk, b] of [...this.boards].sort((p, q) => p[0].localeCompare(q[0]))) {
      if (!b.jobs.length) continue;
      const meta = boardMeta.get(bk);
      if (!meta) continue;
      const order = b.jobs.map((j, i) => i).sort((i, k) => b.jobs[k].n - b.jobs[i].n || b.jobs[k].p.localeCompare(b.jobs[i].p));
      const per = new Map();
      const keep = new Set();
      for (const i of order) {
        const j = b.jobs[i];
        if (!j.url) continue;
        const tids = j.t.split('.');
        if (!tids.some((t) => (per.get(t) || 0) < TECH_SAMPLES_PER_TECH)) continue;
        for (const t of tids) per.set(t, (per.get(t) || 0) + 1);
        keep.add(i);
      }
      samples += keep.size;
      jobs += b.jobs.length;
      out.push({
        a: meta.ats, t: meta.token, ...(meta.region ? { r: meta.region } : {}), n: meta.name, f: meta.fetched_at, o: b.o, x: b.x,
        L: [...b.L.keys()], D: [...b.D.keys()],
        j: b.jobs.map((j, i) => (keep.has(i) ? [j.t, j.cc, j.li, j.di, j.url] : [j.t, j.cc, j.li, j.di])),
      });
    }
    return {
      data: {
        format: 1, built_at: builtAt.toISOString(), dictionary_version: TECH_DICTIONARY_VERSION,
        technologies: TECHNOLOGIES.map((t) => [t.slug, t.name, t.category]),
        boards: out,
      },
      stats: { boards: out.length, jobs_with_technology: jobs, sample_urls: samples, by_ats: this.byAts },
    };
  }
}
