// Reads the nightly tenders index (GitHub release `tenders-index`, or a local directory / file:// URL in tests):
// manifest.json + JSONL shards compressed with brotli (.br) or gzip (.gz), streamed line by line.
import { createReadStream, readFileSync } from 'node:fs';
import { createBrotliDecompress, createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { Readable, PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { FetchError } from './lib/http.js';

export const DEFAULT_INDEX_URL = 'https://github.com/Neob001/data-portfolio/releases/download/tenders-index';
const UA = 'factpipe-government-tenders-api';

export const indexBase = (env = process.env) => (env.TENDERS_INDEX_URL || DEFAULT_INDEX_URL).replace(/\/$/, '');
const isLocal = (base) => base.startsWith('file:') || base.startsWith('/') || base.startsWith('.');
const localPath = (base, rel) => `${base.startsWith('file:') ? fileURLToPath(base) : base}/${rel}`;

async function getWithRetry(url, { tries = 4, timeoutMs = 60000 } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    if (i) await new Promise((r) => setTimeout(r, 1500 * 2 ** (i - 1)));
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok) return res;
      last = new FetchError(`HTTP ${res.status} at ${url}`, res.status >= 500 || res.status === 404 ? 'site_down' : 'http_error', res.status);
      await res.arrayBuffer().catch(() => null);
      if (res.status < 500 && res.status !== 404 && res.status !== 429) break;
    } catch (e) {
      last = new FetchError(`${e.message} at ${url}`, e.name === 'TimeoutError' ? 'timeout' : 'site_down');
    }
  }
  throw last;
}

export async function loadManifest(base) {
  if (isLocal(base)) return JSON.parse(readFileSync(localPath(base, 'manifest.json'), 'utf8'));
  const res = await getWithRetry(`${base}/manifest.json`);
  try {
    return JSON.parse(await res.text());
  } catch {
    throw new FetchError('tenders index manifest is not JSON', 'schema_change');
  }
}

/** Async iterator over the parsed records of one shard. */
export async function* readShard(base, file) {
  let source;
  if (isLocal(base)) source = createReadStream(localPath(base, file));
  else source = Readable.fromWeb((await getWithRetry(`${base}/${file}`, { timeoutMs: 300000 })).body);
  const unzip = file.endsWith('.br') ? createBrotliDecompress() : file.endsWith('.gz') ? createGunzip() : new PassThrough();
  source.on('error', (e) => unzip.destroy(e));
  const rl = createInterface({ input: source.pipe(unzip), crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line) continue;
      yield JSON.parse(line);
    }
  } finally {
    rl.close();
    source.destroy?.();
  }
}
