# Tech Stack Detector — Wappalyzer Alternative: Find the CMS, Ecommerce Platform, Analytics, CDN & Hosting of Any Website

**Detect the technology stack of any list of websites in bulk: CMS, ecommerce platform, analytics and tag managers, CDN, hosting/PaaS, JavaScript frameworks, web server, payment processors, marketing automation and email provider. 3,000+ technologies, plain HTTP + DNS (no browser), one flat row per site. $5 per 1,000 domains.**

Paste domains or URLs, get back what each site is built with, a confidence score and version where the site exposes one, plus ready-to-filter columns like `cms`, `ecommerce_platform` and `cdn`. It uses MIT-licensed community fingerprints (Wappalyzer format) matched against response headers, cookies, meta tags, script URLs, page markup and public DNS records. No API key, no login, no personal data.

## Quick start

1. Click **Start** with the three prefilled sites (`https://www.shopify.com`, `https://github.com`, `https://www.nytimes.com`). It finishes in well under a minute.
2. You get one row per site with its technologies, categories and the flat columns (`cms`, `ecommerce_platform`, `analytics`, `cdn`, `hosting_or_paas`, `mail_provider`, ...).
3. That first run costs at most **$0.015** (3 sites × $0.005), well within Apify's free monthly credit. Then paste your own list: thousands of domains per run are fine.

## What you get

One row per website (real output for `https://www.shopify.com`, trimmed):

```json
{
  "url": "https://www.shopify.com/",
  "final_url": "https://www.shopify.com/",
  "domain": "shopify.com",
  "status_code": 200,
  "ok": true,
  "error": null,
  "technologies": [
    { "name": "Shopify", "categories": ["Ecommerce"], "version": null, "confidence": 100 },
    { "name": "Cloudflare", "categories": ["CDN"], "version": null, "confidence": 100 },
    { "name": "HSTS", "categories": ["Security"], "version": null, "confidence": 100 },
    { "name": "Google Workspace", "categories": ["Webmail", "Email"], "version": null, "confidence": 100 },
    { "name": "Zendesk", "categories": ["Documentation", "Issue trackers", "Live chat"], "version": null, "confidence": 100 },
    { "name": "Stripe", "categories": ["Payment processors"], "version": null, "confidence": 100 }
  ],
  "technology_names": ["Shopify", "Cloudflare", "HSTS", "Google Workspace", "Zendesk", "Stripe"],
  "categories": ["Ecommerce", "CDN", "Security", "Webmail", "Email", "Documentation", "Issue trackers", "Live chat", "Payment processors"],
  "cms": null,
  "ecommerce_platform": "Shopify",
  "analytics": [],
  "tag_managers": [],
  "cdn": "Cloudflare",
  "hosting_or_paas": null,
  "javascript_frameworks": [],
  "web_server": null,
  "programming_languages": [],
  "marketing_automation": [],
  "payment_processors": ["Stripe"],
  "mail_provider": "Google Workspace",
  "dns_provider": null,
  "has_spf": true,
  "has_dmarc": true,
  "verification_tokens": ["microsoft", "apple", "atlassian", "docusign", "facebook", "google", "stripe"],
  "technology_count": 6,
  "source_url": "https://www.shopify.com/",
  "fetched_at": "2026-09-30T12:28:20.258Z"
}
```

A WordPress site returns e.g. `"cms": "WordPress"` (with its version when the site exposes it), `"web_server": "Nginx"`, `"programming_languages": ["PHP"]`; a Next.js site on Vercel returns `"hosting_or_paas": "Vercel"`, `"javascript_frameworks": ["React"]`.

## Use cases

- **Sales prospecting & lead enrichment by technology**: find every Shopify, WooCommerce, Magento or BigCommerce store in a lead list, or every company on HubSpot, Salesforce or Zendesk, and route leads by the tools they already use.
- **Competitor research**: see which CMS, analytics, A/B testing, CDN and hosting your competitors run, and which versions.
- **Agency audits & pitches**: audit a client portfolio in one run: outdated CMS versions, missing tag manager, no CDN, no SPF/DMARC.
- **Market-share research**: count technology adoption across thousands of domains (e.g. "share of top ecommerce sites on Shopify vs. Salesforce Commerce Cloud").
- **Security & IT inventory**: inventory the web servers, frameworks, CDNs and exposed versions across all your company's domains and subsidiaries.

## Input

| Field | Type | Notes |
|---|---|---|
| `urls` | string[], required | Website URLs or bare domains (`shopify.com`). One row per site; `www.` and non-`www.` of the same host count as one site (first URL wins). Bare domains are tried over https first, then http. |
| `includeDns` | boolean | Default `true`. Also looks up MX, TXT, NS and SOA records (via 1.1.1.1 / 8.8.8.8) for `mail_provider`, `dns_provider`, `has_spf`, `has_dmarc`, `verification_tokens` and DNS-based detections (Google Workspace, Microsoft 365, HubSpot, Zendesk, ...). |
| `categoriesFilter` | string[] | Optional. Return only technologies in these categories (e.g. `CMS`, `Ecommerce`, `Analytics`). Flat columns are always filled. A site with no technology in the chosen categories is delivered but **not charged**. |
| `maxConcurrency` | integer | Default `10` (1–50). Sites fetched in parallel. |

## Output fields

| Field | Meaning |
|---|---|
| `technologies` | `[{ name, categories[], version, confidence }]`, strongest first. `confidence` is 0–100 (Wappalyzer-style: pattern confidences add up, capped at 100). |
| `technology_names`, `categories`, `technology_count` | Flattened names, unique category names, count (after `categoriesFilter`). |
| `cms`, `ecommerce_platform`, `cdn`, `hosting_or_paas`, `web_server` | Best single match per column (`null` if none). CDN / hosting / web server prefer evidence from the site's own response headers. |
| `analytics`, `tag_managers`, `javascript_frameworks`, `programming_languages`, `marketing_automation`, `payment_processors` | All matches per column. |
| `mail_provider`, `dns_provider`, `has_spf`, `has_dmarc`, `verification_tokens` | From public DNS (`null` when `includeDns` is off or DNS could not be read). |
| `ok`, `error`, `status_code`, `final_url` | `error` is one of `invalid_url`, `dns_not_found`, `timeout`, `http_error`, `blocked`, `tls_error`, `connection_error` (or `null`). |

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `domain-analyzed` | **$5 per 1,000** ($0.005 each) | One website that loaded (`ok: true`) and returned at least one technology. |

Failures (invalid input, nonexistent domain, timeout, HTTP error, bot-protection block) and pages with zero detections are **free**. You can cap spend with the run's maximum charge; the Actor stops cleanly when it is reached.

Example: analyzing 1,000 domains costs at most **$5.00**. No start fee.

## Coverage

- **Fingerprints**: 3,588 technologies in 108 categories from the last MIT-licensed Wappalyzer fingerprint snapshot (January 2023), of which about 3,150 can be detected from HTTP + DNS; the rest are reachable through `implies` (e.g. WordPress → PHP, MySQL).
- **No JavaScript execution.** This Actor fetches the page over plain HTTP (fast and cheap) and matches headers, cookies set by the server, `<meta>` tags, `<script src>` URLs, inline scripts, markup, CSS selectors, the URL and DNS records. Technologies that only reveal themselves after JavaScript runs in a browser (global JS variables, tags injected later by a tag manager, client-side-only single-page apps, cookies set by JavaScript) **may be missed**. Wappalyzer's `js`, `css`, `xhr` and `robots` patterns are skipped.
- **One page per site**: the URL you give (after redirects), not a crawl. The home page usually carries the most signals.
- **Bot protection**: sites behind aggressive bot protection may return a challenge page; the row gets `error: "blocked"` (free), still listing what the headers revealed (e.g. Cloudflare, DataDome).
- **DNS-based detections** (TXT verification records, SPF includes, MX) describe the organization's SaaS and email stack, e.g. Zendesk or Salesforce. They appear in `technologies` but never fill website columns like `cms` or `cdn`.
- **Snapshot age**: technologies launched after early 2023, or that changed their markers since, may be missing. A few noisy rules were tightened (e.g. Route 53 name servers no longer imply "hosted on AWS"); see `FINGERPRINTS_LICENSE.md`.
- **Regex safety**: third-party patterns are pre-compiled once with bounded quantifiers, inputs are size-capped (5 MB body, 1 MB of HTML scanned), and slow patterns are dropped at build time and disabled at run time.

## Fingerprint license and attribution

Technology fingerprints are derived from the `wappalyzer` npm package **v6.10.54**, the last release published under the **MIT license** (Copyright 2008 Wappalyzer). The MIT copyright and permission notice is retained in `FINGERPRINTS_LICENSE.md`, together with the exact package URL, checksum and license verification. No GPL-licensed fork and none of Wappalyzer's current proprietary data is used. The detection engine is an independent implementation.

## factpipe Website Audit Toolkit

Bulk technical checks for agencies, SEO, sales and security teams, all pay-per-result. Feed a list of sites in, get one flat row per page or domain out.

| Workflow | Actor | What it does | Price |
|---|---|---|---|
| Website audit | **Tech Stack Detector** (this Actor) | CMS, ecommerce platform, analytics, CDN, hosting and 3,000+ technologies per site | $5/1k |
| Website audit | [Lighthouse Auditor](https://apify.com/factpipe/lighthouse-auditor) | Lighthouse scores and Core Web Vitals for many pages, mobile or desktop | $10/1k |
| Website audit | [Broken Link Checker](https://apify.com/factpipe/broken-link-checker) | Crawl a site and flag every broken internal/external link, image and asset | $1.50/1k |
| Website audit | [Website Screenshot](https://apify.com/factpipe/website-screenshot) | Bulk full-page or viewport screenshots, desktop or mobile | $2/1k |
| Domain audit | [Email Security Checker](https://apify.com/factpipe/email-security-checker) | SPF, DKIM, DMARC and MX audit for any list of domains | $3/1k |
| Domain audit | [DNS Records Lookup](https://apify.com/factpipe/dns-records-lookup) | Full DNS record set (A, AAAA, MX, TXT, NS, CNAME) for any list of domains | $1.50/1k |

For sales prospecting, combine it with [Companies Hiring](https://apify.com/factpipe/companies-hiring): find companies that are hiring, then enrich their domains with the tech stack they run.

## FAQ

**Is this Wappalyzer?**
No. It is an independent Actor, not affiliated with or endorsed by Wappalyzer. It uses the MIT-licensed community fingerprints that Wappalyzer published until early 2023, with its own detection engine that runs over plain HTTP and DNS.

**Why is a technology I know the site uses missing?**
Most likely it only shows up after JavaScript runs in a browser (see Coverage), it is loaded on a different page than the one analyzed, or it is newer than the fingerprint snapshot. Try the specific page URL where it is used.

**Am I charged for sites that fail or show nothing?**
No. Only rows with `ok: true` and at least one technology (after your `categoriesFilter`) are charged. Invalid inputs, nonexistent domains, timeouts, HTTP errors, blocked pages and empty results are free.

**What does `confidence` mean?**
Each matching pattern adds its confidence (usually 100, sometimes 25 or 50 for weak signals); the total is capped at 100. Implied technologies take the lower of the parent's confidence and the implication's. Filter on `confidence >= 50` if you want only strong matches.

**How fast is it?**
A typical site takes 1–3 seconds (one HTTP request plus DNS). The default concurrency of 10 analyzes roughly 100–300 sites per minute. Each fetch has a 20-second timeout and one retry on timeouts and 5xx errors; runs stop cleanly before the run timeout and report any unprocessed URLs in the status message.

**Do you collect personal data?**
No. Only technical metadata of public websites and public DNS records is returned; nothing behind a login is accessed.

**Can I call it from Python, JavaScript, Make, Zapier, n8n or an AI agent?**
Yes. Run it through the Apify API or the official Python/JavaScript clients, connect it to Make, Zapier, n8n, Slack or Google Sheets via Apify integrations, or expose it to AI agents through the Apify MCP server. Input is small and the output is deterministic flat JSON.

## Reliability

Deterministic code: pre-compiled fingerprints, one HTTP fetch per site with a realistic browser User-Agent, redirect following, a 5 MB body cap, one retry on transient failures, structured error codes, a run summary record every run, golden-fixture tests, daily health checks and issue triage.
