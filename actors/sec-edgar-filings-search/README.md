# SEC EDGAR Filings Search & Monitor

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

| Event | Meaning |
|---|---|
| `filing-result` | One filing record delivered to the dataset. **Empty runs are never charged.** |

## Reliability

Deterministic code against official SEC endpoints, automatic retries with backoff, SEC fair-access rate limits respected, structured failure reporting. Issues are triaged daily.
