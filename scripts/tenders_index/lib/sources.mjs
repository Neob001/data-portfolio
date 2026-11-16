// Network side of the tenders index: one fetcher per approved source (screen + DECISIONS.md).
// Every fetcher upserts normalized records into ctx.store and records counts/failures in ctx.rep.
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';
import { createInterface } from 'node:readline';
import { request, requestJson, HttpError } from './http.mjs';
import { isIndexable } from './normalize.mjs';
import { tedToRecord, TED_FIELDS, TED_SEARCH_URL } from './ted.mjs';
import { samRowToRecord, headerIndex, createCsvParser, SAM_CSV_URL, samTs } from './sam.mjs';
import { ocdsToRecord } from './ocds.mjs';
import { robotsOk } from './robots.mjs';

/** R1 gate before any data request to a host (verdict cached per host and night). */
export async function gate(url) {
  if (!(await robotsOk(url))) throw Object.assign(new HttpError(`robots.txt (rule R1) does not allow ${url}`, 'blocked'), { robots: true });
}

const DAY = 86400000;
export const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Days to fetch tonight for a day-sliced source, newest first: the last `refreshDays` days always
 * (late updates), then every day of the window not yet fetched completely. `maxDays` bounds a local run.
 */
export function plannedDays(cursor, { now, windowDays, refreshDays = 3, maxDays = null, skipWeekends = false }) {
  const done = cursor?.days || {};
  const out = [];
  for (let i = 0; i <= windowDays; i += 1) {
    const d = dayStr(now - i * DAY);
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (skipWeekends && (dow === 0 || dow === 6) && i >= refreshDays) continue;
    if (i < refreshDays || !done[d]?.complete) out.push(d);
  }
  return maxDays ? out.slice(0, maxDays) : out;
}

async function jsonWithRetry(url, opts, tries = 3) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await requestJson(url, opts);
    } catch (e) {
      last = e;
      if (e.status && e.status < 500 && e.status !== 429) throw e;
      if (e.retryAfterMs) throw e;
    }
  }
  throw last;
}

/** Shared day loop: fetchDay(day) -> number of records; budget/time checks; cursor bookkeeping. */
async function dayLoop(name, ctx, days, fetchDay) {
  const cur = (ctx.cursors[name] ||= { days: {} });
  cur.days ||= {};
  const rep = ctx.rep;
  rep.days_planned = days.length;
  rep.days_done = 0;
  for (const d of days) {
    if (Date.now() > ctx.deadline) { rep.stopped = 'budget'; break; }
    try {
      const n = await fetchDay(d);
      cur.days[d] = { complete: true, records: n, fetched_at: new Date().toISOString() };
      rep.days_done += 1;
    } catch (e) {
      rep.failures.push({ day: d, class: e.failureClass || 'unknown', message: String(e.message).slice(0, 200) });
      if (e.robots || e.retryAfterMs || rep.failures.length >= 5) { rep.stopped = e.robots ? 'robots' : e.retryAfterMs ? 'rate_limited' : 'failures'; break; }
    }
  }
  // Forget days that left the window.
  const oldest = dayStr(ctx.now - (ctx.opts.windowDays + 1) * DAY);
  for (const d of Object.keys(cur.days)) if (d < oldest) delete cur.days[d];
  rep.days_pending = plannedDays(cur, { now: ctx.now, windowDays: ctx.opts.windowDays, refreshDays: 0 }).length;
}

function put(ctx, rec) {
  ctx.rep.fetched += 1;
  if (!isIndexable(rec)) { ctx.rep.dropped_incomplete += 1; return; }
  ctx.store.upsert(rec);
}

// ---------------------------------------------------------------- TED
export async function fetchTed(ctx) {
  const days = plannedDays(ctx.cursors.ted, { now: ctx.now, windowDays: ctx.opts.windowDays, maxDays: ctx.opts.maxDays, skipWeekends: true });
  const PAGE = 250;
  await dayLoop('ted', ctx, days, async (d) => {
    let n = 0;
    for (let page = 1; page <= 60; page += 1) {
      const body = JSON.stringify({ query: `publication-date=${d.replace(/-/g, '')}`, fields: TED_FIELDS, page, limit: PAGE, paginationMode: 'PAGE_NUMBER', checkQuerySyntax: false });
      await gate(TED_SEARCH_URL);
      const res = await jsonWithRetry(TED_SEARCH_URL, { method: 'POST', body, headers: { 'content-type': 'application/json' }, minGapMs: ctx.opts.tedGapMs ?? 1000, timeoutMs: 120000 });
      if (!Array.isArray(res?.notices)) throw new HttpError('TED response without notices', 'schema_change');
      for (const notice of res.notices) put(ctx, tedToRecord(notice, { now: ctx.now, fetchedAt: ctx.fetchedAt }));
      n += res.notices.length;
      if (res.notices.length < PAGE || n >= (res.totalNoticeCount ?? 0)) break;
    }
    return n;
  });
}

// ---------------------------------------------------------------- UK (Find a Tender, Contracts Finder)
const FTS_BASE = 'https://www.find-tender.service.gov.uk';
const CF_BASE = 'https://www.contractsfinder.service.gov.uk';

export function ftsCtx(ctx) {
  return {
    source: 'uk-fts', idPrefix: 'uk-fts', country: 'GB', language: 'en', compiled: false, now: ctx.now, fetchedAt: ctx.fetchedAt,
    noticeUrl: (r) => `${FTS_BASE}/Notice/${r.id}`,
    sourceUrl: (r) => `${FTS_BASE}/api/1.0/ocdsReleasePackages/${r.id}`,
  };
}

export function cfCtx(ctx) {
  const uuid = (r) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.exec(String(r.id))?.[0];
  return {
    source: 'uk-cf', idPrefix: 'uk-cf', country: 'GB', language: 'en', compiled: false, now: ctx.now, fetchedAt: ctx.fetchedAt,
    noticeUrl: (r) => (uuid(r) ? `${CF_BASE}/Notice/${uuid(r)}` : null),
    sourceUrl: (r) => `${CF_BASE}/Published/OCDS/Release/${encodeURIComponent(r.id)}`,
  };
}

async function ocdsPaged(ctx, firstUrl, rctx, gapMs) {
  let url = firstUrl;
  let n = 0;
  for (let page = 0; url && page < 200; page += 1) {
    await gate(url);
    const pkg = await jsonWithRetry(url, { minGapMs: gapMs, timeoutMs: 240000 });
    const rels = pkg?.releases;
    if (!Array.isArray(rels)) throw new HttpError('OCDS package without releases', 'schema_change');
    for (const r of rels) put(ctx, ocdsToRecord(r, rctx));
    n += rels.length;
    url = rels.length ? pkg.links?.next || null : null;
  }
  return n;
}

export async function fetchFts(ctx) {
  const days = plannedDays(ctx.cursors['uk-fts'], { now: ctx.now, windowDays: ctx.opts.windowDays, maxDays: ctx.opts.maxDays });
  const rctx = ftsCtx(ctx);
  await dayLoop('uk-fts', ctx, days, (d) => ocdsPaged(ctx,
    `${FTS_BASE}/api/1.0/ocdsReleasePackages?updatedFrom=${d}T00:00:00&updatedTo=${d}T23:59:59&limit=100`, rctx, 1500));
}

export async function fetchCf(ctx) {
  const days = plannedDays(ctx.cursors['uk-cf'], { now: ctx.now, windowDays: ctx.opts.windowDays, maxDays: ctx.opts.maxDays });
  const rctx = cfCtx(ctx);
  await dayLoop('uk-cf', ctx, days, (d) => ocdsPaged(ctx,
    `${CF_BASE}/Published/Notices/OCDS/Search?publishedFrom=${d}T00:00:00&publishedTo=${d}T23:59:59&limit=100`, rctx, 1500));
}

// ---------------------------------------------------------------- SAM.gov
/**
 * Streams the whole public extract (all notices still listed, newest first). With maxDays (local runs)
 * it stops at the first notice posted before the cutoff.
 */
export async function fetchSam(ctx) {
  const rep = ctx.rep;
  const cutoff = ctx.opts.maxDays ? dayStr(ctx.now - ctx.opts.maxDays * DAY) : null;
  const maxBytes = (ctx.opts.samMaxMb || 0) * 1048576;
  await gate(SAM_CSV_URL);
  const res = await request(SAM_CSV_URL, { minGapMs: 0, timeoutMs: 15 * 60000, retries: 3 });
  const decoder = new TextDecoder('windows-1252');
  let idx = null;
  let stop = false;
  let bytes = 0;
  const parser = createCsvParser((row) => {
    if (!idx) { idx = headerIndex(row); return true; }
    if (row.length < 5) return true;
    const rec = samRowToRecord(row, idx, { now: ctx.now, fetchedAt: ctx.fetchedAt });
    if (!rec) return true;
    if (cutoff && rec.published_at && rec.published_at.slice(0, 10) < cutoff) { stop = true; return false; }
    put(ctx, rec);
    return true;
  });
  const reader = res.body.getReader();
  try {
    while (!stop) {
      const { done, value } = await reader.read();
      if (done) { parser.end(); break; }
      bytes += value.length;
      parser.feed(decoder.decode(value, { stream: true }));
      if (maxBytes && bytes >= maxBytes) { rep.stopped = 'max_mb'; break; }
      if (Date.now() > ctx.deadline) { rep.stopped = 'budget'; break; }
    }
  } finally {
    await reader.cancel().catch(() => null);
  }
  if (!idx) throw new HttpError('SAM.gov extract was empty', 'schema_change');
  rep.bytes = bytes;
  rep.complete = !stop && !rep.stopped;
  (ctx.cursors.sam ||= {}).last_read = new Date().toISOString();
}
export { samTs };

// ---------------------------------------------------------------- OCP Data Registry
const REG = 'https://data.open-contracting.org';

/** Resolve the registry's current bulk file URL for one year (302 to the CDN; the path carries the collection id). */
export async function registryFileUrl(pubId, year) {
  await gate(`${REG}/en/publication/${pubId}/download?name=${year}.jsonl.gz`);
  const res = await request(`${REG}/en/publication/${pubId}/download?name=${year}.jsonl.gz`, { redirect: 'manual', minGapMs: 1000, retries: 2, timeoutMs: 60000 });
  await res.arrayBuffer().catch(() => null);
  if (res.status >= 300 && res.status < 400) return new URL(res.headers.get('location'), REG).href;
  if (res.status === 200) return `${REG}/en/publication/${pubId}/download?name=${year}.jsonl.gz`;
  return null;
}

/**
 * One publication: re-read only when the registry has a new collection (URL changed) or our state
 * file is missing; otherwise the stored records are kept as they are.
 */
export async function fetchRegistryPublication(ctx, pub, { keep }) {
  const rep = ctx.rep;
  const name = `ocds-${pub.slug}`;
  const cur = (ctx.cursors[name] ||= {});
  const years = [new Date(ctx.now).getUTCFullYear()];
  if (new Date(ctx.now - ctx.opts.windowDays * DAY).getUTCFullYear() < years[0]) years.push(years[0] - 1);
  const urls = [];
  for (const y of years) {
    const u = await registryFileUrl(pub.id, y);
    if (u) urls.push(u);
  }
  rep.files = urls;
  if (!urls.length) { rep.failures.push({ class: 'http_error', message: 'no bulk file for the window' }); return false; }
  if (cur.urls && JSON.stringify(cur.urls) === JSON.stringify(urls) && ctx.store.loadedFromState) {
    rep.unchanged = true;
    return true;
  }
  const rctx = {
    source: name, idPrefix: name, country: pub.country, language: pub.language, compiled: true, suppliers: false,
    now: ctx.now, fetchedAt: ctx.fetchedAt, sourceUrl: () => `${REG}/en/publication/${pub.id}`,
  };
  // Over tonight's download budget or time: keep the stored records, read the new collection another night.
  if (ctx.opts.registryBudgetBytes && ctx.budgetBytes.used >= ctx.opts.registryBudgetBytes) { rep.stopped = 'max_mb'; return false; }
  if (Date.now() > ctx.deadline) { rep.stopped = 'budget'; return false; }
  const fresh = new Map(); // a new collection replaces the publication's records (swapped in when complete)
  let bytes = 0;
  for (const u of urls) {
    await gate(u);
    const res = await request(u, { minGapMs: 500, timeoutMs: 30 * 60000, retries: 2 });
    const src = Readable.fromWeb(res.body);
    src.on('data', (b) => { bytes += b.length; ctx.budgetBytes.used += b.length; });
    const gun = createGunzip();
    src.on('error', (e) => gun.destroy(e));
    const rl = createInterface({ input: src.pipe(gun), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      let rel;
      try { rel = JSON.parse(line); } catch { rep.bad_lines = (rep.bad_lines || 0) + 1; continue; }
      if (rel.compiledRelease) rel = rel.compiledRelease;
      const rec = ocdsToRecord(rel, rctx);
      rep.fetched += 1;
      if (!isIndexable(rec)) { rep.dropped_incomplete += 1; continue; }
      if (!keep(rec)) continue;
      const prev = ctx.store.map.get(rec.notice_id); // keep the night we first indexed it
      if (prev?.fetched_at && prev.fetched_at < rec.fetched_at) rec.fetched_at = prev.fetched_at;
      fresh.set(rec.notice_id, rec);
    }
  }
  ctx.store.map = fresh;
  rep.bytes = bytes;
  cur.urls = urls;
  cur.read_at = new Date().toISOString();
  return true;
}
