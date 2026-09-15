# ECB Exchange Rates API — Official Euro FX Rates, History

Get the **official European Central Bank euro reference exchange rates** — the benchmark used for invoicing, accounting and VAT conversions across Europe — as clean, flat JSON. Latest rates or full **daily history back to 1999**, for every currency the ECB publishes, with **any base currency** through exact cross rates. Straight from the ECB data API: no key, no scraping, no stale mirrors.

## What you get

```json
{
  "date": "2026-09-14",
  "base_currency": "EUR",
  "quote_currency": "USD",
  "rate": 1.1551,
  "inverse_rate": 0.86572591,
  "eur_per_base": 1,
  "eur_per_quote": 0.86572591,
  "source": "ECB euro foreign exchange reference rates",
  "source_url": "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata&detail=dataonly&lastNObservations=1",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

## Use cases

- **Accounting & invoicing**: convert foreign-currency invoices at the official ECB reference rate for the invoice date.
- **Finance dashboards**: daily scheduled run pushes the latest rates to Google Sheets, Slack or your database.
- **Backtesting & analytics**: pull decades of daily history for any currency pair in one run.
- **AI agents**: tiny input, deterministic output — ideal via API or the Apify MCP server.

## Input

| Field | Type | Notes |
|---|---|---|
| `currencies` | string[] | ISO codes, e.g. `USD`, `GBP`; empty = all |
| `baseCurrency` | string | Default `EUR`; others via cross rates |
| `startDate` / `endDate` | `YYYY-MM-DD` | Leave empty for the latest rates |
| `maxResults` | integer | Cap on charged rows (default 10,000) |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `rate-result` | **$1.00 per 1,000** ($0.001 each) | One exchange rate row (date + currency pair) delivered. Unknown or discontinued currencies and empty runs are never charged. |

Example: one year of daily rates for 4 currencies (~1,020 rows) costs **about $1.02**. No start fee. You only pay for delivered results.

## Related factpipe Actors

- [EU VAT Number Validation API — VIES Bulk Checker](https://apify.com/factpipe/eu-vat-validation) — EU VAT number validation via VIES
- [EU Tenders Scraper — TED Public Procurement Notices API](https://apify.com/factpipe/eu-ted-tenders-monitor) — EU public procurement tenders

## FAQ

**Do I need an API key?**
No. The ECB data API is open. The Actor needs no key or account.

**How often are rates updated?**
The ECB publishes reference rates once per working day at around 16:00 CET. There are no rates on weekends and TARGET holidays, so those dates are simply absent.

**Can I get USD-based or GBP-based rates?**
Yes. Set `baseCurrency` to any published currency. Cross rates are computed exactly from the two ECB euro rates for the same date.

**What about currencies the ECB stopped publishing?**
Discontinued currencies (for example ARS, or BGN after Bulgaria adopted the euro) are reported as not found in latest-rate mode and never charged. Their history is still available with a date range.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Deterministic code against official sources, automatic retries with backoff, structured failure reporting, daily health checks and issue triage.
