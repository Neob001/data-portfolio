#!/usr/bin/env python3
"""Issue triage, zero token first. Matches new Apify issues against FAQ
templates by keyword; writes template replies to state/issue_replies.json
(auto-postable only for classes the owner enabled in DECISIONS.md) and
routes everything else to state/issues_for_model.json for the issues-daily
Routine (Haiku) to draft.

Note: Apify's public API for the Issues tab may change; endpoint isolated in
fetch_issues() so it is a one-line fix.
"""
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from apify_api import get

ROOT = Path(__file__).resolve().parent.parent

TEMPLATES = [
    {
        "id": "input-format",
        "match": re.compile(r"(input|schema|how (do|to) (i|you) (run|use)|invalid.*(field|value)|example)", re.I),
        "reply": "Thanks for reaching out! The Actor needs {example_hint}. There's a ready-to-run example on the Input tab — click 'Start' with the prefilled values to see the output format, then adapt it. If your input still fails, paste it here and we'll take a look within a day.",
    },
    {
        "id": "empty-results",
        "match": re.compile(r"(no (results|data)|empty (dataset|results)|0 (rows|items|results))", re.I),
        "reply": "Thanks for the report. Empty result sets are usually a too-narrow filter (date window or keyword). Note you are never charged for empty runs. Try widening the filters; if a query that used to return data now returns none, tell us the exact input and we'll investigate the source within a day.",
    },
    {
        "id": "charging",
        "match": re.compile(r"(charg|billing|price|cost|refund|pay)", re.I),
        "reply": "This Actor is pay-per-event: you're charged only per successful result delivered (see the Pricing section of the README; empty runs and failed lookups are free). Refunds for problem runs are handled by Apify — meanwhile tell us the run ID and we'll check what happened.",
    },
]


def fetch_issues() -> list:
    # Placeholder endpoint: adjust when the account is connected.
    try:
        return get("/actor-issues", limit=50)["data"]["items"]
    except (Exception, SystemExit):
        return []


def main() -> None:
    issues = fetch_issues()
    auto, for_model = [], []
    for issue in issues:
        text = f"{issue.get('title', '')} {issue.get('body', '')}"
        matched = next((t for t in TEMPLATES if t["match"].search(text)), None)
        target = auto if matched else for_model
        target.append({
            "issue_id": issue.get("id"),
            "actor": issue.get("actorName"),
            "title": (issue.get("title") or "")[:200],
            "template": matched["id"] if matched else None,
            "draft_reply": matched["reply"] if matched else None,
        })
    state = ROOT / "state"
    state.mkdir(exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    (state / "issue_replies.json").write_text(json.dumps({"generated_at": now, "replies": auto}, indent=2))
    (state / "issues_for_model.json").write_text(json.dumps({"generated_at": now, "issues": for_model}, indent=2))
    print(f"templated={len(auto)} routed_to_model={len(for_model)}")


if __name__ == "__main__":
    main()
