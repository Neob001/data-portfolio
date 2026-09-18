import { Actor } from 'apify';
import puppeteer from 'puppeteer';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import {
  dedupeUrls, screenshotKey, contentTypeFor, screenshotUrlFor,
  classifyNavigationError, cookieBannerCss, deviceViewport, buildRow,
} from './transform.js';

const CONCURRENCY = 3;

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const {
  urls = [],
  fullPage = true,
  viewportWidth = 1280,
  viewportHeight = 800,
  device = 'desktop',
  format = 'png',
  jpegQuality = 80,
  waitUntil = 'networkidle2',
  delayMs = 0,
  hideCookieBanners = true,
  timeoutSecs = 30,
} = input;

if (!Array.isArray(urls) || urls.length === 0) {
  throw new Error('Provide "urls": pages to screenshot, e.g. ["https://example.com"].');
}

const clampedDelayMs = Math.max(0, Math.min(10000, Number(delayMs) || 0));
const timeoutMs = Math.max(1, Number(timeoutSecs) || 30) * 1000;
const { valid, invalid } = dedupeUrls(urls);

const env = Actor.getEnv();
const storeId = env.defaultKeyValueStoreId;

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
let failed = 0;
let charged = 0;
let stop = false;

// Invalid URLs are reported once each and never touch the browser or the charge.
for (const raw of invalid) {
  await Actor.pushData(stamp(buildRow({ url: String(raw), format, ok: false, error: 'invalid_url' }), String(raw)));
  failed += 1;
}

async function captureOnce(url) {
  const page = await browser.newPage();
  try {
    const { viewport, userAgent } = deviceViewport({ device, viewportWidth, viewportHeight });
    await page.setViewport(viewport);
    if (userAgent) await page.setUserAgent(userAgent);

    let response = null;
    try {
      response = await page.goto(url, { waitUntil, timeout: timeoutMs });
    } catch (e) {
      // Sites with long-lived connections (analytics, chat widgets) never reach networkidle/load;
      // if the document itself has rendered, the screenshot is still what the user wants.
      const rendered = e.name === 'TimeoutError' && page.url() !== 'about:blank'
        && await page.evaluate(() => document.readyState !== 'loading' && !!document.body).catch(() => false);
      if (!rendered) throw e;
    }
    const statusCode = response ? response.status() : null;
    if (response && statusCode >= 400) {
      const err = new Error(`HTTP ${statusCode} at ${url}`);
      err.statusCode = statusCode;
      throw err;
    }

    if (hideCookieBanners) {
      await page.addStyleTag({ content: cookieBannerCss() }).catch(() => {});
    }
    if (clampedDelayMs > 0) {
      await new Promise((r) => setTimeout(r, clampedDelayMs));
    }

    const pageTitle = await page.title().catch(() => null);
    const finalUrl = response ? response.url() : page.url();
    const screenshotOpts = { fullPage, type: format };
    if (format === 'jpeg') screenshotOpts.quality = jpegQuality;
    const buffer = await page.screenshot(screenshotOpts);

    const dims = await page.evaluate((full) => ({
      width: full ? Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0) : window.innerWidth,
      height: full ? Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0) : window.innerHeight,
    }), fullPage).catch(() => ({ width: viewport.width, height: viewport.height }));

    return {
      ok: true,
      statusCode,
      finalUrl,
      capture: {
        buffer,
        key: screenshotKey(url, format),
        width: dims.width,
        height: dims.height,
        bytes: buffer.length,
        pageTitle,
        takenAt: new Date().toISOString(),
      },
    };
  } finally {
    await page.close().catch(() => {});
  }
}

async function processUrl(url) {
  if (stop) return;
  let attempt;
  try {
    attempt = await captureOnce(url);
  } catch (e) {
    const errorCode = classifyNavigationError(e, e.statusCode);
    if (errorCode === 'navigation_timeout') {
      // Retry once on navigation timeout, with a fresh page.
      try {
        attempt = await captureOnce(url);
      } catch (e2) {
        attempt = { ok: false, statusCode: e2.statusCode ?? null, error: classifyNavigationError(e2, e2.statusCode) };
      }
    } else {
      attempt = { ok: false, statusCode: e.statusCode ?? null, error: errorCode };
    }
  }

  if (!attempt.ok) {
    await Actor.pushData(stamp(buildRow({ url, format, ok: false, statusCode: attempt.statusCode, error: attempt.error }), url));
    failed += 1;
    return;
  }

  const { capture } = attempt;
  const screenshotUrl = screenshotUrlFor(storeId, capture.key);
  await Actor.setValue(capture.key, capture.buffer, { contentType: contentTypeFor(format) });
  await Actor.pushData(stamp(buildRow({
    url,
    format,
    ok: true,
    statusCode: attempt.statusCode,
    finalUrl: attempt.finalUrl,
    capture: { ...capture, screenshotUrl },
  }), attempt.finalUrl || url));
  pushed += 1;

  // PPE: one charge per screenshot actually stored. Failures are free.
  const { eventChargeLimitReached } = await Actor.charge({ eventName: 'screenshot-taken' });
  charged += 1;
  if (eventChargeLimitReached) stop = true;
}

async function runPool(items, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !stop) {
      const i = next;
      next += 1;
      try {
        await worker(items[i]);
      } catch (e) {
        // A hung/crashed Chrome poisons later captures: start a fresh browser and record a failure.
        await Actor.pushData(stamp(
          buildRow({ url: items[i], format, ok: false, error: classifyNavigationError(e, e.statusCode) }),
          items[i],
        ));
        failed += 1;
        await browser.close().catch(() => {});
        browser = await launch();
      }
    }
  });
  await Promise.all(runners);
}

try {
  await runPool(valid, CONCURRENCY, processUrl);
} finally {
  await browser.close().catch(() => {});
}

await writeRunSummary(Actor, {
  rows: pushed + failed,
  charged_events: charged,
  errors: failed,
  duration_ms: Date.now() - started,
});
await Actor.exit();
