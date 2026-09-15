# SEC EDGAR Filings Scraper API — 10-K, 10-Q, 8-K Full-Text

Search the **full text of SEC filings** (10-K, 10-Q, 8-K, S-1, Form 4, 13F and every other form) and get clean, flat JSON records — or run it on a schedule in **incremental mode** to monitor only *new* filings mentioning your keyword. Uses only **official SEC APIs** (efts.sec.gov): no anti-bot fights, no proxies, no missed runs.

## What you get

One record per matching filing document:

```json
{
  "accession_number": "0001144204-11-036302",
  "cik": "1334699",
  "company_name": "Li3 Energy, Inc.",
  "form_type": "8-K",
  "file_type": "EX-99.1",
  "filed_at": "2011-06-17",
  "period_ending": "2011-06-17",
  "items": ["7.01", "9.01"],
  "sic_codes": ["3990"],
  "incorporated_in": "NV",
  "document_url": "https://www.sec.gov/Archives/edgar/data/1334699/000114420411036302/v226209_ex99-1.htm",
  "filing_index_url": "https://www.sec.gov/Archives/edgar/data/1334699/000114420411036302/0001144204-11-036302-index.htm",
  "source_url": "https://www.sec.gov/Archives/edgar/data/1334699/000114420411036302/v226209_ex99-1.htm",
  "fetched_at": "2026-09-11T12:00:00.000Z"
}
```

## Use cases

- **Monitor competitors / customers**: schedule with `sinceLastRun: true` and get only new 8-Ks that mention them.
- **Deal & risk signals**: track phrases like "material weakness", "going concern", "data breach", "short seller".
- **Investor research**: pull every S-1 or 13D/G mentioning a sector keyword.
- **AI agents**: small input schema, deterministic output — ideal for automated pipelines via API or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `query` | string, required | Exact phrase searched in filing full text |
| `forms` | string[] | Optional form filter, e.g. `["8-K","10-K"]` |
| `startDate` / `endDate` | `YYYY-MM-DD` | Optional date window |
| `maxResults` | integer | Cap on charged results (default 100) |
| `sinceLastRun` | boolean | Incremental monitoring mode |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `filing-result` | **$2.00 per 1,000** ($0.002 each) | One filing record delivered to the dataset. **Empty runs are never charged.** |

Example: 500 filings cost **$1.00**. You only pay for delivered results.

## factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | **SEC EDGAR Filings** (this Actor) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Disclosure and risk research:** combine filing searches with [Federal Register](https://apify.com/factpipe/federal-register-monitor) rule changes and [FDA Recalls](https://apify.com/factpipe/fda-recalls-monitor) enforcement history for the same companies.
- **Counterparty checks:** screen issuers and subsidiaries with [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening).

## FAQ

**Do I need an SEC API key or EDGAR account?**
No. The Actor uses SEC's public EDGAR full-text search and data APIs with a compliant User-Agent. No key, no proxy, no login.

**How do I get alerts when a company files a new 8-K or 10-K?**
Schedule the Actor (e.g. daily) with `sinceLastRun: true` and your keyword or company name. Each run returns only filings newer than the last run; connect Slack, email or a webhook to get notified.

**Which SEC forms can I search?**
Any form indexed by EDGAR full-text search (filings since 2001): 10-K, 10-Q, 8-K, S-1, DEF 14A, Form 4, 13F-HR, 13D/13G and more. Leave `forms` empty to search all.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Deterministic code against official SEC endpoints, automatic retries with backoff, SEC fair-access rate limits respected, structured failure reporting. Issues are triaged daily.
