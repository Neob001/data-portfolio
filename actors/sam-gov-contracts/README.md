# SAM.gov Contract Opportunities Scraper — Federal Bids API

Search and monitor **US federal government contract opportunities** — solicitations, RFPs, combined synopses, sources-sought notices, presolicitations and award notices — straight from the **official SAM.gov Contract Opportunities data extract** published daily by GSA. Filter by keyword, NAICS code, set-aside, notice type, agency and place of performance, then schedule it with incremental mode to get **only new bids every morning**. No SAM.gov account, no API key, no rate limits.

## What you get

One flat record per opportunity:

```json
{
  "notice_id": "ef50a91c02f24bfab3db66e9e91d95e7",
  "title": "Coburn Gore LPOE Art in Architecture Project",
  "solicitation_number": "0332CG-AIA",
  "department": "GENERAL SERVICES ADMINISTRATION",
  "sub_tier": "PUBLIC BUILDINGS SERVICE",
  "office": "PBS PROJECT DELIVERY CAPITAL CONSTRUCTION - BRANCH NORTHEAST",
  "posted_date": "2026-09-14",
  "notice_type": "Combined Synopsis/Solicitation",
  "base_type": "Combined Synopsis/Solicitation",
  "response_deadline": "2026-10-22T12:00:00-04:00",
  "archive_date": "2026-11-06",
  "set_aside_code": "SBA",
  "set_aside": "Small Business Set Aside - Total",
  "naics_code": "711510",
  "psc_code": "T001",
  "place_of_performance_city": "Coburn Gore",
  "place_of_performance_state": "ME",
  "place_of_performance_zip": "04936",
  "place_of_performance_country": "USA",
  "active": true,
  "award_number": null,
  "award_date": null,
  "award_amount": null,
  "awardee": null,
  "organization_type": "OFFICE",
  "notice_url": "https://sam.gov/workspace/contract/opp/ef50a91c02f24bfab3db66e9e91d95e7/view",
  "additional_info_url": null,
  "description": "Document Added & Updated: 0332CG-AIA- Coburn Gore AIA Questions & Answers V2 Dated 09 September 2026 The U.S. General Services Administration (GSA) Art in Architecture Program commissions American artists (citizens and Lawful Permanent Residents or Permanent Workers of the United States) to create p",
  "source_url": "https://sam.gov/workspace/contract/opp/ef50a91c02f24bfab3db66e9e91d95e7/view",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

Personal contact details of individual contracting officers are intentionally not included: the contact name, email and phone columns are dropped, and email addresses and phone numbers embedded in titles or descriptions are masked. Every record links to the full notice on SAM.gov.

## Use cases

- **GovCon bid pipelines**: daily alerts for your NAICS codes and set-asides, pushed to Slack, email, HubSpot or Google Sheets.
- **Small businesses & 8(a)/WOSB/SDVOSB firms**: find set-aside opportunities before competitors.
- **Market intelligence**: track which agencies buy what, award notices and award amounts.
- **AI agents**: small input, deterministic flat JSON via API or the Apify MCP server.

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Any keyword in title or description |
| `naicsCodes` | string[] | NAICS codes or prefixes, e.g. `5415` |
| `setAsideCodes` | string[] | e.g. `SBA`, `8A`, `SDVOSBC`, `WOSB` |
| `noticeTypes` | string[] | e.g. `Solicitation`, `Sources Sought`, `Award Notice` |
| `agencies` | string[] | Department / sub-tier / office name match |
| `states` | string[] | Place-of-performance state codes |
| `postedAfter` | `YYYY-MM-DD` | Default: last 3 days |
| `sinceLastRun` | boolean | Only notices not delivered before |
| `maxResults` | integer | Cap on charged results (default 1,000) |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `opportunity-result` | **.00 per 1,000** (/bin/zsh.002 each) | One matching opportunity delivered. Scanned non-matching notices and empty runs are never charged. |

Example: 300 new opportunities a month for your NAICS codes cost **/bin/zsh.60**. No start fee.

## Related factpipe Actors

- [EU Tenders Scraper — TED Public Procurement Notices API](https://apify.com/factpipe/eu-ted-tenders-monitor) — EU public procurement tenders
- [Federal Register Scraper — US Rules & Regulations Monitor](https://apify.com/factpipe/federal-register-monitor) — US rules and regulations

## FAQ

**Do I need a SAM.gov account or API key?**
No. The Actor reads the public Contract Opportunities data extract that GSA publishes for everyone, updated daily.

**How fresh is the data?**
SAM.gov regenerates the extract once a day (early morning US Eastern time), so new notices appear the next day. Schedule the Actor daily with `sinceLastRun: true` for a morning digest.

**Can I search older opportunities?**
Yes. Set `postedAfter` to an earlier date. The dataset is ordered newest first, so recent searches are fastest.

**Where are the contracting officer contacts?**
Individual names, emails and phone numbers are excluded by design. Open `notice_url` for the full notice, attachments and points of contact on SAM.gov.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server.

## Reliability

Official government data, streaming download with early stop, retries with backoff, structured failure reporting, daily health checks.
