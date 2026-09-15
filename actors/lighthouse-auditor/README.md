# Lighthouse & Core Web Vitals Checker API — Bulk PageSpeed

Run **real Google Lighthouse audits in bulk** and get one clean JSON record per page: **Performance, SEO, Accessibility and Best-Practices scores**, lab **Core Web Vitals (LCP, CLS, TBT)** with good / needs-improvement / poor ratings and an overall pass/fail, plus the **top optimization opportunities** ranked by estimated time saved. Mobile, desktop or both.

This Actor runs the open-source Lighthouse engine itself in headless Chrome — **no PageSpeed Insights API key, no daily quota, no 429 errors** — so large URL lists finish reliably.

## What you get

```json
{
  "query": "https://example.com",
  "ok": true,
  "requested_url": "https://example.com/",
  "final_url": "https://example.com/",
  "strategy": "mobile",
  "performance_score": 100,
  "accessibility_score": 100,
  "best_practices_score": 96,
  "seo_score": 80,
  "lcp_ms": 754,
  "cls": 0,
  "tbt_ms": 0,
  "fcp_ms": 754,
  "speed_index_ms": 754,
  "time_to_interactive_ms": 754,
  "server_response_ms": 7,
  "total_byte_weight_kb": 0,
  "lcp_rating": "good",
  "cls_rating": "good",
  "tbt_rating": "good",
  "core_web_vitals_lab": "pass",
  "top_opportunities": [],
  "failing_insights": [],
  "failing_seo_audits": [
    "meta-description",
    "link-text"
  ],
  "failing_accessibility_audits": [],
  "lighthouse_version": "12.8.2",
  "audited_at": "2026-09-15T07:54:17.472Z",
  "source_url": "https://example.com/",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

## Use cases

- **SEO & performance monitoring**: schedule weekly audits of your key pages and alert when scores or Core Web Vitals regress.
- **Agencies**: audit every page in a client's sitemap (pair it with our Sitemap URL Extractor) and prioritize fixes by estimated savings.
- **Competitor benchmarking**: compare performance and SEO scores across a market's top websites.
- **CI & AI agents**: call via API or the Apify MCP server with a list of URLs; deterministic flat output.

## Input

| Field | Type | Notes |
|---|---|---|
| `urls` | string[], required | Pages to audit; `example.com` works too |
| `strategy` | `mobile` \| `desktop` \| `both` | `both` runs two audits per URL |
| `maxUrls` | integer | Cap on URLs per run (default 100) |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `page-audited` | **$10.00 per 1,000** ($0.01 each) | One completed Lighthouse audit (URL x device). Unreachable pages, invalid URLs and failed audits are never charged. |

Example: auditing 500 URLs on mobile and desktop (1,000 audits) costs **$10.00**. No start fee.

## Related factpipe Actors

- [Sitemap URL Extractor & 404 Checker — XML Sitemap Scraper](https://apify.com/factpipe/sitemap-url-extractor) — every URL from a site's sitemaps
- [Email Security Checker — SPF, DKIM, DMARC & MX Audit](https://apify.com/factpipe/email-security-checker) — SPF, DKIM and DMARC domain audits

## FAQ

**Is this the same as Google PageSpeed Insights?**
It runs the same open-source Lighthouse engine that powers PageSpeed Insights' lab data, with the same mobile emulation and simulated throttling defaults. It does not return PageSpeed's field (CrUX) data, which comes from real Chrome users.

**Why does my score differ slightly between runs?**
Lab scores vary a few points with network and server conditions; that is normal Lighthouse behavior. For monitoring, compare trends across scheduled runs.

**What is TBT and why no INP?**
INP needs real user interaction and is only available as field data. Total Blocking Time (TBT) is Lighthouse's lab proxy for responsiveness and is rated against Core Web Vitals-aligned thresholds.

**Am I charged when a page fails to load?**
No. DNS errors, blocked pages, timeouts and invalid URLs are returned with an `error_code` and are never charged.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server.

## Reliability

Deterministic Lighthouse runs in an isolated headless Chrome, automatic browser restart on hangs, per-audit timeouts, structured failure reporting, daily health checks.
