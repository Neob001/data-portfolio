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
| `tender-result` | **$3.00 per 1,000** ($0.003 each) | One tender record delivered to the dataset. **Empty runs are never charged.** |

Example: 1,000 tenders cost **$3.00**. You only pay for delivered results.

## factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | **EU Tenders (TED)** (this Actor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Bid pipeline across both markets:** pair this with [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) for US federal opportunities.
- **Buyer and consortium checks:** validate EU partners with [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) and screen them with [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening).

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
