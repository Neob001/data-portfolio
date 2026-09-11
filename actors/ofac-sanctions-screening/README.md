# OFAC Sanctions Screening (SDN List)

Screen customer, vendor, and counterparty names against the **official US Treasury OFAC SDN sanctions list** — including the official alternate-names (AKA) list — and get a deterministic, auditable match result per name. The list is downloaded **fresh from treasury.gov on every run**, so results always reflect the current list. Built for KYC/AML onboarding checks, vendor due diligence, and payment screening.

## What you get

One record per screened name — including clean "no match" results for your audit trail:

```json
{
  "query": "Banco Nacional de Cuba",
  "matched": true,
  "match_count": 1,
  "top_match_name": "BANCO NACIONAL DE CUBA",
  "top_match_score": 1,
  "matches": [
    {
      "uid": "306",
      "sdn_name": "BANCO NACIONAL DE CUBA",
      "matched_name": "BANCO NACIONAL DE CUBA",
      "score": 1,
      "type": "unknown",
      "programs": "CUBA"
    }
  ],
  "list_publish_info": "OFAC SDN list, 17842 entries, downloaded 2026-09-11T12:00:00.000Z",
  "source_url": "https://www.treasury.gov/ofac/downloads/sdn.csv",
  "fetched_at": "2026-09-11T12:00:00.000Z"
}
```

## How matching works

Deterministic and auditable — no AI guessing: names are normalized (case, accents, punctuation, corporate suffixes), then matched exactly and by token overlap against SDN names **and their official aliases**. You control the threshold with `minScore` (85 is a sensible compliance default; 100 = exact matches only). Scores and the matched alias are reported so reviewers can verify every hit.

> **Note**: screening is a decision-support tool. Potential matches should be reviewed by a human before action, per OFAC guidance.

## Input

| Field | Type | Notes |
|---|---|---|
| `names` | string[], required | People or organizations to screen |
| `minScore` | integer 50–100 | Match threshold in percent (default 85) |
| `includeAliases` | boolean | Screen against official AKAs (default true) |

## Pricing (pay per event)

| Event | Meaning |
|---|---|
| `name-screened` | One name fully screened against the current list — both matches and documented "clear" results. Invalid/empty names are never charged. |

## Reliability

Official US Treasury source files, fetched fresh each run; deterministic matching; structured failure reporting; daily issue triage.
