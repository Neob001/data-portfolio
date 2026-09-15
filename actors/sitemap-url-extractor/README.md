# Sitemap URL Extractor & 404 Checker — XML Sitemap Scraper

Extract **every URL from a website's sitemaps** with one input: the site root. Discovers sitemaps via robots.txt and common paths, walks sitemap indexes, and returns flat records with `lastmod`, `changefreq`, and `priority` — optionally HEAD-checking each URL's HTTP status to find broken pages. Sitemaps are built for machines; this is the clean, reliable way to read them.

## What you get

```json
{
  "site": "https://www.example.com",
  "found": true,
  "sitemap_url": "https://www.example.com/sitemap.xml",
  "url": "https://www.example.com/blog/post-42",
  "lastmod": "2026-08-30",
  "changefreq": "weekly",
  "priority": 0.8,
  "http_status": 200,
  "ok": true,
  "source_url": "https://www.example.com/sitemap.xml",
  "fetched_at": "2026-09-12T12:00:00.000Z"
}
```

## Use cases

- **SEO audits**: full URL inventory with freshness signals; find 404s and redirects in the sitemap (`checkStatus: true`).
- **Site migrations**: before/after URL inventories to verify nothing was lost.
- **Crawl seeding**: feed complete URL lists into other scrapers and agents.
- **Monitoring**: schedule it to detect new/removed pages on any site you track.

## Switching from another sitemap extractor

Same input idea (website URLs in, URL records out), plus: robots.txt discovery, sitemap-index traversal, `lastmod/changefreq/priority` preserved, optional live status checks, and `source_url`/`fetched_at` on every record. **Charged per URL row delivered — sites without sitemaps are free.**

## Input

| Field | Type | Notes |
|---|---|---|
| `websiteUrls` | string[], required | Site roots or direct sitemap.xml URLs |
| `checkStatus` | boolean | HEAD-check each URL (default false) |
| `maxUrlsPerSite` | integer | Cap on charged rows per site (default 2000) |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `url-result` | **$0.30 per 1,000** ($0.0003 each) | One URL record delivered. **Sites with no discoverable sitemap and empty runs are never charged.** |

Example: 10,000 URLs cost **$3.00**. You only pay for delivered results.

## factpipe Website Audit Toolkit

Bulk technical checks for agencies, SEO teams and deliverability owners, all pay-per-result. Feed a list of sites in, get one flat row per page or domain out.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Website audit | **Sitemap URL Extractor & 404 Checker** (this Actor) | Extract every URL from XML sitemaps and flag 404s and broken entries | $0.30/1k |
| Website audit | [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) | Lighthouse scores and Core Web Vitals for many pages, mobile or desktop | $10/1k |
| Website audit | [Email Security Checker](https://apify.com/factpipe/email-security-checker) | SPF, DKIM, DMARC and MX audit for any list of domains | $3/1k |

**Use it together:**

- **Full-site audit:** extract URLs here, send the live pages to [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) for Core Web Vitals, and check the domain's mail setup with [Email Security Checker](https://apify.com/factpipe/email-security-checker).

## FAQ

**How do I get all URLs of a website?**
Enter the site root. The Actor discovers sitemaps from robots.txt and common paths, follows nested sitemap indexes and returns one record per URL with lastmod, changefreq and priority.

**Can it find broken links (404s) in my sitemap?**
Yes. Set `checkStatus: true` and every URL gets an HTTP status and an `ok` flag, so 404s and redirects in the sitemap are easy to filter.

**What if a site has no sitemap?**
It is reported as not found and never charged.

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes. Run it through the Apify API or official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and output is deterministic flat JSON.

## Reliability

Deterministic XML parsing, retries with backoff, polite rate limiting, structured failure reporting, daily health checks and issue triage.
