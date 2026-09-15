// Pure logic for ECB euro foreign exchange reference rates (SDMX data API).
// No I/O: tests run against golden CSV captures.

export const ECB_BASE = 'https://data-api.ecb.europa.eu/service/data/EXR';
export const STALE_DAYS = 10;

const CURRENCY_RX = /^[A-Z]{3}$/;

export function normalizeCurrencies(list) {
  const out = [];
  for (const raw of list || []) {
    const c = String(raw || '').trim().toUpperCase();
    if (CURRENCY_RX.test(c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** Build the SDMX data URL. currencies=[] means every currency. */
export function buildUrl({ currencies = [], startDate = null, endDate = null }) {
  const key = `D.${currencies.join('+')}.EUR.SP00.A`;
  const p = new URLSearchParams({ format: 'csvdata', detail: 'dataonly' });
  if (startDate) p.set('startPeriod', startDate);
  if (endDate) p.set('endPeriod', endDate);
  if (!startDate && !endDate) p.set('lastNObservations', '1');
  return `${ECB_BASE}/${key}?${p.toString()}`;
}

/** Parse ECB csvdata (detail=dataonly) into observations {currency, date, eurRate}. */
export function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  const header = (lines.shift() || '').split(',');
  const iCur = header.indexOf('CURRENCY');
  const iDate = header.indexOf('TIME_PERIOD');
  const iVal = header.indexOf('OBS_VALUE');
  if (iCur < 0 || iDate < 0 || iVal < 0) {
    const e = new Error('Unexpected ECB CSV header: CURRENCY/TIME_PERIOD/OBS_VALUE missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  const obs = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    const value = Number(cols[iVal]);
    if (!cols[iCur] || !/^\d{4}-\d{2}-\d{2}$/.test(cols[iDate]) || !Number.isFinite(value) || value <= 0) continue;
    obs.push({ currency: cols[iCur], date: cols[iDate], eurRate: value });
  }
  return obs;
}

/** Drop currencies whose newest observation is older than STALE_DAYS before `today` (discontinued). */
export function dropDiscontinued(obs, today = new Date()) {
  const newest = new Map();
  for (const o of obs) if (!newest.has(o.currency) || o.date > newest.get(o.currency)) newest.set(o.currency, o.date);
  const cutoff = new Date(today.getTime() - STALE_DAYS * 86400000).toISOString().slice(0, 10);
  const stale = new Set([...newest].filter(([, d]) => d < cutoff).map(([c]) => c));
  return { kept: obs.filter((o) => !stale.has(o.currency)), discontinued: [...stale].sort() };
}

const round = (n) => Math.round(n * 1e8) / 1e8;

/**
 * Observations (EUR-denominated) -> rows quoted against `base`.
 * rate = units of quote per 1 unit of base, computed only when both legs exist on that date.
 */
export function toRows(obs, base, quotes) {
  const byDate = new Map();
  for (const o of obs) {
    if (!byDate.has(o.date)) byDate.set(o.date, new Map([['EUR', 1]]));
    byDate.get(o.date).set(o.currency, o.eurRate);
  }
  const rows = [];
  for (const date of [...byDate.keys()].sort()) {
    const day = byDate.get(date);
    const baseRate = day.get(base);
    if (!baseRate) continue;
    for (const q of quotes) {
      if (q === base) continue;
      const quoteRate = day.get(q);
      if (!quoteRate) continue;
      const rate = quoteRate / baseRate;
      rows.push({
        date,
        base_currency: base,
        quote_currency: q,
        rate: round(rate),
        inverse_rate: round(1 / rate),
        eur_per_base: round(1 / baseRate),
        eur_per_quote: round(1 / quoteRate),
      });
    }
  }
  return rows;
}
