# EU Tenders Scraper — TED Public Procurement Notices API

Search and monitor **EU public procurement notices** from TED (Tenders Electronic Daily) by CPV category, buyer country, and keyword — and get clean, flat JSON records. Run it on a schedule in **incremental mode** to receive only tenders published since the last run: a ready-made pipeline of B2G sales leads. Uses the **official TED Search API v3**: no anti-bot fights, no failed runs from blocking.

## What you get

One record per procurement notice:

```json
{
  "publication_number": "602745-2026",
  "title": "Germany – Construction work – BSZ - 323.1 Pfahlgründung und Erdarbeiten",
  "buyer_name": "LRA Lindau (Bodensee)",
  "buyer_country": "DEU",
  "published_at": "2026-09-02",
  "submission_deadline": "2026-10-02T10:00:00+02:00",
  "cpv_codes": ["45000000", "45110000"],
  "places_of_performance": ["DE27A", "DEU"],
  "notice_url": "https://ted.europa.eu/en/notice/-/detail/602745-2026",
  "pdf_url": "https://ted.europa.eu/en/notice/602745-2026/pdf",
  "source_url": "https://ted.europa.eu/en/notice/-/detail/602745-2026",
  "fetched_at": "2026-09-11T12:00:00.000Z"
}
```

## Use cases

- **Win public contracts**: monitor your industry's CPV codes in your countries; every new tender lands in your CRM before competitors read the daily bulletin.
- **Market intelligence**: track which authorities buy what, deadlines, and geography.
- **AI agents**: small input schema, deterministic output — call it from agent pipelines via API or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `cpvCodes` | string[] | CPV categories, e.g. `72000000` IT services |
| `countries` | string[] | Buyer country ISO-3 codes, e.g. `DEU` |
| `fullTextSearch` | string | Optional keyword/phrase |
| `publishedAfter` | `YYYY-MM-DD` | Optional lower bound |
| `maxResults` | integer | Cap on charged results (default 200) |
| `sinceLastRun` | boolean | Incremental monitoring mode |

At least one of `cpvCodes`, `countries`, or `fullTextSearch` is required.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `tender-result` | **$10.00 per 1,000** ($0.01 each) | One tender record delivered to the dataset. **Empty runs are never charged.** |

Example: 1,000 tenders cost **$10.00**. You only pay for delivered results.

## Related factpipe Actors

- [SAM.gov Contract Opportunities Scraper — Federal Bids API](https://apify.com/factpipe/sam-gov-contracts) — US federal contract opportunities
- [EU VAT Number Validation API — VIES Bulk Checker](https://apify.com/factpipe/eu-vat-validation) — EU VAT number validation via VIES
- [ECB Exchange Rates API — Official Euro FX Rates, History](https://apify.com/factpipe/ecb-exchange-rates) — official ECB euro exchange rates

## FAQ

**Do I need a TED API key?**
No. The official TED Search API v3 is open; the Actor needs no key or account.

**How do I find tenders for my industry?**
Put your CPV codes in `cpvCodes` (e.g. `72000000` IT services, `45000000` construction), optionally limit `countries` (ISO alpha-3 like `DEU`, `FRA`) and add a keyword. Schedule daily with `sinceLastRun: true` to receive only new notices.

**Does it include submission deadlines and documents?**
Yes: every record has the buyer, buyer country, submission deadline, CPV codes, places of performance, the notice URL and the PDF link.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official API, retries with backoff, rate-limited politely, structured failure reporting, daily issue triage.
