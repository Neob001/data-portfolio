#!/usr/bin/env python3
"""Cluster-based cross-promotion sections ("factpipe Compliance Suite", "factpipe Website Audit Toolkit").

Default: render drafts to drafts/readme_suite/<slug>.md plus drafts/readme_suite/PREVIEW.md.
Nothing live changes.
--apply <slug...|all>: after owner APPROVE, replace each README's "## Related factpipe Actors"
section with the suite section. Then sync_listings is not needed, but a rebuild is (README changes).
Low-value and unclustered Actors keep their existing Related section.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "drafts" / "readme_suite"

SUITES = {
    "compliance": {
        "name": "factpipe Compliance Suite",
        "intro": ("Official-source compliance data, all pay-per-result and runnable from one Apify account. "
                  "Same conventions everywhere: flat records, ISO dates, `source_url` and `fetched_at` on every row, "
                  "and no charge for empty or failed lookups, so outputs join cleanly in a single KYB, AML or GRC pipeline."),
        "groups": [
            ("Counterparty & KYB checks", ["ofac-sanctions-screening", "eu-vat-validation", "uk-company-lookup"]),
            ("Public-sector sales intelligence", ["sam-gov-contracts", "eu-ted-tenders-monitor"]),
            ("Regulatory & disclosure monitoring", ["federal-register-monitor", "fda-recalls-monitor", "sec-edgar-filings-search"]),
        ],
        "blurbs": {
            "ofac-sanctions-screening": "Screen names against the US Treasury SDN list with fuzzy matching",
            "eu-vat-validation": "Validate EU VAT numbers in bulk against VIES, with registered name and address",
            "uk-company-lookup": "Company status, SIC codes and registered office from Companies House",
            "sam-gov-contracts": "Federal contract opportunities, set-asides and deadlines from SAM.gov",
            "eu-ted-tenders-monitor": "EU public procurement notices from TED, filterable by CPV and country",
            "federal-register-monitor": "New US rules, proposed rules and notices by agency or keyword",
            "fda-recalls-monitor": "FDA food, drug and device recall enforcement reports",
            "sec-edgar-filings-search": "Full-text search across 10-K, 10-Q, 8-K and other SEC filings",
        },
        "recipes": {
            "ofac-sanctions-screening": [
                "**Supplier onboarding:** screen the company name here, confirm the VAT number with [EU VAT Validation]({eu-vat-validation}), then pull status and registered office from [UK Companies House Lookup]({uk-company-lookup}).",
                "**Public-sector bidding:** screen the agencies and awardees you find with [SAM.gov Contracts]({sam-gov-contracts}) or [EU Tenders]({eu-ted-tenders-monitor}).",
            ],
            "eu-vat-validation": [
                "**Invoice and onboarding checks:** validate the VAT number here, screen the returned legal name with [OFAC Sanctions Screening]({ofac-sanctions-screening}), and for UK entities add [UK Companies House Lookup]({uk-company-lookup}).",
            ],
            "uk-company-lookup": [
                "**KYB file:** confirm the company is active here, screen the registered name with [OFAC Sanctions Screening]({ofac-sanctions-screening}), and validate EU trading partners with [EU VAT Validation]({eu-vat-validation}).",
            ],
            "sam-gov-contracts": [
                "**Bid pipeline across both markets:** run this with `sinceLastRun` on a daily schedule next to [EU Tenders]({eu-ted-tenders-monitor}), and watch [Federal Register]({federal-register-monitor}) for rule changes affecting your contract categories.",
                "**Teaming-partner due diligence:** screen partner names with [OFAC Sanctions Screening]({ofac-sanctions-screening}).",
            ],
            "eu-ted-tenders-monitor": [
                "**Bid pipeline across both markets:** pair this with [SAM.gov Contracts]({sam-gov-contracts}) for US federal opportunities.",
                "**Buyer and consortium checks:** validate EU partners with [EU VAT Validation]({eu-vat-validation}) and screen them with [OFAC Sanctions Screening]({ofac-sanctions-screening}).",
            ],
            "federal-register-monitor": [
                "**Regulatory watch desk:** schedule this with [FDA Recalls]({fda-recalls-monitor}) for enforcement actions and [SEC EDGAR Filings]({sec-edgar-filings-search}) for how companies disclose the impact.",
            ],
            "fda-recalls-monitor": [
                "**Product safety and supplier risk:** track new recalls here, follow related rulemaking with [Federal Register]({federal-register-monitor}), and check recalling firms' disclosures in [SEC EDGAR Filings]({sec-edgar-filings-search}).",
            ],
            "sec-edgar-filings-search": [
                "**Disclosure and risk research:** combine filing searches with [Federal Register]({federal-register-monitor}) rule changes and [FDA Recalls]({fda-recalls-monitor}) enforcement history for the same companies.",
                "**Counterparty checks:** screen issuers and subsidiaries with [OFAC Sanctions Screening]({ofac-sanctions-screening}).",
            ],
        },
    },
    "website": {
        "name": "factpipe Website Audit Toolkit",
        "intro": ("Bulk technical checks for agencies, SEO teams and deliverability owners, all pay-per-result. "
                  "Feed a list of sites in, get one flat row per page or domain out."),
        "groups": [
            ("Website audit", ["sitemap-url-extractor", "lighthouse-auditor", "email-security-checker"]),
        ],
        "blurbs": {
            "sitemap-url-extractor": "Extract every URL from XML sitemaps and flag 404s and broken entries",
            "lighthouse-auditor": "Lighthouse scores and Core Web Vitals for many pages, mobile or desktop",
            "email-security-checker": "SPF, DKIM, DMARC and MX audit for any list of domains",
        },
        "recipes": {
            "sitemap-url-extractor": [
                "**Full-site audit:** extract URLs here, send the live pages to [Lighthouse Auditor]({lighthouse-auditor}) for Core Web Vitals, and check the domain's mail setup with [Email Security Checker]({email-security-checker}).",
            ],
            "lighthouse-auditor": [
                "**Audit every page, not just the homepage:** get the full URL list from [Sitemap URL Extractor & 404 Checker]({sitemap-url-extractor}) first, then audit it here.",
                "**Client health report:** add SPF/DKIM/DMARC results from [Email Security Checker]({email-security-checker}).",
            ],
            "email-security-checker": [
                "**Agency site-and-domain health report:** combine these results with [Lighthouse Auditor]({lighthouse-auditor}) performance scores and [Sitemap URL Extractor & 404 Checker]({sitemap-url-extractor}) broken-URL counts.",
            ],
        },
    },
}

SHORT = {
    "ofac-sanctions-screening": "OFAC Sanctions Screening",
    "eu-vat-validation": "EU VAT Validation",
    "uk-company-lookup": "UK Companies House Lookup",
    "sam-gov-contracts": "SAM.gov Contracts",
    "eu-ted-tenders-monitor": "EU Tenders (TED)",
    "federal-register-monitor": "Federal Register Monitor",
    "fda-recalls-monitor": "FDA Recalls Monitor",
    "sec-edgar-filings-search": "SEC EDGAR Filings",
    "sitemap-url-extractor": "Sitemap URL Extractor & 404 Checker",
    "lighthouse-auditor": "Lighthouse Auditor",
    "email-security-checker": "Email Security Checker",
}


def url(slug):
    return f"https://apify.com/factpipe/{slug}"


def price_note(meta):
    ev = next(iter(meta["ppe_events"].values()))
    p = ev["proposed_price_usd"] * 1000
    return (f"${p:.0f}" if p == int(p) else f"${p:.2f}") + "/1k"


def render(slug, suite, registry):
    lines = [f"## {suite['name']}", "", suite["intro"], ""]
    lines += ["| Workflow | Actor | What it does | Price |", "|---|---|---|---|"]
    for group, members in suite["groups"]:
        for m in members:
            name = f"**{SHORT[m]}** (this Actor)" if m == slug else f"[{SHORT[m]}]({url(m)})"
            lines.append(f"| {group} | {name} | {suite['blurbs'][m]} | {price_note(registry[m])} |")
    lines += ["", "**Use it together:**", ""]
    links = {m: url(m) for g in suite["groups"] for m in g[1]}
    for r in suite["recipes"][slug]:
        lines.append("- " + r.format(**links))
    return "\n".join(lines) + "\n"


def members():
    for key, suite in SUITES.items():
        for _, ms in suite["groups"]:
            for m in ms:
                yield m, suite


SECTION_RE = re.compile(r"## Related factpipe Actors\n.*?(?=\n## )", re.S)


def main():
    registry = json.loads((ROOT / "registry.json").read_text())["actors"]
    if "--apply" in sys.argv:
        targets = sys.argv[sys.argv.index("--apply") + 1:]
        done = []
        for slug, suite in members():
            if targets != ["all"] and slug not in targets:
                continue
            readme = ROOT / "actors" / slug / "README.md"
            text = readme.read_text()
            section = render(slug, suite, registry)
            new, n = SECTION_RE.subn(section.rstrip("\n") + "\n", text, count=1)
            if n == 0:
                new = text.replace("\n## FAQ", "\n" + section + "\n## FAQ", 1)
            readme.write_text(new)
            done.append(slug)
        print("applied:", ", ".join(done), "\nnext: rebuild these Actors (README changes need a build)")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    preview = ["# DRAFT — cluster cross-promotion sections (not live)", "",
               "On approval each replaces the README's current `## Related factpipe Actors` section "
               "(`python3 scripts/draft_suite_sections.py --apply all`, then rebuild). Wikipedia, Open Food Facts, "
               "US Weather, ECB and Jobs keep their current links (low-value or unclustered: no investment).", ""]
    for slug, suite in members():
        section = render(slug, suite, registry)
        (OUT / f"{slug}.md").write_text(section)
        preview += [f"---", f"### README of `{slug}`", "", section.replace("## ", "#### ", 1)]
    (OUT / "PREVIEW.md").write_text("\n".join(preview))
    print(f"wrote {len(list(members()))} drafts to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
