import { Actor } from 'apify';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import {
  parseCsv, ofacEntries, parseEuXml, parseUkXml, parseUnXml, buildIndex, screenName,
  thresholdFromInput, listsFromInput, decideListOutcomes, buildRecord,
  SDN_URL, ALT_URL, LIST_SOURCES,
} from './transform.js';

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { names = [], minScore = 85, includeAliases = true } = input;
const threshold = thresholdFromInput(minScore);

if (!Array.isArray(names) || names.length === 0) {
  throw new Error('Provide at least one name to screen in "names".');
}
const lists = listsFromInput(input.lists);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** GET a list file as text with retries/backoff and structured failure classes. */
async function fetchText(url, { encoding = 'utf-8', retries = 2, timeoutMs = 300000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0) await sleep(2000 * 2 ** (attempt - 1));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'apify-actor-ofac-sanctions-screening' },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status} downloading ${url}`);
        e.failureClass = res.status >= 500 ? 'site_down' : (res.status === 403 || res.status === 429 ? 'blocked' : 'http_error');
        lastErr = e;
        if (e.failureClass === 'http_error') break;
        continue;
      }
      const buf = await res.arrayBuffer();
      return new TextDecoder(encoding).decode(buf);
    } catch (e) {
      lastErr = e;
      if (e.name === 'AbortError') {
        lastErr = new Error(`Timeout after ${timeoutMs}ms downloading ${url}`);
        lastErr.failureClass = 'timeout';
      } else if (!e.failureClass) e.failureClass = 'site_down';
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}

/** Download + parse one list. Raw text goes out of scope as soon as parsing ends. */
async function loadList(list) {
  const source_url = LIST_SOURCES[list].url;
  try {
    let parsed;
    if (list === 'OFAC_SDN') {
      const [sdnText, altText] = await Promise.all([
        fetchText(SDN_URL, { encoding: 'latin1' }),
        includeAliases ? fetchText(ALT_URL, { encoding: 'latin1' }) : Promise.resolve(''),
      ]);
      parsed = { entries: ofacEntries(parseCsv(sdnText), includeAliases ? parseCsv(altText) : []), publication_date: null };
    } else {
      const parser = { EU: parseEuXml, UK: parseUkXml, UN: parseUnXml }[list];
      parsed = parser(await fetchText(source_url));
    }
    return { list, ok: true, entries: parsed.entries, entry_count: parsed.entries.length, source_url, publication_date: parsed.publication_date };
  } catch (e) {
    return { list, ok: false, source_url, failure_class: e.failureClass || 'unknown', message: String(e.message || e).slice(0, 300) };
  }
}

let pushed = 0;
let charged = 0;
let decision = null;
const summaryExtras = () => ({
  lists_requested: lists,
  lists_screened: decision?.screened ?? [],
  lists_unavailable: decision?.unavailable ?? [],
  list_failures: decision?.failures ?? [],
  list_entries: Object.fromEntries((decision?.lists_info ?? []).map((l) => [l.list, l.entries])),
});

try {
  const outcomes = await Promise.all(lists.map(loadList));
  decision = decideListOutcomes(outcomes);
  if (decision.allFailed) {
    const first = decision.failures[0] || {};
    const e = new Error(`All selected sanctions lists failed to download: ${decision.failures.map((f) => `${f.list} (${f.failure_class})`).join(', ')}`);
    e.failureClass = first.failure_class || 'site_down';
    throw e;
  }
  for (const f of decision.failures) console.warn(`List ${f.list} unavailable (${f.failure_class}): ${f.message}`);

  const index = buildIndex(outcomes.flatMap((o) => (o.ok ? o.entries : [])), { includeAliases });
  for (const o of outcomes) delete o.entries;
  const downloadedAt = new Date().toISOString();

  for (const name of names) {
    if (typeof name !== 'string' || !name.trim()) continue;
    const record = buildRecord(screenName(name, index, threshold), decision, downloadedAt);
    await Actor.pushData(stamp(record, record.source_url));
    pushed += 1;
    // PPE: every completed screening (match or clear) over >=1 available list is a delivered result.
    if (!decision.canCharge) continue;
    const { eventChargeLimitReached } = await Actor.charge({ eventName: 'name-screened' });
    charged += 1;
    if (eventChargeLimitReached) {
      await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started, ...summaryExtras() });
      await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
    }
  }
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started, ...summaryExtras(),
  });
  throw e;
}

await writeRunSummary(Actor, {
  rows: pushed,
  charged_events: charged,
  errors: decision.failures.length,
  failure_class: decision.failures[0]?.failure_class ?? null,
  duration_ms: Date.now() - started,
  ...summaryExtras(),
});
await Actor.exit();
