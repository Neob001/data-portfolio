# Federal Register Scraper — US Rules & Regulations Monitor

Search and monitor **US Federal Register documents** — final rules, proposed rules, notices, and presidential documents — by keyword, agency, and type. Get clean, flat JSON records from the **official federalregister.gov API**, or schedule with incremental mode to receive only documents published since the last run: an automated regulatory-monitoring pipeline for compliance, policy, and government-affairs teams.

## What you get

```json
{
  "document_number": "2026-17712",
  "title": "NIST Artificial Intelligence Consortium",
  "document_type": "Notice",
  "abstract": "The National Institute of Standards and Technology (NIST)...",
  "agencies": ["Commerce Department", "National Institute of Standards and Technology"],
  "published_at": "2026-09-08",
  "html_url": "https://www.federalregister.gov/documents/2026/09/08/2026-17712/nist-artificial-intelligence-consortium",
  "pdf_url": "https://www.govinfo.gov/content/pkg/FR-2026-09-08/pdf/2026-17712.pdf",
  "source_url": "https://www.federalregister.gov/documents/2026/09/08/2026-17712/nist-artificial-intelligence-consortium",
  "fetched_at": "2026-09-11T12:00:00.000Z"
}
```

## Use cases

- **Regulatory monitoring**: track every new rule mentioning your industry keywords, per agency.
- **Policy research & alerts**: schedule daily with `sinceLastRun` and pipe new documents to Slack/CRM via integrations.
- **AI agents**: small input schema, deterministic output — ideal via API or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `searchTerm` | string | Keyword/phrase |
| `documentTypes` | string[] | `RULE`, `PRORULE`, `NOTICE`, `PRESDOCU` |
| `agencySlugs` | string[] | e.g. `securities-and-exchange-commission` |
| `publishedAfter` | `YYYY-MM-DD` | Lower bound |
| `maxResults` | integer | Cap on charged results (default 100) |
| `sinceLastRun` | boolean | Incremental monitoring mode |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `document-result` | **$2.50 per 1,000** ($0.0025 each) | One document record delivered. **Empty runs are never charged.** |

Example: 1,000 documents cost **$2.50**. You only pay for delivered results.

## factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | **Federal Register Monitor** (this Actor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **Regulatory watch desk:** schedule this with [FDA Recalls](https://apify.com/factpipe/fda-recalls-monitor) for enforcement actions and [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) for how companies disclose the impact.

## FAQ

**Do I need an API key?**
No. The official federalregister.gov API is open and keyless.

**How do I monitor new regulations for my industry?**
Set a keyword (e.g. `artificial intelligence`, `PFAS`), optionally `documentTypes` (`RULE`, `PRORULE`, `NOTICE`, `PRESDOCU`) and `agencySlugs`, then schedule daily with `sinceLastRun: true`. Only new documents are returned and charged.

**Does it include comment-period proposed rules and executive orders?**
Yes. Proposed rules (`PRORULE`) and presidential documents such as executive orders (`PRESDOCU`) are supported, with abstract, agencies, HTML and PDF links.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Official US government API, no key required, retries with backoff, structured failure reporting, daily issue triage.
