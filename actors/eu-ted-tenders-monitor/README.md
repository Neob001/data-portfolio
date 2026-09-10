# EU Tenders (TED) Search & Monitor

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

| Event | Meaning |
|---|---|
| `tender-result` | One tender record delivered to the dataset. **Empty runs are never charged.** |

## Reliability

Official API, retries with backoff, rate-limited politely, structured failure reporting, daily issue triage.
