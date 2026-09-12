# Decisions log

Owner writes one line per decision: `YYYY-MM-DD | APPROVE|REJECT | item-id | note`

Item ids come from WEEKLY_REPORT.md. Nothing ships to a new data source, changes price, or auto-replies to an issue class without an APPROVE line here.

<!-- decisions below this line -->

## Standing decisions (owner) — 2026-09-12
<!-- appended verbatim from owner-provided addendum-fast-revenue-modules.md on 2026-09-12 -->
2026-09-12 | APPROVE | AUTO-APPROVE replacements: yes | Top-3 opportunity_score per day, legal_flag == false, public site, no login. Build and publish without asking. Owner may veto within 24h by adding a REJECT line with the INC-id; a veto unpublishes the Actor.
2026-09-12 | APPROVE | AUTO-APPROVE demand builds ≤ 6h: yes | Buildable demand hits with estimated build ≤ 6h, legal_flag == false, no personal data. Build and stage without asking. Owner may veto within 24h by adding a REJECT line with the DC-id.
2026-09-12 | REJECT | AUTO-POST community replies | Never. Community replies are posted only after the owner ticks [x] in DAILY_APPROVALS.md.
2026-09-12 | REJECT | INC-3 | Europages replacement rejected (owner, in chat): CAPTCHA-gated ToS = no automated access; anti-bot arms race contradicts official-API moat. Official EU registries (INSEE/Sirene) queued as alternative.
2026-09-12 | REJECT | identity-verified sources (standing) | Owner, in chat: never pursue any data source or API whose access requires photo-ID + selfie identity verification (ID.me or equivalent). USPTO ODP dropped from the build queue under this rule. Applies to all future scans and proposals.
