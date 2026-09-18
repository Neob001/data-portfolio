# News Monitor — Company & Keyword News, Adverse Media (GDELT)

Monitor **company or keyword news** across global media, or screen for **adverse media** (fraud, bribery, corruption, sanctions, lawsuits, indictments, recalls and more) using the **GDELT Project's** open, keyless DOC 2.0 API. Get clean, flat JSON per article with source, country, language and publish time — or schedule with incremental mode to receive only new coverage since the last run: brand monitoring, competitor tracking, PR measurement and KYC/AML-style adverse-media screening from a single input.

## Quick start

1. Click **Start** with the prefilled queries `"OpenAI"` and `"supply chain" recall`. It finishes in under a minute.
2. You get up to 20 articles per query (40 total) with title, domain, country, language and links.
3. That first run costs at most $0.08, well within Apify's free monthly credit. Then swap in your own queries or schedule it.

## What you get

```json
{
  "query": "\"OpenAI\"",
  "mode": "news",
  "title": "OpenAI announces new safety framework for frontier models",
  "url": "https://www.reuters.com/technology/openai-announces-new-safety-framework-2026-09-15/",
  "domain": "reuters.com",
  "source_country": "United States",
  "language": "English",
  "published_at": "2026-09-15T14:00:00.000Z",
  "image_url": "https://www.reuters.com/pf/resources/images/openai-safety.jpg",
  "matched_risk_terms": [],
  "article_id": "1b2c3d4e5f60718293a4b5c6d7e8f9a0b1c2d3e4",
  "attribution": "GDELT Project, https://www.gdeltproject.org",
  "source_url": "https://api.gdeltproject.org/api/v2/doc/doc?query=...",
  "fetched_at": "2026-09-15T14:05:00.000Z"
}
```

## Use cases

- **Brand & company monitoring**: track every new article mentioning your company or product, across languages and countries.
- **Competitor news**: watch competitor names or product launches and pipe new coverage to Slack/CRM via Apify integrations.
- **Adverse-media / KYC screening**: run `mode: "adverse_media"` on a counterparty name to surface fraud, sanctions, litigation and recall coverage as part of onboarding or periodic review.
- **PR & communications**: measure pickup of an announcement or campaign across outlets, countries and languages.
- **Market intelligence**: monitor an industry keyword or event (e.g. "supply chain" recall) for emerging stories.

## Input

| Field | Type | Notes |
|---|---|---|
| `queries` | string[] | Required. GDELT search queries — quote exact phrases (`"OpenAI"`), combine with GDELT boolean syntax. Each is run and charged separately. |
| `mode` | string | `news` (default) or `adverse_media`. Adverse mode ANDs each query with a curated risk-term group (see below). |
| `languages` | string[] | Optional GDELT `sourcelang` codes (e.g. `eng`, `fre`). |
| `countries` | string[] | Optional GDELT `sourcecountry` FIPS codes (e.g. `US`, `UK`). |
| `domains` | string[] | Optional publisher domains (e.g. `reuters.com`). |
| `lookbackHours` | integer | How far back to search from now. Default 24, max 2160 (~90 days). |
| `sinceLastRun` | boolean | Incremental mode for schedules: only articles newer than the last successful run. |
| `maxResultsPerQuery` | integer | Cap on charged results per query. Default 100, prefill 20. |

**Adverse-media risk terms:** `fraud`, `bribery`, `corruption`, `"money laundering"`, `sanctions`, `lawsuit`, `indictment`, `investigation`, `scandal`, `bankruptcy`, `"data breach"`, `recall` — ANDed with your query, and (best-effort, title-only) reported per article in `matched_risk_terms`.

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `article-result` | **$2 per 1,000** ($0.002 each) | One article record delivered. **Empty runs and failed lookups are never charged.** |

Example: 1,000 articles cost **$2**. You only pay for delivered results.

## Source & attribution

Data comes from the [GDELT Project](https://www.gdeltproject.org/)'s open DOC 2.0 API (`api.gdeltproject.org`), which monitors news media in over 100 languages worldwide. Per GDELT's terms of use, its datasets are free for unlimited academic, commercial or governmental use provided redistribution credits the GDELT Project and links to gdeltproject.org — every record in this Actor's output carries an `attribution` field for exactly that reason, and this README does the same. GDELT also asks integrators to keep to one request every 5 seconds; this Actor throttles itself accordingly and treats GDELT's transient rate-limit replies as retryable rather than failures.

## FAQ

**Do I need an API key?**
No. The GDELT DOC 2.0 API is open and keyless.

**Do I get the full article text?**
No. GDELT DOC is a metadata index: you get the link, title, publish time, source domain/country/language and a social-share image where available — not the full article body. Follow `url` for the full text.

**How far back does coverage go?**
GDELT DOC covers roughly the last 3 months (90 days) of monitored global media. `lookbackHours` caps at 2160 (90 days) for that reason.

**What languages are covered?**
GDELT monitors and machine-translates news in around 65 languages; use `languages` (GDELT `sourcelang` codes) to restrict to specific ones.

**How do I monitor news on a schedule?**
Set `sinceLastRun: true` and run on an Apify schedule. Only articles newer than the last successful run are delivered and charged.

**What does `mode: "adverse_media"` actually search?**
It ANDs your query with a curated group of risk terms (fraud, bribery, corruption, money laundering, sanctions, lawsuit, indictment, investigation, scandal, bankruptcy, data breach, recall), so `"Acme Corp"` becomes `("Acme Corp") AND (fraud OR bribery OR ... OR recall)`. Useful as a first-pass adverse-media screen; always review the linked articles.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## factpipe Compliance Suite

Official-source compliance data, all pay-per-result and runnable from one Apify account. Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Counterparty & KYB checks | [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening) | Screen names against the US Treasury SDN list with fuzzy matching | $3/1k |
| Counterparty & KYB checks | [EU VAT Validation](https://apify.com/factpipe/eu-vat-validation) | Validate EU VAT numbers in bulk against VIES, with registered name and address | $2/1k |
| Counterparty & KYB checks | [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) | Company status, SIC codes and registered office from Companies House | $2.50/1k |
| Adverse media | **News Monitor** (this Actor) | Company/keyword news and adverse-media screening from GDELT's open news index | $2/1k |
| Public-sector sales intelligence | [SAM.gov Contracts](https://apify.com/factpipe/sam-gov-contracts) | Federal contract opportunities, set-asides and deadlines from SAM.gov | $2/1k |
| Public-sector sales intelligence | [EU Tenders (TED)](https://apify.com/factpipe/eu-ted-tenders-monitor) | EU public procurement notices from TED, filterable by CPV and country | $3/1k |
| Regulatory & disclosure monitoring | [Federal Register Monitor](https://apify.com/factpipe/federal-register-monitor) | New US rules, proposed rules and notices by agency or keyword | $2.50/1k |
| Regulatory & disclosure monitoring | [FDA Recalls Monitor](https://apify.com/factpipe/fda-recalls-monitor) | FDA food, drug and device recall enforcement reports | $3/1k |
| Regulatory & disclosure monitoring | [SEC EDGAR Filings](https://apify.com/factpipe/sec-edgar-filings-search) | Full-text search across 10-K, 10-Q, 8-K and other SEC filings | $2/1k |

**Use it together:**

- **KYB file:** screen the counterparty name here with `mode: "adverse_media"`, confirm the company with [UK Companies House Lookup](https://apify.com/factpipe/uk-company-lookup) or a national registry, and run the registered name through [OFAC Sanctions Screening](https://apify.com/factpipe/ofac-sanctions-screening).

## Reliability

Open GDELT Project data, no key required, throttled to GDELT's own rate-limit guidance with retries and backoff, structured failure reporting, daily issue triage.
