# US Weather Forecast (NWS Official)

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

| Event | Meaning |
|---|---|
| `location-forecast` | One location successfully forecast (all its period records included). Invalid or out-of-coverage locations are never charged. |

## Reliability

Official api.weather.gov, retries with backoff, structured failure reporting, daily issue triage.
