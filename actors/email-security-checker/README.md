# Email Security Checker — SPF, DKIM, DMARC & MX Audit

Audit the **email authentication setup of any domain** — SPF, DKIM, DMARC, MX, MTA-STS and TLS-RPT — and get a **0–100 score, a letter grade and a plain-English fix list** per domain. Check one domain or thousands in bulk. Uses public DNS only: no API key, no mailbox access, no personal data.

## What you get

```json
{
  "query": "github.com",
  "found": true,
  "domain": "github.com",
  "score": 77,
  "grade": "B",
  "issues": [
    "SPF ends in ~all (softfail); -all is stricter.",
    "DMARC policy is quarantine; reject gives full spoofing protection."
  ],
  "accepts_mail": true,
  "null_mx": false,
  "mx_records": [
    "0 github-com.mail.protection.outlook.com"
  ],
  "spf_present": true,
  "spf_record": "v=spf1 ip4:192.30.252.0/22 include:spf.protection.outlook.com include:_netblocks.google.com include:_netblocks2.google.com include:mail.zendesk.com include:_spf.salesforce.com include:servers.mcsv.net include:mktomail.com include:sendgrid.net ip4:62.253.227.114 ip4:166.78.69.169 ip4:166.78.69.170 ip4:166.78.71.131 ~all",
  "spf_all": "~all",
  "spf_dns_lookups": 8,
  "dmarc_present": true,
  "dmarc_policy": "quarantine",
  "dmarc_subdomain_policy": "reject",
  "dmarc_pct": 100,
  "dmarc_record": "v=DMARC1; p=quarantine; sp=reject; pct=100; rua=mailto:***@github.com; ruf=mailto:***@github.com; fo=1",
  "dmarc_report_domains": [
    "github.com"
  ],
  "dkim_selectors_found": [
    "google",
    "selector1",
    "k1",
    "k2",
    "s1",
    "s2"
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

## Related factpipe Actors

- [Sitemap URL Extractor & 404 Checker — XML Sitemap Scraper](https://apify.com/factpipe/sitemap-url-extractor) — every URL from a site's sitemaps
- [Lighthouse & Core Web Vitals Checker API — Bulk PageSpeed](https://apify.com/factpipe/lighthouse-auditor) — bulk Lighthouse and Core Web Vitals audits
- [Career Page Jobs Scraper — Greenhouse, Lever & Ashby API](https://apify.com/factpipe/company-jobs-scraper) — live job postings from Greenhouse, Lever and Ashby

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
