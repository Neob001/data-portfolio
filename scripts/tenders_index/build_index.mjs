#!/usr/bin/env node
// Nightly global public-procurement index (owner approval S-3, 2026-11-17). Zero-token, Node 22, no deps.
//
//   node build_index.mjs                       # all approved sources, incremental (state/ from the last night)
//   node build_index.mjs --days 2 --out /tmp/t # local smoke run: only the last 2 days per source
//
// Each source keeps a rolling store in state/records/ (restored from the Actions cache), fetches only what
// changed since the last night (plus a 3-day refresh), and the index is rebuilt from the stores:
// retention (published in the last --window-days, or still open) -> cross-source dedupe -> shards.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SourceStore, retain, crossSourceDedupe } from './lib/store.mjs';
import { writeIndex } from './lib/writer.mjs';
import { stats } from './lib/http.mjs';
import { fetchTed, fetchFts, fetchCf, fetchSam, fetchRegistryPublication } from './lib/sources.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const { values: a } = parseArgs({
  options: {
    out: { type: 'string', default: join(HERE, 'index') },
    state: { type: 'string', default: join(HERE, 'state') },
    sources: { type: 'string', default: 'ted,uk-fts,uk-cf,sam,ocds' },
    'registry-pubs': { type: 'string', default: '' }, // subset of slugs, e.g. "za,ug,nl"
    'window-days': { type: 'string', default: '90' },
    days: { type: 'string', default: '' }, // local runs: fetch at most N days per day-sliced source / SAM cutoff
    'budget-min': { type: 'string', default: '40' }, // fetch phase, per source (they run in parallel)
    'registry-max-mb': { type: 'string', default: '2500' }, // compressed registry downloads per night
    'sam-max-mb': { type: 'string', default: '0' },
    codec: { type: 'string', default: 'br' },
    now: { type: 'string', default: '' },
  },
});

const started = Date.now();
const now = a.now ? Date.parse(a.now) : Date.now();
const builtAt = new Date(now).toISOString();
const opts = {
  windowDays: Number(a['window-days']),
  maxDays: a.days ? Number(a.days) : null,
  samMaxMb: Number(a['sam-max-mb']),
  registryBudgetBytes: Number(a['registry-max-mb']) * 1048576,
};
const outDir = resolve(a.out);
const stateDir = resolve(a.state);
const recDir = join(stateDir, 'records');
mkdirSync(outDir, { recursive: true });
mkdirSync(recDir, { recursive: true });
const cursorFile = join(stateDir, 'cursors.json');
const cursors = existsSync(cursorFile) ? JSON.parse(readFileSync(cursorFile, 'utf8')) : {};
const pubs = JSON.parse(readFileSync(join(HERE, 'registry_publications.json'), 'utf8')).publications
  .filter((p) => !a['registry-pubs'] || a['registry-pubs'].split(',').includes(p.slug));

const wanted = new Set(a.sources.split(',').map((s) => s.trim()));
const log = (...m) => console.log(`[${((Date.now() - started) / 1000).toFixed(0).padStart(5)}s]`, ...m);
const deadline = started + Number(a['budget-min']) * 60000;
const budgetBytes = { used: 0 };
const report = { built_at: builtAt, window_days: opts.windowDays, sources: {} };
const stores = new Map();
const keep = (r) => retain(r, { now, windowDays: opts.windowDays });

async function runSource(name, fn) {
  const store = new SourceStore(name);
  stores.set(name, store);
  const rep = { fetched: 0, dropped_incomplete: 0, failures: [], stored_before: await store.load(recDir) };
  report.sources[name] = rep;
  const t0 = Date.now();
  try {
    await fn({ store, cursors, rep, now, fetchedAt: new Date().toISOString(), opts, deadline, budgetBytes });
  } catch (e) {
    rep.failures.push({ class: e.failureClass || 'unknown', message: String(e.message).slice(0, 300) });
    log(`${name}: FAILED ${e.message}`);
  }
  rep.fetch_s = Math.round((Date.now() - t0) / 1000);
  log(`${name}: fetched ${rep.fetched}, stored ${store.size} (${rep.fetch_s}s)${rep.failures.length ? `, ${rep.failures.length} failures` : ''}${rep.stopped ? `, stopped: ${rep.stopped}` : ''}`);
}

const jobs = [];
if (wanted.has('ted')) jobs.push(runSource('ted', fetchTed));
if (wanted.has('uk-fts')) jobs.push(runSource('uk-fts', fetchFts));
if (wanted.has('uk-cf')) jobs.push(runSource('uk-cf', fetchCf));
if (wanted.has('sam')) jobs.push(runSource('sam', fetchSam));
if (wanted.has('ocds')) {
  // Registry publications one after another (one host); smallest first so a byte budget cut skips the big ones.
  jobs.push((async () => {
    for (const p of pubs) await runSource(`ocds-${p.slug}`, (ctx) => fetchRegistryPublication(ctx, p, { keep }));
  })());
}
await Promise.all(jobs);
const fetchS = Math.round((Date.now() - started) / 1000);

// Retention, then save each store (only what is retained survives to the next night).
let before = 0;
const all = [];
for (const [name, store] of stores) {
  before += store.size;
  for (const r of [...store.values()]) if (!keep(r)) store.map.delete(r.notice_id);
  report.sources[name].stored_after = store.size;
  await store.save(recDir);
  for (const r of store.values()) all.push(r);
}
// Sources not run tonight still contribute their stored records.
for (const f of (await import('node:fs')).readdirSync(recDir)) {
  const name = f.replace(/\.jsonl\.gz$/, '');
  if (stores.has(name) || !f.endsWith('.jsonl.gz')) continue;
  const s = new SourceStore(name);
  await s.load(recDir);
  for (const r of s.values()) if (keep(r)) all.push(r);
  report.sources[name] = { carried: s.size };
}
writeFileSync(cursorFile, JSON.stringify(cursors, null, 1));

const { drop, duplicates } = crossSourceDedupe(all);
const final = all.filter((r) => !drop.has(r.notice_id));
log(`retained ${all.length} notices (tonight's sources: ${before} stored before retention); cross-source duplicates dropped ${drop.size}`);
report.notices_before_dedupe = all.length;
report.cross_source_duplicates = duplicates;
report.http = stats;
report.fetch_s = fetchS;
const manifest = writeIndex(final, {
  outDir, builtAt, codec: a.codec,
  extra: { notices_before_dedupe: all.length, build_report: 'build_report.json' },
});
report.notices = manifest.notices;
report.bytes = manifest.bytes;
report.shards = manifest.shards.length;
report.total_s = Math.round((Date.now() - started) / 1000);
writeFileSync(join(outDir, 'build_report.json'), JSON.stringify(report, null, 1));
log(`index: ${manifest.notices} notices, ${manifest.shards.length} shards, ${(manifest.bytes / 1048576).toFixed(1)} MB -> ${outDir} (${report.total_s}s)`);
