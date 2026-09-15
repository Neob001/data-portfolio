import { Actor } from 'apify';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { parseVatInput, parseViesResponse, VIES_URL } from './transform.js';

// VIES throttles per member state; keep concurrency low and back off on throttle errors.
const CONCURRENCY = 2;
const MAX_ATTEMPTS = 6;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { vatNumbers = [], defaultCountryCode = null } = input;

if (!Array.isArray(vatNumbers) || vatNumbers.length === 0) {
  throw new Error('Provide "vatNumbers", e.g. ["IE6388047V", "DE811569869"].');
}

async function check({ countryCode, vatNumber }) {
  let last = 'UNKNOWN';
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      const res = await fetch(VIES_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ countryCode, vatNumber }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.status >= 500) { last = `HTTP_${res.status}`; await sleep(1500 * (attempt + 1)); continue; }
      const parsed = parseViesResponse(await res.json());
      if (parsed.status !== 'transient') return parsed;
      last = parsed.error;
    } catch (e) {
      if (e.failureClass === 'schema_change') throw e;
      last = e.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR';
    }
    await sleep(2000 * (attempt + 1) + Math.floor(Math.random() * 500));
  }
  return { status: 'transient', error: last };
}

let charged = 0;
let rows = 0;
let stop = false;
const seen = new Set();
const queue = [];
for (const raw of vatNumbers) {
  const parsed = parseVatInput(raw, defaultCountryCode);
  const key = parsed ? parsed.countryCode + parsed.vatNumber : null;
  if (key && seen.has(key)) continue;
  if (key) seen.add(key);
  queue.push({ raw: String(raw), parsed });
}

async function worker() {
  while (queue.length > 0 && !stop) {
    const { raw, parsed } = queue.shift();
    if (!parsed) {
      await Actor.pushData(stamp({ query: raw, checked: false, reason: 'unrecognized_format_or_non_eu_country' }, VIES_URL));
      rows += 1;
      continue;
    }
    const r = await check(parsed);
    if (r.status === 'valid' || r.status === 'invalid') {
      await Actor.pushData(stamp({ query: raw, checked: true, ...r.record }, VIES_URL));
      rows += 1;
      // PPE: charge only definitive answers (valid or invalid); throttled/unavailable checks are free.
      const { eventChargeLimitReached } = await Actor.charge({ eventName: 'vat-checked' });
      charged += 1;
      if (eventChargeLimitReached) stop = true;
    } else {
      await Actor.pushData(stamp({
        query: raw, checked: false, country_code: parsed.countryCode, vat_number: parsed.vatNumber,
        reason: r.status === 'transient' ? 'member_state_service_unavailable_retry_later' : 'vies_rejected_input',
        vies_error: r.error,
      }, VIES_URL));
      rows += 1;
    }
  }
}

try {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
} catch (e) {
  await writeRunSummary(Actor, {
    rows, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown', duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
