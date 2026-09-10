import { Actor } from 'apify';
import { fetchJson, rateLimiter, FetchError } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { profileToRecord, bestSearchMatch, normalizeCompanyNumber, CH_BASE } from './transform.js';

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { companyNumbers = [], companyNames = [], apiKey = null } = input;

const key = apiKey || process.env.COMPANIES_HOUSE_API_KEY;
if (!key) {
  throw new Error(
    'A Companies House API key is required. Create one free at https://developer.company-information.service.gov.uk/ and pass it as the "apiKey" input.',
  );
}
if (companyNumbers.length + companyNames.length === 0) {
  throw new Error('Provide at least one company number or company name.');
}

const AUTH = { Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}` };
// Companies House allows 600 req / 5 min; stay at ~1.6 req/s.
const limit = rateLimiter(650);

let pushed = 0;
let charged = 0;
let notFound = 0;
let failureClass = null;

async function lookupNumber(number, queriedAs) {
  const url = `${CH_BASE}/company/${number}`;
  try {
    await limit();
    const profile = await fetchJson(url, { headers: AUTH });
    const rec = profileToRecord(profile);
    if (!rec) throw Object.assign(new Error('Malformed profile'), { failureClass: 'schema_change' });
    await Actor.pushData(stamp({ query: queriedAs, found: true, ...rec }, url));
    pushed += 1;
    // PPE: charge only successful lookups; misses are free.
    const { eventChargeLimitReached } = await Actor.charge({ eventName: 'company-found' });
    charged += 1;
    return eventChargeLimitReached;
  } catch (e) {
    if (e instanceof FetchError && e.status === 404) {
      await Actor.pushData(stamp({ query: queriedAs, found: false }, url));
      notFound += 1;
      return false;
    }
    throw e;
  }
}

try {
  for (const raw of companyNumbers) {
    const number = normalizeCompanyNumber(raw);
    if (!number) continue;
    if (await lookupNumber(number, String(raw))) break;
  }
  for (const name of companyNames) {
    await limit();
    const searchUrl = `${CH_BASE}/search/companies?q=${encodeURIComponent(name)}&items_per_page=10`;
    const search = await fetchJson(searchUrl, { headers: AUTH });
    const number = bestSearchMatch(search, name);
    if (!number) {
      await Actor.pushData(stamp({ query: name, found: false }, searchUrl));
      notFound += 1;
      continue;
    }
    if (await lookupNumber(number, name)) break;
  }
} catch (e) {
  failureClass = e.failureClass || 'unknown';
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: failureClass,
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, {
  rows: pushed + notFound, charged_events: charged, duration_ms: Date.now() - started,
});
await Actor.exit();
