#!/usr/bin/env python3
"""Tiny Apify API client shared by all zero-token scripts. Stdlib only.

Reads the token from APIFY_TOKEN (injected as an API credential in the
Claude Code cloud environment; never hardcode it).
"""
import json
import os
import urllib.parse
import urllib.request

BASE = "https://api.apify.com/v2"


def token() -> str:
    t = os.environ.get("APIFY_TOKEN")
    if not t:
        raise SystemExit("APIFY_TOKEN is not set; configure it as an API credential.")
    return t


def get(path: str, **params) -> dict:
    qs = urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})
    url = f"{BASE}{path}?{qs}" if qs else f"{BASE}{path}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token()}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def post(path: str, payload: dict) -> dict:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode(),
        headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)
