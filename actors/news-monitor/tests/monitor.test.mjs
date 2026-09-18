import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runQuery, runMonitor } from '../src/monitor.js';
import { createTracker } from '../src/lib/incremental.js';
import { toGdeltDateTime, sha1Hex } from '../src/transform.js';

// Apify rejects dataset pushes that violate .actor/actor.json's declared field types/enums,
// which crashes a live run (see actors/broken-link-checker/tests/crawler.test.mjs). Every row
// produced by these tests is checked against that same declared schema.
const DATASET_FIELDS = JSON.parse(readFileSync(new URL('../.actor/actor.json', import.meta.url), 'utf8')).storages.dataset.fields.properties;
function assertMatchesSchema(row) {
  for (const [key, value] of Object.entries(row)) {
    const spec = DATASET_FIELDS[key];
    if (!spec) continue;
    const types = [].concat(spec.type);
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const ok = types.includes(actual) || (actual === 'integer' && types.includes('number'));
    assert.ok(ok, `field ${key}=${JSON.stringify(value)} is ${actual}, schema allows ${types}`);
    if (spec.enum && value !== null) assert.ok(spec.enum.includes(value), `field ${key}=${value} not in enum ${spec.enum}`);
  }
}

/** In-memory stand-in for loadTracker(Actor, slug, filters): same createTracker semantics, backed
 * by a plain object instead of a real Apify named key-value store, so two-pass tests can simulate
 * "next scheduled run" without any Actor/network dependency. */
function makeTrackerStore() {
  const cursors = new Map();
  return {
    async openTracker(filters) {
      const key = JSON.stringify(filters);
      const tracker = createTracker(cursors.get(key));
      return {
        tracker,
        async save(opts) {
          const next = tracker.next(opts);
          if (next) cursors.set(key, next);
        },
      };
    },
  };
}

function article({ url, title = 'Headline', seendate = '20260915T120000Z', domain = 'example.com' }) {
  return { url, title, seendate, domain, language: 'English', sourcecountry: 'United States', socialimage: '' };
}

/** Fake fetchGdelt keyed by [startdatetime, enddatetime), so window-splitting tests can hand back
 * different article counts for the full window vs. its halves. */
function fakeFetcher(byRange, calls = []) {
  return async (url) => {
    const p = new URL(url).searchParams;
    const key = `${p.get('startdatetime')}-${p.get('enddatetime')}`;
    calls.push(key);
    const articles = byRange[key];
    if (articles === undefined) throw new Error(`fakeFetcher: no fixture for range ${key} (url=${url})`);
    return { articles };
  };
}

/** Fetcher that hands back the same fixed article list for any window -- used where the test is
 * about the incremental cursor's own dedupe, not about exact window math (covered separately by
 * the "window splitting" tests). Mirrors how a live GDELT window that fully contains all of a
 * query's recent coverage would behave: every call sees the same articles, cursor math aside. */
function fixedFetcher(articles) {
  return async () => ({ articles });
}

test('runQuery: delivers, charges, and stamps flat records that pass the dataset schema', async () => {
  const now = Date.parse('2026-09-16T00:00:00Z');
  const start = toGdeltDateTime(now - 24 * 3600 * 1000);
  const end = toGdeltDateTime(now);
  const articles = [article({ url: 'https://a.example/1' }), article({ url: 'https://a.example/2' })];
  const fetchGdelt = fakeFetcher({ [`${start}-${end}`]: articles });

  const rows = [];
  const result = await runQuery('"OpenAI"', { mode: 'news', lookbackHours: 24, maxResultsPerQuery: 100 }, {
    fetchGdelt,
    pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
    charge: async () => ({ eventChargeLimitReached: false }),
    nowMs: () => now,
  });

  assert.equal(result.pushed, 2);
  assert.equal(result.charged, 2);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].query, '"OpenAI"');
  assert.equal(rows[0].mode, 'news');
  assert.equal(rows[0].article_id, sha1Hex('https://a.example/1'));
  assert.equal(rows[0].source_url.includes('api.gdeltproject.org'), true);
  assert.match(rows[0].fetched_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('runQuery: maxResultsPerQuery caps delivery and charges', async () => {
  const now = Date.parse('2026-09-16T00:00:00Z');
  const start = toGdeltDateTime(now - 24 * 3600 * 1000);
  const end = toGdeltDateTime(now);
  const articles = Array.from({ length: 5 }, (_, i) => article({ url: `https://a.example/${i}` }));
  const fetchGdelt = fakeFetcher({ [`${start}-${end}`]: articles });

  const rows = [];
  const result = await runQuery('"OpenAI"', { mode: 'news', lookbackHours: 24, maxResultsPerQuery: 3 }, {
    fetchGdelt,
    pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
    charge: async () => ({ eventChargeLimitReached: false }),
    nowMs: () => now,
  });

  assert.equal(result.pushed, 3);
  assert.equal(rows.length, 3);
});

test('runQuery: stops immediately once eventChargeLimitReached, no further charges', async () => {
  const now = Date.parse('2026-09-16T00:00:00Z');
  const start = toGdeltDateTime(now - 24 * 3600 * 1000);
  const end = toGdeltDateTime(now);
  const articles = Array.from({ length: 5 }, (_, i) => article({ url: `https://a.example/${i}` }));
  const fetchGdelt = fakeFetcher({ [`${start}-${end}`]: articles });

  let chargeCalls = 0;
  const result = await runQuery('"OpenAI"', { mode: 'news', lookbackHours: 24, maxResultsPerQuery: 100 }, {
    fetchGdelt,
    pushData: async (r) => assertMatchesSchema(r),
    charge: async () => { chargeCalls += 1; return { eventChargeLimitReached: chargeCalls >= 1 }; },
    nowMs: () => now,
  });

  assert.equal(chargeCalls, 1);
  assert.equal(result.pushed, 1);
  assert.equal(result.chargeLimitReached, true);
});

test('window splitting: a full window at the 250 cap is recursively narrowed until sub-windows fit, with no duplicate or missing articles', async () => {
  const now = Date.parse('2026-09-16T00:00:00Z');
  const dayMs = 24 * 3600 * 1000;
  const fullStartMs = now - dayMs;
  const fullEndMs = now;
  const [[aStart, aEnd], [bStart, bEnd]] = [[fullStartMs, fullStartMs + dayMs / 2], [fullStartMs + dayMs / 2, fullEndMs]];

  const fullKey = `${toGdeltDateTime(fullStartMs)}-${toGdeltDateTime(fullEndMs)}`;
  const aKey = `${toGdeltDateTime(aStart)}-${toGdeltDateTime(aEnd)}`;
  const bKey = `${toGdeltDateTime(bStart)}-${toGdeltDateTime(bEnd)}`;

  // Full window "looks" truncated (exactly at the cap); each half comes back well under it.
  const fullBatch = Array.from({ length: 250 }, (_, i) => article({ url: `https://full.example/${i}` }));
  const aBatch = [article({ url: 'https://half-a.example/1' }), article({ url: 'https://half-a.example/2' })];
  const bBatch = [article({ url: 'https://half-b.example/1' })];

  const calls = [];
  const fetchGdelt = fakeFetcher({ [fullKey]: fullBatch, [aKey]: aBatch, [bKey]: bBatch }, calls);

  const rows = [];
  const result = await runQuery('"OpenAI"', { mode: 'news', lookbackHours: 24, maxResultsPerQuery: 100 }, {
    fetchGdelt,
    pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
    charge: async () => ({ eventChargeLimitReached: false }),
    nowMs: () => now,
  });

  assert.deepEqual(calls, [fullKey, bKey, aKey], 'full window fetched first, then split into halves (newest half first)');
  assert.equal(result.pushed, 3, 'only the halves\' articles are delivered, not the truncated full batch');
  const urls = rows.map((r) => r.url).sort();
  assert.deepEqual(urls, ['https://half-a.example/1', 'https://half-a.example/2', 'https://half-b.example/1']);
});

test('dedupe by URL: the same article reachable from two overlapping windows is only delivered once', async () => {
  const now = Date.parse('2026-09-16T00:00:00Z');
  const start = toGdeltDateTime(now - 3600 * 1000);
  const end = toGdeltDateTime(now);
  // A window returning the API cap that, after "splitting", hands back the identical article in
  // both halves (GDELT windows can overlap at the boundary second) -- must still be delivered once.
  const fullBatch = Array.from({ length: 250 }, (_, i) => article({ url: `https://x.example/${i}` }));
  const [[aStart, aEnd], [bStart, bEnd]] = [[now - 3600 * 1000, now - 1800 * 1000], [now - 1800 * 1000, now]];
  const shared = article({ url: 'https://shared.example/1' });
  const fetchGdelt = fakeFetcher({
    [`${start}-${end}`]: fullBatch,
    [`${toGdeltDateTime(aStart)}-${toGdeltDateTime(aEnd)}`]: [shared],
    [`${toGdeltDateTime(bStart)}-${toGdeltDateTime(bEnd)}`]: [shared],
  });

  const rows = [];
  await runQuery('"OpenAI"', { mode: 'news', lookbackHours: 1, maxResultsPerQuery: 100 }, {
    fetchGdelt,
    pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
    charge: async () => ({ eventChargeLimitReached: false }),
    nowMs: () => now,
  });

  assert.equal(rows.length, 1, 'the shared URL is delivered only once despite appearing in both halves');
});

test('two-pass incremental: second run with the same cursor delivers 0 rows and charges nothing', async () => {
  const store = makeTrackerStore();
  const firstNow = Date.parse('2026-09-16T00:00:00Z');
  const articles = [
    article({ url: 'https://a.example/1', seendate: '20260915T100000Z' }),
    article({ url: 'https://a.example/2', seendate: '20260915T110000Z' }),
  ];

  const firstRows = [];
  let firstCharges = 0;
  const firstResult = await runQuery('"OpenAI"', { mode: 'news', lookbackHours: 24, maxResultsPerQuery: 100, sinceLastRun: true }, {
    fetchGdelt: fixedFetcher(articles),
    pushData: async (r) => { assertMatchesSchema(r); firstRows.push(r); },
    charge: async () => { firstCharges += 1; return { eventChargeLimitReached: false }; },
    openTracker: store.openTracker,
    nowMs: () => firstNow,
  });
  assert.equal(firstResult.pushed, 2);
  assert.equal(firstCharges, 2);

  // Second run, a bit later: the API still lists the very same articles (as it would on a schedule
  // where nothing new happened) -- the cursor must suppress all of them.
  const secondNow = firstNow + 3 * 3600 * 1000;
  const secondRows = [];
  let secondCharges = 0;
  const secondResult = await runQuery('"OpenAI"', { mode: 'news', lookbackHours: 24, maxResultsPerQuery: 100, sinceLastRun: true }, {
    fetchGdelt: fixedFetcher(articles),
    pushData: async (r) => { assertMatchesSchema(r); secondRows.push(r); },
    charge: async () => { secondCharges += 1; return { eventChargeLimitReached: false }; },
    openTracker: store.openTracker,
    nowMs: () => secondNow,
  });

  assert.equal(secondResult.pushed, 0, 'no rows on the second pass');
  assert.equal(secondCharges, 0, 'no charges on the second pass');
  assert.equal(secondRows.length, 0);
});

test('two-pass incremental: a genuinely new article on the second pass is still delivered and charged', async () => {
  const store = makeTrackerStore();
  const firstNow = Date.parse('2026-09-16T00:00:00Z');
  const oldArticle = article({ url: 'https://a.example/old', seendate: '20260915T100000Z' });

  await runQuery('"OpenAI"', { mode: 'news', lookbackHours: 24, maxResultsPerQuery: 100, sinceLastRun: true }, {
    fetchGdelt: fixedFetcher([oldArticle]),
    pushData: async () => {},
    charge: async () => ({ eventChargeLimitReached: false }),
    openTracker: store.openTracker,
    nowMs: () => firstNow,
  });

  const secondNow = firstNow + 3 * 3600 * 1000;
  const newArticle = article({ url: 'https://a.example/new', seendate: '20260916T010000Z' });

  const rows = [];
  const result = await runQuery('"OpenAI"', { mode: 'news', lookbackHours: 24, maxResultsPerQuery: 100, sinceLastRun: true }, {
    fetchGdelt: fixedFetcher([oldArticle, newArticle]),
    pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
    charge: async () => ({ eventChargeLimitReached: false }),
    openTracker: store.openTracker,
    nowMs: () => secondNow,
  });

  assert.equal(result.pushed, 1);
  assert.equal(rows[0].url, 'https://a.example/new');
});

test('runMonitor: a run-wide charge limit hit on the first query short-circuits later queries', async () => {
  const now = Date.parse('2026-09-16T00:00:00Z');
  const start = toGdeltDateTime(now - 24 * 3600 * 1000);
  const end = toGdeltDateTime(now);
  const fetchGdelt = fakeFetcher({ [`${start}-${end}`]: [article({ url: 'https://a.example/1' })] });

  let chargeCalls = 0;
  const results = await runMonitor({ queries: ['"OpenAI"', '"Anthropic"'], mode: 'news', lookbackHours: 24, maxResultsPerQuery: 100 }, {
    fetchGdelt,
    pushData: async () => {},
    charge: async () => { chargeCalls += 1; return { eventChargeLimitReached: true }; },
    nowMs: () => now,
  });

  assert.equal(results.length, 2);
  assert.equal(results[0].chargeLimitReached, true);
  assert.equal(results[1].skipped, true);
  assert.equal(chargeCalls, 1, 'the second query never fetches once the run-wide limit is hit');
});

test('adverse_media mode: matched_risk_terms is populated end-to-end and passes the schema enum', async () => {
  const now = Date.parse('2026-09-16T00:00:00Z');
  const start = toGdeltDateTime(now - 24 * 3600 * 1000);
  const end = toGdeltDateTime(now);
  const articles = [article({ url: 'https://a.example/1', title: 'Acme Corp hit with bribery indictment' })];
  const fetchGdelt = fakeFetcher({ [`${start}-${end}`]: articles });

  const rows = [];
  await runQuery('"Acme Corp"', { mode: 'adverse_media', lookbackHours: 24, maxResultsPerQuery: 100 }, {
    fetchGdelt,
    pushData: async (r) => { assertMatchesSchema(r); rows.push(r); },
    charge: async () => ({ eventChargeLimitReached: false }),
    nowMs: () => now,
  });

  assert.deepEqual(rows[0].matched_risk_terms, ['bribery', 'indictment']);
  assert.equal(rows[0].mode, 'adverse_media');
});
