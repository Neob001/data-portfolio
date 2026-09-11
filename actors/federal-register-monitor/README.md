# Federal Register Search & Monitor

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

| Event | Meaning |
|---|---|
| `document-result` | One document record delivered. **Empty runs are never charged.** |

## Reliability

Official US government API, no key required, retries with backoff, structured failure reporting, daily issue triage.
