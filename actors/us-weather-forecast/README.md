# US Weather Forecast API — NWS/NOAA Hourly & 7-Day, No Key

Official **US National Weather Service** forecasts for any US coordinates — daily or hourly periods as clean, flat JSON records. Public-domain government data, no API key, no rate-limit anxiety. Feed logistics planning, event ops, energy forecasting, or AI agents with the same forecast data NOAA publishes.

## What you get

One record per forecast period per location:

```json
{
  "location": "Manhattan, NY",
  "latitude": 40.7128,
  "longitude": -74.006,
  "grid_id": "OKX",
  "period_number": 1,
  "period_name": "Overnight",
  "start_time": "2026-09-11T04:00:00-04:00",
  "end_time": "2026-09-11T06:00:00-04:00",
  "is_daytime": false,
  "temperature": 70,
  "temperature_unit": "F",
  "precipitation_probability_pct": 17,
  "wind_speed": "8 mph",
  "wind_direction": "N",
  "short_forecast": "Chance Rain Showers",
  "detailed_forecast": "A chance of rain showers. Mostly cloudy. Low around 70...",
  "forecast_updated_at": "2026-09-11T07:32:00+00:00",
  "source_url": "https://api.weather.gov/gridpoints/OKX/33,42/forecast",
  "fetched_at": "2026-09-11T12:00:00.000Z"
}
```

## Use cases

- **Logistics & field ops**: batch forecasts for all your depots/sites in one scheduled run.
- **Events & staffing**: precipitation probability and wind for the next 7 days per venue.
- **Data pipelines & agents**: deterministic records, tiny input schema — ideal via API or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `coordinates` | string[], required | US locations as `"lat,lon"`, e.g. `"40.7128,-74.0060"` |
| `hourly` | boolean | Hourly periods instead of day/night (default false) |
| `maxPeriodsPerLocation` | integer | Periods per location (default 14 = 7 days) |

US coverage only (NWS). Non-US coordinates return an uncharged `outside_us_coverage` record.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `location-forecast` | **$2.00 per 1,000** ($0.002 each) | One location successfully forecast (all its period records included). Invalid or out-of-coverage locations are never charged. |

Example: 1,000 locations cost **$2.00**. You only pay for delivered results.

## Related factpipe Actors

- [ECB Exchange Rates API — Official Euro FX Rates, History](https://apify.com/factpipe/ecb-exchange-rates) — official ECB euro exchange rates
- [Wikipedia Scraper API — Articles, Summaries & Full Text](https://apify.com/factpipe/wikipedia-scraper) — Wikipedia articles and summaries

## FAQ

**Do I need a weather API key?**
No. Data comes from the official US National Weather Service (api.weather.gov), which is public domain and keyless.

**Can I get hourly forecasts for many locations at once?**
Yes. Pass any number of `lat,lon` coordinates and set `hourly: true`; you pay once per location, all its forecast periods included.

**Does it work outside the US?**
No. NWS forecasts cover US locations only; out-of-coverage locations are skipped and never charged.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official api.weather.gov, retries with backoff, structured failure reporting, daily issue triage.
