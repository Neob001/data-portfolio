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
| `document-result` | **$5.00 per 1,000** ($0.005 each) | One document record delivered. **Empty runs are never charged.** |

Example: 1,000 documents cost **$5.00**. You only pay for delivered results.

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
