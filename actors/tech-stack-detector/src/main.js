import { Actor, log } from 'apify';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { createDeadline } from './lib/deadline.js';
import { loadEngine } from './detect.js';
import { fetchPage, lookupDns, createResolver } from './fetch.js';
import { analyzeTarget } from './pipeline.js';
import { dedupeTargets, sanitizeCategoriesFilter, buildRow, isChargeable, EVENT_NAME } from './transform.js';

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { urls = [], includeDns = true, categoriesFilter = [], maxConcurrency = 10 } = input;

if (!Array.isArray(urls) || urls.length === 0) {
  throw new Error('Provide "urls": website URLs or domains, e.g. ["https://www.shopify.com", "github.com"].');
}

const engine = loadEngine();
const { keep, unknown } = sanitizeCategoriesFilter(categoriesFilter, [...engine.categories.values()].map((c) => c.name));
if (unknown.length) log.warning(`Ignoring unknown categories in categoriesFilter: ${unknown.join(', ')}`);
log.info(`Fingerprints: ${engine.stats.technologies} technologies (${engine.stats.staticDetectable} detectable over HTTP/DNS), ${engine.categories.size} categories.`);

const { valid, invalid } = dedupeTargets(urls);
const concurrency = Math.max(1, Math.min(50, Number.parseInt(maxConcurrency, 10) || 10));
const resolver = includeDns ? createResolver() : null;
const dnsLookup = resolver ? (q) => lookupDns(resolver, q) : null;

// Start a URL only if a worst-case attempt (fetch + one retry + DNS) can finish before the timeout.
const deadline = createDeadline();
const ITEM_BUDGET_MS = 45000;

let pushed = 0;
let failed = 0;
let charged = 0;
let stop = false;

for (const raw of invalid) {
  await Actor.pushData(stamp(buildRow({ url: raw, error: 'invalid_url' }), raw));
  failed += 1;
}

async function processTarget(target) {
  const row = await analyzeTarget(target, {
    engine,
    fetchPage,
    lookupDns: dnsLookup,
    keep,
    timeLeftMs: () => deadline.timeLeftMs(),
  });
  await Actor.pushData(stamp(row, row.final_url || row.url));
  if (row.ok) pushed += 1; else failed += 1;
  // PPE: one charge per URL that loaded and returned at least one technology. Failures and
  // pages with zero detections (after categoriesFilter) are free.
  if (isChargeable(row) && !stop) {
    const { eventChargeLimitReached } = await Actor.charge({ eventName: EVENT_NAME });
    charged += 1;
    if (eventChargeLimitReached) stop = true;
  }
}

let next = 0;
async function runner() {
  while (next < valid.length && !stop) {
    if (!deadline.hasTimeFor(ITEM_BUDGET_MS)) {
      deadline.skipped = valid.length - next;
      break;
    }
    const target = valid[next];
    next += 1;
    try {
      await processTarget(target);
    } catch (e) {
      log.warning(`Unexpected failure for ${target.url}: ${e.message}`);
      await Actor.pushData(stamp(buildRow({ url: target.url, domain: target.key, error: 'connection_error' }), target.url));
      failed += 1;
    }
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, valid.length)) }, runner));

const notProcessed = stop ? valid.length - next : deadline.skipped;
await writeRunSummary(Actor, {
  rows: pushed + failed,
  charged_events: charged,
  errors: failed,
  duration_ms: Date.now() - started,
  stopped_before_timeout: deadline.stoppedEarly,
  charge_limit_reached: stop,
  urls_not_processed: notProcessed,
  slow_patterns_disabled: engine.slowPatterns,
});
if (deadline.stoppedEarly) {
  await Actor.exit(`Stopped before the run timeout: ${pushed + failed} URLs analyzed, ${deadline.skipped} URLs not processed (not charged). Raise the run timeout or split the list.`);
} else if (stop) {
  await Actor.exit(`Reached the maximum charge you set for this run: ${pushed + failed} URLs analyzed, ${notProcessed} URLs not processed (not charged).`);
}
await Actor.exit();
