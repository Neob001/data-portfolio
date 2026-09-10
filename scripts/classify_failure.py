#!/usr/bin/env python3
"""Rule-based failure classifier. Zero token.

Usage: classify_failure.py <run_id>   (or pipe log text on stdin with -)
Prints one of: http_error timeout blocked selector_miss schema_change
site_down unknown
"""
import re
import sys

from apify_api import get

RULES = [
    ("blocked", re.compile(r"(403 Forbidden|429|captcha|cloudflare|access denied|blocked)", re.I)),
    ("timeout", re.compile(r"(timed?[ -]?out|AbortError|ETIMEDOUT|ESOCKETTIMEDOUT)", re.I)),
    ("site_down", re.compile(r"(ECONNREFUSED|ENOTFOUND|ECONNRESET|50[0-4] |certificate|socket hang up)", re.I)),
    ("schema_change", re.compile(r"(schema_change|Unexpected .* response shape|Non-JSON response|KeyError|undefined is not)", re.I)),
    ("selector_miss", re.compile(r"(selector_miss|selector .* not found|empty result set expected non-empty)", re.I)),
    ("http_error", re.compile(r"(HTTP 4\d\d|status code 4\d\d)", re.I)),
]


def classify(log_text: str) -> str:
    # RUN_SUMMARY failure_class emitted by our actors wins outright.
    m = re.search(r'failure[_=]"?(\w+)', log_text)
    if m and m.group(1) in {r[0] for r in RULES} | {"http_error"}:
        return m.group(1)
    for name, rx in RULES:
        if rx.search(log_text):
            return name
    return "unknown"


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: classify_failure.py <run_id>|-")
    if sys.argv[1] == "-":
        text = sys.stdin.read()
    else:
        # Truncated log only: last 200 lines, never feed full logs anywhere.
        import urllib.request
        from apify_api import BASE, token
        req = urllib.request.Request(
            f"{BASE}/logs/{sys.argv[1]}", headers={"Authorization": f"Bearer {token()}"},
        )
        with urllib.request.urlopen(req, timeout=30) as r:
            text = "\n".join(r.read().decode(errors="replace").splitlines()[-200:])
    print(classify(text))


if __name__ == "__main__":
    main()
