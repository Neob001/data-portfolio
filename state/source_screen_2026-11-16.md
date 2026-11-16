# ATS source screen 2026-11-16 (read-only; subagent, not yet owner-reviewed)

PASS (pending owner APPROVE):
- JazzHR (Employ): boards {co}.applytojob.com/apply (HTML). Public sitemaps http://app.jazz.co/feeds/google/xml/0-4 list ~108k live job URLs (~4,450+ companies in file 0). robots: only /cb disallowed for generic agents. ToS: customer agreement only, no scraping/redistribution clause found. Caveat: sister brand Jobvite's terms ban scraping; re-check Employ legal before each release; throttle.
- Pinpoint: {co}.pinpointhq.com/postings.json (JSON incl. compensation). No public ToS clause found (AUP bans harvesting e-mail addresses only). robots VARIES per tenant (pinpoint.pinpointhq.com is Disallow: /) -> per-tenant robots check (R1) mandatory. Low volume.

UNCLEAR: Join.com (employer-terms redistribution clause; jobs sitemap Cloudflare-gated), Homerun (robots served as text/html -> R1 disallows), Paylocity (ToS unread).

REJECT (rule 3): Breezy HR, Rippling, Jobvite, Dover, Comeet/Spark Hire (bot-gated ToS), Freshteam, ADP (bot-gated ToS, HTML robots), Paradox, UKG/UltiPro (bot-gated ToS), Zoho Recruit. Dayforce not screened (content-signal robots needs a read).
