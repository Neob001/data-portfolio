import { Actor } from 'apify';
import { writeRunSummary } from './lib/run_summary.js';
import { runCrawl } from './crawler.js';

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const {
  startUrls = [],
  maxPagesPerSite = 50,
  checkExternalLinks = true,
  checkImagesAndAssets = true,
  includeOkLinks = false,
  respectRobotsTxt = true,
  maxRunMinutes = 3,
} = input;

if (!Array.isArray(startUrls) || startUrls.length === 0) {
  throw new Error('Provide "startUrls": one or more website URLs to crawl for broken links.');
}

let pushed = 0;
let charged = 0;

async function pushData(row) {
  await Actor.pushData(row);
  pushed += 1;
}

async function charge() {
  const result = await Actor.charge({ eventName: 'page-scanned' });
  charged += 1;
  return result;
}

let summaries = [];
try {
  summaries = await runCrawl(
    {
      startUrls,
      maxPagesPerSite: Math.max(1, Math.min(5000, Number(maxPagesPerSite) || 50)),
      checkExternalLinks,
      checkImagesAndAssets,
      includeOkLinks,
      respectRobotsTxt,
      maxRunMinutes: Math.max(1, Math.min(1440, Number(maxRunMinutes) || 3)),
    },
    { pushData, charge },
  );
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await Actor.setValue('SITE_SUMMARY', summaries);
await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
