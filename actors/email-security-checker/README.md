# Email Security Checker — SPF, DKIM, DMARC & MX Audit

Audit the **email authentication setup of any domain** — SPF, DKIM, DMARC, MX, MTA-STS and TLS-RPT — and get a **0–100 score, a letter grade and a plain-English fix list** per domain. Check one domain or thousands in bulk. Uses public DNS only: no API key, no mailbox access, no personal data.

## What you get

```json
{
  "query": "github.com",
  "found": true,
  "domain": "github.com",
  "score": 72,
  "grade": "C",
  "issues": [
    "SPF ends in ~all (softfail); -all is stricter.",
    "DMARC policy is quarantine; reject gives full spoofing protection."
  ],
  "mx_records": [
    "1 aspmx.l.google.com"
  ],
  "spf_present": true,
  "spf_all": "~all",
  "spf_dns_lookups": 9,
  "dmarc_present": true,
  "dmarc_policy": "quarantine",
  "dmarc_subdomain_policy": "reject",
  "dmarc_pct": 100,
  "dmarc_report_domains": [
    "github.com"
  ],
  "dkim_selectors_found": [
    "google",
    "selector1"
  ],
  "mta_sts": false,
  "tls_rpt": false,
  "source_url": "dns:github.com",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

## Use cases

- **Deliverability teams & ESPs**: find clients whose SPF exceeds 10 lookups or whose DMARC is still `p=none`.
- **Security & vendor risk**: flag suppliers whose domains can be spoofed (missing DMARC, SPF `+all`).
- **Agencies & MSPs**: generate a prospect list of domains with fixable email security gaps.
- **AI agents & automations**: deterministic JSON per domain via API, Make, Zapier or MCP.

## Input

| Field | Type | Notes |
|---|---|---|
| `domains` | string[], required | Domains, URLs or email addresses |
| `extraDkimSelectors` | string[] | Custom DKIM selectors to test |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `domain-audited` | **$3.00 per 1,000** ($0.003 each) | One domain fully audited (SPF, DMARC, DKIM, MX, MTA-STS, TLS-RPT). Invalid, nonexistent or unreachable domains are never charged. |

Example: auditing 1,000 domains costs **$3.00**. No start fee. You only pay for delivered results.

## FAQ

**Why is DKIM sometimes reported as not found?**
DKIM keys live under selector names that cannot be listed from DNS. The Actor tests 18 common selectors (Google Workspace, Microsoft 365, and major ESPs) plus any you add in `extraDkimSelectors`.

**What does the SPF lookup count mean?**
SPF allows at most 10 DNS-querying mechanisms (include, a, mx, ptr, exists, redirect). More than 10 makes SPF fail with a permanent error at receivers, so the Actor flags it.

**Do you store or expose DMARC report email addresses?**
No. Only the receiving domains of DMARC reports are returned; mailbox names are masked.

**Am I charged for domains that don't exist?**
No. Invalid inputs, nonexistent domains and DNS failures are returned as not found and never charged.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Deterministic code against official sources, automatic retries with backoff, structured failure reporting, daily health checks and issue triage.
