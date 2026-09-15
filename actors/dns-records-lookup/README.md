# DNS Records Lookup API — Bulk A, MX, TXT, NS, CNAME, SOA, CAA

**Bulk DNS lookups for any list of domains.** Resolve A, AAAA, MX, TXT, NS, CNAME, SOA and CAA records at scale, plus derived hints you'd otherwise have to build yourself: mail provider (Google Workspace, Microsoft 365, Zoho, Proton, Fastmail, Mimecast, Proofpoint, Amazon SES), authoritative DNS provider (Cloudflare, AWS Route 53, Google Cloud DNS, Azure DNS, GoDaddy, Namecheap, DigitalOcean, Vercel, NS1), SPF/DMARC presence and TXT-based verification tokens (Google, Microsoft, Facebook, Atlassian, Apple, Stripe, DocuSign, Zoom). Public DNS only: no API key, no login, no personal data.

## Quick start

1. Click **Start** with the two prefilled domains (`github.com`, `example.com`). It finishes in seconds.
2. You get one record per domain with A, AAAA, MX, TXT, NS, SOA and CAA records, plus mail provider, DNS provider and SPF/DMARC flags.
3. That first run costs $0.003, well within Apify's free monthly credit. Then paste your own domain list.

## What you get

```json
{
  "query": "github.com",
  "domain": "github.com",
  "found": true,
  "reason": null,
  "a": ["20.205.243.166"],
  "aaaa": [],
  "mx": ["0 github-com.mail.protection.outlook.com"],
  "txt": [
    "MS=6BF03E6AF5CB689E315FB6199603BABF2C88D805",
    "google-site-verification=82Le34Flgtd15ojYhHlGF_6g72muSjamlMVThBOJpks",
    "v=spf1 ip4:192.30.252.0/22 include:spf.protection.outlook.com ... ~all"
  ],
  "ns": [
    "dns1.p08.nsone.net",
    "ns-1283.awsdns-32.org",
    "ns-1707.awsdns-21.co.uk"
  ],
  "cname": null,
  "soa_primary_ns": "ns-1707.awsdns-21.co.uk",
  "soa_serial": 1,
  "soa_minimum_ttl": 86400,
  "caa": ["0 issue \"letsencrypt.org\"", "0 issuewild \"digicert.com\""],
  "mail_provider": "Microsoft 365",
  "dns_provider": "AWS Route 53",
  "has_spf": true,
  "has_dmarc": true,
  "verification_tokens": ["microsoft", "apple", "atlassian", "docusign", "facebook", "google", "stripe"],
  "record_count": 42,
  "source_url": "dns:github.com",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

## Use cases

- **Domain inventory & asset audits**: bulk-resolve every domain you own or manage into one flat table (IPs, mail routing, name servers) for security and compliance reviews.
- **Lead enrichment & sales intelligence**: detect a prospect's email provider (`mail_provider`) and marketing/SaaS stack signals (`verification_tokens`) from public DNS alone — no crawling, no login.
- **DNS migration checks**: confirm A/AAAA, MX and NS records point where they should before and after a cutover, across hundreds of domains at once.
- **Security & vendor risk**: spot domains with no SPF or DMARC (`has_spf`, `has_dmarc`), unexpected CAA issuers, or DNS hosted with an unapproved provider.
- **SaaS & tool discovery**: `verification_tokens` reveals which domains have verified with Google Workspace, Microsoft 365, Atlassian, Stripe, DocuSign, Zoom and more via TXT records.

## Input

| Field | Type | Notes |
|---|---|---|
| `domains` | string[], required | Domain names, website URLs or email addresses (the host is extracted). Subdomains are kept intact, e.g. `mail.example.com`. Duplicates are looked up once. |
| `recordTypes` | string[] | Which record types to resolve: any of `A`, `AAAA`, `MX`, `TXT`, `NS`, `CNAME`, `SOA`, `CAA`. Defaults to all eight. Types not selected are returned as `null`. |
| `stripWww` | boolean | If enabled, a leading `www.` is removed before lookup. Off by default — other subdomains are always kept as-is. |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `domain-resolved` | **$1.50 per 1,000** ($0.0015 each) | One domain that exists and returned at least one requested DNS record. |

Nonexistent, invalid and unreachable domains are never charged. A domain that exists but has zero records of the requested types is delivered but not charged either.

Example: resolving 1,000 domains costs **$1.50**. No start fee. You only pay for delivered results.

## Related factpipe Actors

- [Email Security Checker](https://apify.com/factpipe/email-security-checker) — full SPF/DKIM/DMARC audit with a 0–100 score and fix list (this Actor only reports SPF/DMARC presence as a quick signal; use Email Security Checker for the deep audit).
- [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) — Lighthouse scores and Core Web Vitals for many pages, mobile or desktop.
- [Sitemap URL Extractor & 404 Checker](https://apify.com/factpipe/sitemap-url-extractor) — extract every URL from XML sitemaps and flag 404s and broken entries.

## FAQ

**What does `null_mx: true` mean?**
The domain publishes an RFC 7505 "null MX" record, explicitly declaring that it accepts no mail. `mx` is then an empty list.

**Why is `cname` usually `null`?**
Most domains (especially apex/root domains) have no CNAME — A/AAAA records are set directly, or via other record types. `cname` is populated for hostnames that are genuinely aliased, e.g. `www.github.com` → `github.com`. When a name has a CNAME, its A/AAAA records resolve through that alias automatically.

**Am I charged for domains that don't exist?**
No. Invalid inputs, nonexistent domains (NXDOMAIN) and DNS failures are returned as not found and never charged. A domain that resolves but has none of the requested record types is also not charged.

**How is `mail_provider` / `dns_provider` detected?**
From well-known hostname patterns in the MX and NS records (e.g. `*.protection.outlook.com` → Microsoft 365, `*.awsdns-*.{com,net,org,co.uk}` → AWS Route 53). Providers outside the detected list, or domains with no matching pattern, return `null`.

**Do you store or expose mailbox addresses found in DNS?**
No. Any mailbox local-part found in a TXT record (e.g. a DMARC `rua=mailto:` reporting address) is masked as `***@domain`.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Deterministic code against public DNS resolvers (1.1.1.1, 8.8.8.8, 9.9.9.9) with automatic retries and backoff on transient failures, structured failure reporting, daily health checks and issue triage.
