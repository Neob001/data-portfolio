import { Actor } from 'apify';
import { fetchJson, rateLimiter } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import {
  FIELDS, normalizeBarcode, buildSearchQuery, parseProductResponse, parseSearchResponse, toProductRecord, hasPayload,
} from './transform.js';

// Open Food Facts asks every API client for a custom User-Agent (app name + contact).
const HEADERS = { 'User-Agent': 'factpipe-open-food-facts-scraper/0.1 (https://apify.com/factpipe/open-food-facts-scraper)' };
const PAGE_SIZE = 100;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { barcodes = [], searchTerms = [], country = null, maxResultsPerSearch = 50 } = input;

if ((!Array.isArray(barcodes) || barcodes.length === 0) && (!Array.isArray(searchTerms) || searchTerms.length === 0)) {
  throw new Error('Provide "barcodes" (EAN/UPC) and/or "searchTerms".');
}

// OFF limits: product reads 100 req/min, search 10 req/min.
const productLimit = rateLimiter(700);
const searchLimit = rateLimiter(6500);
let pushed = 0;
let charged = 0;
const seen = new Set();

async function finish(extra = {}) {
  await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started, ...extra });
}

/** Push one product record and charge for it; returns false when the charge limit is reached. */
async function deliver(query, product, sourceUrl) {
  const record = toProductRecord(product);
  if (seen.has(record.barcode)) return true; // same product twice in one run: delivered and charged once
  seen.add(record.barcode);
  if (!hasPayload(record)) {
    await Actor.pushData(stamp({ query, barcode: record.barcode, found: false, error: 'empty_product' }, sourceUrl));
    return true; // not charged
  }
  await Actor.pushData(stamp({ query, ...record }, sourceUrl));
  pushed += 1;
  const { eventChargeLimitReached } = await Actor.charge({ eventName: 'product-result' });
  charged += 1;
  return !eventChargeLimitReached;
}

async function stop() {
  await finish();
  await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
}

try {
  for (const raw of barcodes) {
    const code = normalizeBarcode(raw);
    if (!code) {
      await Actor.pushData(stamp({ query: String(raw), found: false, error: 'invalid_barcode' }, 'https://world.openfoodfacts.org'));
      continue; // not charged
    }
    const url = `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${FIELDS}`;
    await productLimit();
    let product;
    try {
      product = parseProductResponse(await fetchJson(url, { headers: HEADERS }));
    } catch (e) {
      if (e.status !== 404) throw e;
      product = null; // v2 answers unknown barcodes with 404 + status 0
    }
    if (!product) {
      await Actor.pushData(stamp({ query: String(raw), barcode: code, found: false, error: 'product_not_found' }, url));
      continue; // not charged
    }
    if (!(await deliver(String(raw), product, url))) await stop();
  }

  const cap = Math.max(1, Math.min(1000, Number(maxResultsPerSearch) || 50));
  for (const terms of searchTerms) {
    const q = buildSearchQuery(terms, country);
    if (!q) continue;
    let delivered = 0;
    for (let page = 1; delivered < cap; page++) {
      const url = `https://search.openfoodfacts.org/search?${new URLSearchParams({
        q, page: String(page), page_size: String(PAGE_SIZE), fields: FIELDS,
      })}`;
      await searchLimit();
      const { hits, pageCount } = parseSearchResponse(await fetchJson(url, { headers: HEADERS }));
      if (page === 1 && hits.length === 0) {
        await Actor.pushData(stamp({ query: String(terms), found: false, error: 'no_search_results' }, url));
      }
      for (const hit of hits) {
        if (delivered >= cap) break;
        const before = charged;
        if (!(await deliver(String(terms), hit, url))) await stop();
        if (charged > before) delivered += 1;
      }
      if (hits.length < PAGE_SIZE || page >= pageCount) break;
    }
  }
} catch (e) {
  await finish({ errors: 1, failure_class: e.failureClass || 'unknown' });
  throw e;
}

await finish();
await Actor.exit();
