# Broken Link Checker — Find 404s & Dead Links on Any Website

Crawl **any website and find every broken link**: 404s, dead images, dead scripts and stylesheets, DNS failures, timeouts and redirect loops. Give it a start URL, it walks the site breadth-first (same hostname, robots.txt aware) and returns one flat row per broken link — where it was found, how many pages link to it, and the anchor text — so you know exactly what to fix and where.

## Quick start

1. Click **Start** with the prefilled site (`https://crawlee.dev`, 20 pages, 3-minute limit). It finishes in about 2–3 minutes.
2. You get one row per broken or unverifiable link (where it appears, how many pages link to it, anchor text) plus a `site_summary` row with totals.
3. That first run costs $0.03, well within Apify's free monthly credit. Then enter your own site and raise the page limit.

## What you get

The dataset holds two kinds of row, told apart by `record_type`:

- **`broken_link`** (plus `unverified_link` for links a site refused to verify, and `ok_link` if you enable `includeOkLinks`) — one row per unique link found:

```json
{
  "record_type": "broken_link",
  "site": "https://crawlee.dev",
  "link_url": "https://crawlee.dev/docs/old-guide",
  "final_url": "https://crawlee.dev/docs/old-guide",
  "status_code": 404,
  "error": null,
  "is_broken": true,
  "reason": "http_404",
  "link_type": "internal",
  "element": "a",
  "found_on_url": "https://crawlee.dev/",
  "found_on_count": 3,
  "found_on_sample": [
    "https://crawlee.dev/",
    "https://crawlee.dev/blog",
    "https://crawlee.dev/docs/quick-start"
  ],
  "anchor_text": "Read the old guide",
  "redirect_count": 0,
  "source_url": "https://crawlee.dev/docs/old-guide",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

- **`site_summary`** — exactly one row per start URL, pushed at the end of that site's crawl, so every run produces at least one row even on a perfectly healthy site with `includeOkLinks` off:

```json
{
  "record_type": "site_summary",
  "site": "https://crawlee.dev/",
  "start_url": "https://crawlee.dev/",
  "pages_scanned": 20,
  "links_checked": 1206,
  "broken_links": 3,
  "rate_limited_unverified": 0,
  "blocked_unverified": 0,
  "external_links_checked": 722,
  "top_broken": [
    "https://crawlee.dev/docs/old-guide"
  ],
  "status": "completed",
  "source_url": "https://crawlee.dev/",
  "fetched_at": "2026-09-15T12:00:00.000Z"
}
```

`status` is `"completed"`, `"page_limit_reached"` (hit `maxPagesPerSite`), `"charge_limit_reached"` (hit your max-cost-per-run setting), `"time_limit_reached"` (hit `maxRunMinutes`), or `"start_url_unreachable"` (the start URL itself never loaded — that row is free).

## Use cases

- **SEO audits**: find and fix every dead internal/external link before it costs you rankings.
- **Site migrations**: verify nothing broke after a redesign, CMS switch or URL restructure.
- **Agencies' client reports**: run one crawl per client site, hand over a clean broken-link list.
- **Content QA**: catch dead links in blog posts and docs before or right after publishing.
- **Scheduled monitoring**: schedule weekly runs to catch link rot (expired external sites, moved pages) as it happens.

## Input

| Field | Type | Notes |
|---|---|---|
| `startUrls` | string[], required | Website URLs to crawl (prefilled with `https://crawlee.dev`) |
| `maxPagesPerSite` | integer | Cap on pages crawled and charged per site (default 50, max 5000) |
| `checkExternalLinks` | boolean | Also check links to other hostnames (default true) |
| `checkImagesAndAssets` | boolean | Also check `img`, `script` and stylesheet `link` tags (default true) |
| `includeOkLinks` | boolean | Return working links too, not just broken ones (default false) |
| `respectRobotsTxt` | boolean | Honor `Disallow` for `user-agent: *` when deciding what to crawl (default true) |
| `maxRunMinutes` | integer | Hard wall-clock budget for the whole run (default 3, max 1440). Raise it for large sites; a run that hits it still succeeds and reports `time_limit_reached` |

Crawling is breadth-first over pages on the same hostname as each start URL (`www.` is ignored), up to `maxPagesPerSite` pages. Every link on every scanned page is checked: HEAD first, falling back to GET on 403/405/501 or a network oddity; redirects are followed (up to 5 hops) and recorded as `final_url`/`redirect_count`; timeouts and 5xx get one retry; a 429 is reported as `rate_limited_unverified` rather than marked broken, so a rate limiter never gets flagged as a dead link. External and asset checks run in their own pool (24 at once across the whole run, at most 4 per host) alongside the page crawl, so a page full of external links doesn't stall the crawl behind it. If `maxRunMinutes` is reached, the Actor stops crawling new pages, gives whatever's already in flight up to 15 more seconds, writes each site's `site_summary` row (`status: "time_limit_reached"` where it was cut short) and finishes successfully — a page whose links weren't all checked in time is never charged.

The dataset has two views: **Broken links** (the link-level rows) and **Site summary** (one row per site).

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `page-scanned` | **$1.50 per 1,000 pages** ($0.0015 each) | One HTML page successfully crawled and every link on it checked. |

Every link found on a scanned page — internal, external, images, scripts, stylesheets — is checked at no extra charge. A start URL that can't be reached at all (DNS failure, connection refused, timeout) is reported as broken and is **never charged**.

Example: auditing a 200-page site costs **$0.30**.

## How it compares

Most link checkers either charge per link checked (so one page with 40 links costs 40x more than it should) or require a full headless browser for every page. This Actor charges per page scanned, not per link — a page with 200 links costs the same as a page with 2 — and runs on plain HTTP requests (no browser), which keeps it fast and cheap for large sites. The trade-off: it doesn't see links injected by client-side JavaScript (see FAQ).

## factpipe Website Audit Toolkit

Bulk technical checks for agencies, SEO teams and deliverability owners, all pay-per-result. Feed a list of sites in, get one flat row per page, link or domain out.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Website audit | [Sitemap URL Extractor & 404 Checker](https://apify.com/factpipe/sitemap-url-extractor) | Extract every URL from XML sitemaps and flag 404s and broken entries | $0.30/1k |
| Website audit | [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) | Lighthouse scores and Core Web Vitals for many pages, mobile or desktop | $10/1k |
| Website audit | [Email Security Checker](https://apify.com/factpipe/email-security-checker) | SPF, DKIM, DMARC and MX audit for any list of domains | $3/1k |
| Website audit | **Broken Link Checker** (this Actor) | Crawl a site and find every 404, dead asset and broken link | $1.50/1k |

**Use it together:**

- **Full-site health report:** pull the URL inventory from [Sitemap URL Extractor](https://apify.com/factpipe/sitemap-url-extractor), crawl it here for a deep broken-link sweep (following actual on-page navigation, not just the sitemap), check Core Web Vitals with [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor), and audit the domain's mail setup with [Email Security Checker](https://apify.com/factpipe/email-security-checker).

## FAQ

**Does it respect robots.txt?**
Yes, by default. It won't crawl (follow links into) pages disallowed for `user-agent: *`. It still checks whether a disallowed URL itself is broken when another page links to it — robots.txt controls crawling, not link-checking.

**Will it find links added by JavaScript?**
No. This Actor reads the raw HTML response for each page, the same way a fast, non-rendering crawler or a search engine's basic fetcher does. Links, images and scripts injected client-side after the page loads (React/Vue apps that render navigation in the browser) are not seen. If your site's navigation depends on JavaScript, its link inventory will be incomplete.

**What happens if a site rate-limits the crawl?**
A 429 response is retried once after the `Retry-After` delay (capped at 10 seconds). If it's still 429, the link is reported with `status_code: 429` and `reason: "rate_limited_unverified"` — it is never marked broken, since a rate limit says nothing about whether the link actually works.

**Why are some external links marked `unverified_link` instead of broken?**
Many large sites (Stack Overflow, npm, LinkedIn and others) answer automated checks with 401, 403 or LinkedIn's 999 even though the page works in a browser. For external links those responses are reported as `record_type: "unverified_link"` with `reason: "blocked_unverified"` and counted in `blocked_unverified`, not as broken. On your own site, a 401 or 403 is still reported as broken.

**What counts as "broken"?**
Any HTTP status ≥ 400, plus DNS failures, connection refused, TLS/certificate errors, redirect loops, too-many-redirects, and timeouts after the retry. Working links (including ones that resolve after a redirect) are `is_broken: false` and only appear in the output if `includeOkLinks` is enabled.

**Will I ever get an empty result?**
No. Even a perfectly healthy site with `includeOkLinks` off produces a `site_summary` row (pages scanned, links checked, 0 broken) — you always get at least one row confirming the run actually checked something.

**What happens on a very large or slow site?**
`maxRunMinutes` caps the whole run. As it nears, no new pages are crawled and no new checks start; whatever's already in flight gets up to 15 more seconds before being cut off. The site's `site_summary` row reports `status: "time_limit_reached"`, and any page whose links weren't all checked in time is never charged — you're only billed for pages that were fully audited.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Deterministic HTTP crawling (no browser), retries with backoff, structured failure reporting, daily health checks and issue triage.
