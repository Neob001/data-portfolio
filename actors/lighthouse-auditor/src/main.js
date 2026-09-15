import { Actor } from 'apify';
import puppeteer from 'puppeteer';
import lighthouse from 'lighthouse';
import desktopConfig from 'lighthouse/core/config/desktop-config.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { lhrToRecord, normalizeUrl } from './transform.js';

const AUDIT_TIMEOUT_MS = 120000;
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { urls = [], strategy = 'mobile', maxUrls = 100 } = input;

if (!Array.isArray(urls) || urls.length === 0) {
  throw new Error('Provide "urls": pages to audit, e.g. ["https://example.com"].');
}
const strategies = strategy === 'both' ? ['mobile', 'desktop'] : [strategy === 'desktop' ? 'desktop' : 'mobile'];

const executablePath = process.env.APIFY_CHROME_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined;
async function launch() {
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}

let browser = await launch();
let pushed = 0;
let charged = 0;
let misses = 0;
let stop = false;
const seen = new Set();

async function auditOnce(url, strat) {
  const page = await browser.newPage();
  try {
    const flags = { output: 'json', logLevel: 'error', onlyCategories: CATEGORIES, maxWaitForLoad: 45000 };
    const run = lighthouse(url, flags, strat === 'desktop' ? desktopConfig : undefined, page);
    const timeout = new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('audit timeout'), { code: 'AUDIT_TIMEOUT' })), AUDIT_TIMEOUT_MS));
    const result = await Promise.race([run, timeout]);
    return lhrToRecord(result.lhr, strat);
  } finally {
    await page.close().catch(() => {});
  }
}

try {
  for (const raw of urls.slice(0, maxUrls)) {
    if (stop) break;
    const url = normalizeUrl(raw);
    if (!url) {
      await Actor.pushData(stamp({ query: String(raw), ok: false, error_code: 'INVALID_URL' }, 'input'));
      misses += 1;
      continue;
    }
    for (const strat of strategies) {
      const key = `${url}|${strat}`;
      if (seen.has(key) || stop) continue;
      seen.add(key);
      let rec;
      try {
        rec = await auditOnce(url, strat);
      } catch (e) {
        if (e.failureClass === 'schema_change') throw e;
        rec = { ok: false, error_code: e.code || 'AUDIT_FAILED', error_message: String(e.message || e).slice(0, 300) };
        // A hung or crashed Chrome poisons later audits: start a fresh browser.
        await browser.close().catch(() => {});
        browser = await launch();
      }
      if (!rec.ok) {
        await Actor.pushData(stamp({ query: String(raw), requested_url: url, strategy: strat, ...rec }, url));
        misses += 1;
        continue;
      }
      await Actor.pushData(stamp({ query: String(raw), ...rec }, rec.final_url || url));
      pushed += 1;
      // PPE: one charge per completed audit (URL x strategy). Unreachable pages and invalid URLs are free.
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'page-audited' });
      charged += 1;
      if (eventChargeLimitReached) stop = true;
    }
  }
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed + misses, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown', duration_ms: Date.now() - started,
  });
  await browser.close().catch(() => {});
  throw e;
}

await browser.close().catch(() => {});
await writeRunSummary(Actor, { rows: pushed + misses, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
