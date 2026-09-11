import { Actor } from 'apify';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { parseCsv, buildEntries, screenName, SDN_URL, ALT_URL } from './transform.js';

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { names = [], minScore = 0.85, includeAliases = true } = input;

if (!Array.isArray(names) || names.length === 0) {
  throw new Error('Provide at least one name to screen in "names".');
}

async function fetchCsv(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'apify-actor-ofac-sanctions-screening' } });
  if (!res.ok) {
    const e = new Error(`HTTP ${res.status} downloading ${url}`);
    e.failureClass = res.status >= 500 ? 'site_down' : 'http_error';
    throw e;
  }
  const buf = await res.arrayBuffer();
  return new TextDecoder('latin1').decode(buf);
}

let pushed = 0;
let charged = 0;

try {
  const [sdnText, altText] = await Promise.all([
    fetchCsv(SDN_URL),
    includeAliases ? fetchCsv(ALT_URL) : Promise.resolve(''),
  ]);
  const entries = buildEntries(parseCsv(sdnText), includeAliases ? parseCsv(altText) : []);
  const publishInfo = `OFAC SDN list, ${entries.length} entries, downloaded ${new Date().toISOString()}`;

  for (const name of names) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const result = screenName(name, entries, minScore);
    await Actor.pushData(stamp({ ...result, list_publish_info: publishInfo }, SDN_URL));
    pushed += 1;
    // PPE: every completed screening (match or clear) is a delivered result.
    const { eventChargeLimitReached } = await Actor.charge({ eventName: 'name-screened' });
    charged += 1;
    if (eventChargeLimitReached) {
      await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
      await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
    }
  }
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
