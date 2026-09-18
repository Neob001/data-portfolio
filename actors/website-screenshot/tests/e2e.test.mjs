import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { cookieBannerCss, deviceViewport } from '../src/transform.js';

// Real headless-Chrome integration test. Skips gracefully (never fails the suite) when
// puppeteer isn't installed or no compatible Chrome/Chromium binary is available locally --
// `npm install && npm test` must still pass on a machine with no browser.
async function tryLaunchBrowser() {
  let puppeteer;
  try {
    ({ default: puppeteer } = await import('puppeteer'));
  } catch {
    return { skip: 'puppeteer is not installed' };
  }
  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });
    return { browser };
  } catch (e) {
    return { skip: `no usable Chrome/Chromium binary locally (${e.message.split('\n')[0]})` };
  }
}

/** Minimal fixture page with a fake OneTrust-style cookie banner and a tall body
 * (so fullPage vs viewport capture is meaningfully different). */
function startFixtureServer() {
  const html = `<!doctype html>
<html><head><title>Fixture Page</title><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body>
  <div id="onetrust-banner-sdk" style="position:fixed;bottom:0;left:0;right:0;height:120px;background:#222;color:#fff;">
    We use cookies. <button>Accept</button>
  </div>
  <h1>Fixture</h1>
  <div style="height:2000px;background:linear-gradient(#fff,#0000ff);">tall content</div>
</body></html>`;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('real headless run: navigates, hides the cookie banner, and captures a valid PNG', async (t) => {
  const launch = await tryLaunchBrowser();
  if (launch.skip) {
    t.skip(launch.skip);
    return;
  }
  const { browser } = launch;
  const site = await startFixtureServer();
  try {
    const page = await browser.newPage();
    const { viewport } = deviceViewport({ device: 'desktop', viewportWidth: 800, viewportHeight: 600 });
    await page.setViewport(viewport);

    const response = await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 15000 });
    assert.equal(response.status(), 200);

    // Banner is visible before we hide it.
    const visibleBefore = await page.evaluate(
      () => getComputedStyle(document.getElementById('onetrust-banner-sdk')).display !== 'none',
    );
    assert.equal(visibleBefore, true);

    await page.addStyleTag({ content: cookieBannerCss() });

    const hiddenAfter = await page.evaluate(
      () => getComputedStyle(document.getElementById('onetrust-banner-sdk')).display === 'none',
    );
    assert.equal(hiddenAfter, true, 'cookie banner CSS must actually hide the banner element');

    const title = await page.title();
    assert.equal(title, 'Fixture Page');

    const viewportBuffer = await page.screenshot({ type: 'png', fullPage: false });
    assert.ok(Buffer.isBuffer(viewportBuffer) && viewportBuffer.length > 0);
    // PNG magic bytes.
    assert.deepEqual([...viewportBuffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    const fullPageBuffer = await page.screenshot({ type: 'png', fullPage: true });
    assert.ok(fullPageBuffer.length > viewportBuffer.length, 'full-page capture of a tall page must be larger than the viewport-only capture');

    const jpegBuffer = await page.screenshot({ type: 'jpeg', quality: 80, fullPage: false });
    assert.equal(jpegBuffer[0], 0xff, 'JPEG magic byte');
    assert.equal(jpegBuffer[1], 0xd8, 'JPEG magic byte');

    await page.close();
  } finally {
    await site.close();
    await browser.close().catch(() => {});
  }
});

test('real headless run: mobile device preset actually changes the rendered viewport', async (t) => {
  const launch = await tryLaunchBrowser();
  if (launch.skip) {
    t.skip(launch.skip);
    return;
  }
  const { browser } = launch;
  const site = await startFixtureServer();
  try {
    const page = await browser.newPage();
    const { viewport, userAgent } = deviceViewport({ device: 'mobile' });
    await page.setViewport(viewport);
    await page.setUserAgent(userAgent);
    await page.goto(site.url, { waitUntil: 'networkidle2', timeout: 15000 });

    const reportedWidth = await page.evaluate(() => window.innerWidth);
    const reportedUA = await page.evaluate(() => navigator.userAgent);
    assert.equal(reportedWidth, 390);
    assert.match(reportedUA, /Mobile/);

    await page.close();
  } finally {
    await site.close();
    await browser.close().catch(() => {});
  }
});
