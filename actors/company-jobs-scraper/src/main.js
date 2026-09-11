import { Actor } from 'apify';
import { fetchJson, rateLimiter, FetchError } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { detectAtsBoards, apiUrlFor, parseJobs, CAREERS_PATHS } from './transform.js';

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; factpipe-jobs/1.0)' };

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { companyUrls = [], maxJobsPerCompany = 200 } = input;

if (!Array.isArray(companyUrls) || companyUrls.length === 0) {
  throw new Error('Provide "companyUrls": company websites or direct ATS board URLs (Greenhouse / Lever / Ashby).');
}

const limit = rateLimiter(400);

async function fetchText(url) {
  await limit();
  const res = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(25000) });
  if (!res.ok) {
    const e = new FetchError(`HTTP ${res.status} at ${url}`, res.status >= 500 ? 'site_down' : 'http_error', res.status);
    throw e;
  }
  return res.text();
}

let pushed = 0;
let charged = 0;
let misses = 0;

try {
  for (const raw of companyUrls) {
    const inputUrl = String(raw || '').trim();
    if (!inputUrl) continue;
    const url = /^https?:\/\//i.test(inputUrl) ? inputUrl : `https://${inputUrl}`;

    // 1. Direct ATS URL, or 2. scan homepage, or 3. probe common careers paths.
    let boards = detectAtsBoards(url);
    if (boards.length === 0) {
      try { boards = detectAtsBoards(await fetchText(url)); } catch { /* keep probing */ }
    }
    if (boards.length === 0) {
      const origin = new URL(url).origin;
      for (const path of CAREERS_PATHS) {
        try { boards = detectAtsBoards(await fetchText(origin + path)); } catch { /* next */ }
        if (boards.length > 0) break;
      }
    }
    if (boards.length === 0) {
      await Actor.pushData(stamp({ query: inputUrl, found: false, reason: 'no_supported_ats_detected' }, url));
      misses += 1; // never charged
      continue;
    }

    let companyJobs = 0;
    for (const b of boards.slice(0, 3)) {
      await limit();
      let jobs;
      try {
        jobs = parseJobs(b.ats, b.board, await fetchJson(apiUrlFor(b), { headers: UA }));
      } catch (e) {
        if (e instanceof FetchError && e.status === 404) continue; // dead board link
        throw e;
      }
      for (const job of jobs) {
        if (companyJobs >= maxJobsPerCompany) break;
        await Actor.pushData(stamp({ query: inputUrl, found: true, ...job }, apiUrlFor(b)));
        pushed += 1;
        companyJobs += 1;
        // PPE: charge per job row delivered; detection misses and empty boards are free.
        const { eventChargeLimitReached } = await Actor.charge({ eventName: 'job-result' });
        charged += 1;
        if (eventChargeLimitReached) {
          await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
          await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
        }
      }
    }
    if (companyJobs === 0) {
      await Actor.pushData(stamp({ query: inputUrl, found: false, reason: 'ats_board_empty' }, url));
      misses += 1;
    }
  }
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed + misses, charged_events: charged, duration_ms: Date.now() - started });
await Actor.exit();
