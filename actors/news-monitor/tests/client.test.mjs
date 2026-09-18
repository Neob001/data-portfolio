import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createGdeltFetcher, RATE_LIMIT_MS } from '../src/client.js';

/** Fixture server that replies from a queue of canned responses, one per request, in order. */
function startQueueServer(responses) {
  let i = 0;
  const requestTimes = [];
  const server = http.createServer((req, res) => {
    requestTimes.push(Date.now());
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    res.writeHead(r.status, { 'content-type': r.contentType || 'text/plain' });
    res.end(r.body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}/`, requestTimes, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('RATE_LIMIT_MS matches GDELT\'s documented "one request every 5 seconds" ask', () => {
  assert.equal(RATE_LIMIT_MS, 5000);
});

test('createGdeltFetcher: a 429 with the real GDELT plain-text body is retried, not thrown as schema_change', async () => {
  const site = await startQueueServer([
    { status: 429, body: 'Please limit requests to one every 5 seconds or contact ...' },
    { status: 200, contentType: 'application/json', body: '{"articles":[]}' },
  ]);
  const fetchGdelt = createGdeltFetcher({ minDelayMs: 20, retries: 3 });
  const result = await fetchGdelt(site.url);
  await site.close();
  assert.deepEqual(result, { articles: [] });
});

test('createGdeltFetcher: the rate-limit text arriving on a 200 (not a proper 429) is also treated as transient', async () => {
  const site = await startQueueServer([
    { status: 200, contentType: 'text/plain', body: 'Please limit requests to one every 5 seconds or contact kalev.leetaru5@gmail.com' },
    { status: 200, contentType: 'application/json', body: '{"articles":[{"url":"https://a.example/1"}]}' },
  ]);
  const fetchGdelt = createGdeltFetcher({ minDelayMs: 20, retries: 3 });
  const result = await fetchGdelt(site.url);
  await site.close();
  assert.equal(result.articles.length, 1);
});

test('createGdeltFetcher: a genuinely empty {} success (GDELT\'s real zero-match reply) is not mistaken for an error', async () => {
  const site = await startQueueServer([{ status: 200, contentType: 'application/json', body: '{}' }]);
  const fetchGdelt = createGdeltFetcher({ minDelayMs: 20, retries: 0 });
  const result = await fetchGdelt(site.url);
  await site.close();
  assert.deepEqual(result, {});
});

test('createGdeltFetcher: genuinely malformed (non-JSON, non-rate-limit) body fails schema_change without retrying it away', async () => {
  const site = await startQueueServer([{ status: 200, contentType: 'text/html', body: '<html>oops</html>' }]);
  const fetchGdelt = createGdeltFetcher({ minDelayMs: 5, retries: 2 });
  await assert.rejects(() => fetchGdelt(site.url), (e) => e.failureClass === 'schema_change');
  await site.close();
});

test('createGdeltFetcher: 4xx (non-429) HTTP errors are not retried', async () => {
  const site = await startQueueServer([{ status: 400, body: 'bad query' }]);
  const fetchGdelt = createGdeltFetcher({ minDelayMs: 5, retries: 3 });
  await assert.rejects(() => fetchGdelt(site.url), (e) => e.failureClass === 'http_error');
  assert.equal(site.requestTimes.length, 1, 'no retry on a genuine 4xx');
  await site.close();
});

test('createGdeltFetcher: enforces the minimum spacing between successive requests', async () => {
  const site = await startQueueServer([
    { status: 200, contentType: 'application/json', body: '{}' },
    { status: 200, contentType: 'application/json', body: '{}' },
  ]);
  const fetchGdelt = createGdeltFetcher({ minDelayMs: 100, retries: 0 });
  await fetchGdelt(site.url);
  await fetchGdelt(site.url);
  await site.close();
  assert.ok(site.requestTimes[1] - site.requestTimes[0] >= 95, 'second request waited at least ~minDelayMs after the first');
});
