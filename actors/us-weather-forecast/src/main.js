import { Actor } from 'apify';
import { fetchJson, rateLimiter, FetchError } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import { parseCoordinate, parsePoints, parseForecast } from './transform.js';

// NWS asks for an identifying User-Agent; data is US public domain.
const NWS_HEADERS = { 'User-Agent': 'apify-actor-us-weather-forecast contact@apify.com' };

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const { coordinates = [], hourly = false, maxPeriodsPerLocation = 14 } = input;

if (!Array.isArray(coordinates) || coordinates.length === 0) {
  throw new Error('Provide "coordinates" as a list of "lat,lon" strings, e.g. "40.7128,-74.0060".');
}

const limit = rateLimiter(500);
let pushed = 0;
let charged = 0;
let errors = 0;

try {
  for (const raw of coordinates) {
    const coord = parseCoordinate(raw);
    if (!coord) {
      await Actor.pushData(stamp({ location: String(raw), error: 'invalid_coordinate' }, 'https://api.weather.gov'));
      continue; // not charged
    }
    let points;
    try {
      await limit();
      points = parsePoints(await fetchJson(`https://api.weather.gov/points/${coord.lat},${coord.lon}`, { headers: NWS_HEADERS }));
    } catch (e) {
      if (e instanceof FetchError && e.status === 404) {
        await Actor.pushData(stamp({ location: String(raw), error: 'outside_us_coverage' }, 'https://api.weather.gov'));
        continue; // not charged
      }
      throw e;
    }
    const url = hourly && points.hourlyUrl ? points.hourlyUrl : points.forecastUrl;
    await limit();
    const periods = parseForecast(await fetchJson(url, { headers: NWS_HEADERS }));
    const location = points.locationName || `${coord.lat},${coord.lon}`;
    for (const p of periods.slice(0, maxPeriodsPerLocation)) {
      await Actor.pushData(stamp({
        location, latitude: coord.lat, longitude: coord.lon, grid_id: points.gridId, ...p,
      }, url));
      pushed += 1;
    }
    // PPE: one charge per successfully forecast location, not per period.
    const { eventChargeLimitReached } = await Actor.charge({ eventName: 'location-forecast' });
    charged += 1;
    if (eventChargeLimitReached) {
      await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started });
      await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
    }
  }
} catch (e) {
  await writeRunSummary(Actor, {
    rows: pushed, charged_events: charged, errors: errors + 1, failure_class: e.failureClass || 'unknown',
    duration_ms: Date.now() - started,
  });
  throw e;
}

await writeRunSummary(Actor, { rows: pushed, charged_events: charged, errors, duration_ms: Date.now() - started });
await Actor.exit();
