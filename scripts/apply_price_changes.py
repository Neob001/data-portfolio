#!/usr/bin/env python3
"""Propagate an approved price change into listing copy, READMEs and registry — but only after
the live PPE price on Apify actually matches (pricing itself is Console-only).

Pending changes live in state/price_changes.json: {slug: {"event": ..., "new_price_usd": ...}}.
For each: read the actor's live pricingInfos; if the event price equals new_price_usd, rewrite
"$X per 1,000" / "$X each" mentions in the registry listing and README, update ppe_events, and
mark the change applied. Mismatches are reported and left pending. Then run
sync_listings.py <slugs> and rebuild the touched actors (README changes need a build).

Usage: apply_price_changes.py [--dry-run]
"""
import json
import re
import sys
import time
from pathlib import Path

from apify_api import get

ROOT = Path(__file__).resolve().parent.parent
PENDING = ROOT / "state" / "price_changes.json"


def live_price(actor_id, event):
    for attempt in range(5):
        try:
            data = get(f"/acts/{actor_id}")["data"]
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(2 * (attempt + 1))
    infos = data.get("pricingInfos") or []
    if not infos:
        return None
    ev = (infos[-1].get("pricingPerEvent") or {}).get("actorChargeEvents", {}).get(event) or {}
    return ev.get("eventPriceUsd")


def fmt_per_1k(price):
    v = round(price * 1000, 6)
    return str(int(v)) if v == int(v) else f"{v:.2f}"


def rewrite(text, old, new):
    """Replace price mentions of the old price with the new one; returns (text, count)."""
    o1k, n1k = fmt_per_1k(old), fmt_per_1k(new)
    patterns = [
        (rf"\*\*\${re.escape(f'{old*1000:.2f}')} per 1,000\*\* \(\${re.escape(str(old))} each\)",
         f"**${new*1000:.2f} per 1,000** (${new} each)"),
        (rf"\${re.escape(o1k)} per 1,000", f"${n1k} per 1,000"),
        (rf"\${re.escape(str(old))} per (name|lookup|filing|tender|document|recall)", rf"${new} per \1"),
    ]
    total = 0
    for pat, rep in patterns:
        text, n = re.subn(pat, rep, text)
        total += n
    return text, total


def main():
    dry = "--dry-run" in sys.argv
    pending = json.loads(PENDING.read_text()) if PENDING.exists() else {}
    registry = json.loads((ROOT / "registry.json").read_text())
    applied, waiting = [], []
    for slug, change in pending.items():
        if change.get("applied"):
            continue
        meta = registry["actors"][slug]
        event, new = change["event"], change["new_price_usd"]
        old = meta["ppe_events"][event]["proposed_price_usd"]
        live = live_price(meta["apify_actor_id"], event)
        if live is None or abs(live - new) > 1e-9:
            waiting.append(f"{slug}: live ${live} != approved ${new} (set it in Console first)")
            continue
        listing = meta.get("listing", {})
        n_listing = 0
        for field in ("description", "seoDescription"):
            if field in listing:
                listing[field], n = rewrite(listing[field], old, new)
                n_listing += n
        readme = ROOT / "actors" / slug / "README.md"
        text, n_readme = rewrite(readme.read_text(), old, new)
        # Example lines like "500 filings cost **$4.00**" depend on price; recompute simple "N ... cost **$X**".
        def example(m):
            qty = int(m.group(1).replace(",", ""))
            return f"{m.group(1)}{m.group(2)}cost **${qty * new:,.2f}**"
        text, n_ex = re.subn(r"(\d[\d,]*)(\s[^*\n]{1,60}?)cost \*\*\$[\d,.]+\*\*", example, text)
        if not dry:
            readme.write_text(text)
            meta["ppe_events"][event]["proposed_price_usd"] = new
            meta.setdefault("price_history", []).append({"date": time.strftime("%Y-%m-%d"), "event": event, "from": old, "to": new})
            change["applied"] = True
        applied.append(f"{slug}: ${old} -> ${new} (listing mentions {n_listing}, README mentions {n_readme}, examples {n_ex})")
    if not dry:
        (ROOT / "registry.json").write_text(json.dumps(registry, indent=2, ensure_ascii=False) + "\n")
        PENDING.write_text(json.dumps(pending, indent=2) + "\n")
    print("APPLIED:\n  " + "\n  ".join(applied) if applied else "APPLIED: none")
    print("WAITING:\n  " + "\n  ".join(waiting) if waiting else "WAITING: none")
    return 0 if not waiting else 1


if __name__ == "__main__":
    sys.exit(main())
