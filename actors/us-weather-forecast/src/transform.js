// Pure transforms for NWS (api.weather.gov) responses.

/** "40.7128,-74.006" -> {lat, lon} or null. */
export function parseCoordinate(s) {
  const m = String(s || '').trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/** Points response -> { forecastUrl, hourlyUrl, gridId, locationName }. */
export function parsePoints(response) {
  const p = response?.properties;
  if (!p || !p.forecast) {
    const e = new Error('Unexpected NWS points response: properties.forecast missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  const rel = p.relativeLocation?.properties;
  return {
    forecastUrl: p.forecast,
    hourlyUrl: p.forecastHourly || null,
    gridId: p.gridId || null,
    locationName: rel ? `${rel.city}, ${rel.state}` : null,
  };
}

/** Forecast response -> period records (without location stamp). */
export function parseForecast(response) {
  const periods = response?.properties?.periods;
  if (!Array.isArray(periods)) {
    const e = new Error('Unexpected NWS forecast response: periods missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  const updated = response.properties.updateTime || null;
  return periods.map((p) => ({
    period_number: p.number,
    period_name: p.name || null,
    start_time: p.startTime,
    end_time: p.endTime,
    is_daytime: Boolean(p.isDaytime),
    temperature: p.temperature ?? null,
    temperature_unit: p.temperatureUnit || null,
    precipitation_probability_pct: p.probabilityOfPrecipitation?.value ?? null,
    wind_speed: p.windSpeed || null,
    wind_direction: p.windDirection || null,
    short_forecast: p.shortForecast || null,
    detailed_forecast: p.detailedForecast || null,
    forecast_updated_at: updated,
  }));
}
