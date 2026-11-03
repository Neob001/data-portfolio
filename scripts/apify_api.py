#!/usr/bin/env python3
"""Tiny Apify API client shared by all zero-token scripts. Stdlib only.

Auth works in two modes:
- Local: APIFY_TOKEN env var set -> sent as Authorization: Bearer header.
- Claude Code cloud: no env var; the environment's "Apify API" credential
  proxy attaches the Authorization header to api.apify.com requests, so we
  send none ourselves. Never hardcode tokens.
"""
import json
import os
import re
import urllib.parse
import urllib.request

BASE = "https://api.apify.com/v2"

# Free plan only (owner, 2026-11-03): our own runs/builds must leave this much of the
# monthly $5 credit unused, so platform auto-tests and storage never hit the cap.
BUDGET_RESERVE_USD = float(os.environ.get("APIFY_BUDGET_RESERVE_USD", "1.0"))
_STARTS_COMPUTE = re.compile(r"^/(acts|actor-tasks)/[^/]+/(runs|builds|run-sync)")


class BudgetExceeded(RuntimeError):
    """Raised instead of starting a run/build that could push us past the free credit."""


def check_budget(path: str) -> None:
    if not _STARTS_COMPUTE.match(path):
        return
    d = get("/users/me/limits")["data"]
    used, cap = d["current"]["monthlyUsageUsd"], d["limits"]["maxMonthlyUsageUsd"]
    if used > cap - BUDGET_RESERVE_USD:
        raise BudgetExceeded(
            f"refusing POST {path.split('?')[0]}: own Apify usage ${used:.2f} of ${cap:.2f} "
            f"(reserve ${BUDGET_RESERVE_USD:.2f}); cycle ends {d['monthlyUsageCycle']['endAt'][:10]}")


def auth_headers() -> dict:
    t = os.environ.get("APIFY_TOKEN")
    return {"Authorization": f"Bearer {t}"} if t else {}


def check_auth() -> bool:
    """True if we can make authenticated Apify calls (either mode)."""
    try:
        return "username" in get("/users/me")["data"]
    except Exception:
        return False


def get(path: str, **params) -> dict:
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url = f"{BASE}{path}?{qs}" if qs else f"{BASE}{path}"
    req = urllib.request.Request(url, headers=auth_headers())
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def post(path: str, payload: dict) -> dict:
    check_budget(path)
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={**auth_headers(), "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def put(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={**auth_headers(), "Content-Type": "application/json"},
        method="PUT",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


if __name__ == "__main__":
    import sys
    ok = check_auth()
    print("auth ok" if ok else "auth FAILED: set APIFY_TOKEN or configure the environment's Apify API credential")
    sys.exit(0 if ok else 1)
