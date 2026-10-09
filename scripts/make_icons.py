#!/usr/bin/env python3
"""Generate Store icons (512x512 PNG) into docs/icons/<slug>.png, served by GitHub Pages.

Needs Pillow (not a runtime dependency of anything else): run it from any venv with Pillow installed.
Colour = product cluster, label = what the Actor is about, so related Actors look like one family.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "icons"
SIZE = 512

CLUSTERS = {  # top and bottom gradient colours
    "compliance": ((30, 58, 138), (37, 99, 235)),
    "website": ((15, 118, 110), (20, 184, 166)),
    "jobs": ((91, 33, 182), (139, 92, 246)),
    "data": ((180, 83, 9), (245, 158, 11)),
}

ICONS = {
    "ofac-sanctions-screening": ("compliance", "AML"),
    "eu-vat-validation": ("compliance", "VAT"),
    "uk-company-lookup": ("compliance", "UK"),
    "france-company-lookup": ("compliance", "SIREN"),
    "sam-gov-contracts": ("compliance", "SAM"),
    "eu-ted-tenders-monitor": ("compliance", "TED"),
    "federal-register-monitor": ("compliance", "FED"),
    "fda-recalls-monitor": ("compliance", "FDA"),
    "sec-edgar-filings-search": ("compliance", "SEC"),
    "sitemap-url-extractor": ("website", "XML"),
    "broken-link-checker": ("website", "404"),
    "lighthouse-auditor": ("website", "CWV"),
    "email-security-checker": ("website", "SPF"),
    "dns-records-lookup": ("website", "DNS"),
    "tech-stack-detector": ("website", "STACK"),
    "website-screenshot": ("website", "SNAP"),
    "ats-jobs-feed": ("jobs", "JOBS"),
    "remote-jobs-feed": ("jobs", "WFH"),
    "ats-jobs-scraper": ("jobs", "ATS"),
    "companies-hiring": ("jobs", "HIRE"),
    "greenhouse-jobs-api": ("jobs", "GH"),
    "lever-jobs-api": ("jobs", "LEVER"),
    "ashby-jobs-api": ("jobs", "ASHBY"),
    "workday-jobs-api": ("jobs", "WD"),
    "company-jobs-scraper": ("jobs", "CAREER"),
    "ecb-exchange-rates": ("data", "FX"),
    "us-weather-forecast": ("data", "WX"),
    "wikipedia-scraper": ("data", "WIKI"),
    "open-food-facts-scraper": ("data", "FOOD"),
}

FONT = "/System/Library/Fonts/Helvetica.ttc"


def gradient(top, bottom):
    img = Image.new("RGB", (SIZE, SIZE))
    d = ImageDraw.Draw(img)
    for y in range(SIZE):
        t = y / (SIZE - 1)
        d.line([(0, y), (SIZE, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(top, bottom)))
    return img


def fitted_font(draw, text, max_width):
    size = 260
    while size > 40:
        font = ImageFont.truetype(FONT, size, index=1)  # Helvetica Bold
        l, t, r, b = draw.textbbox((0, 0), text, font=font)
        if r - l <= max_width:
            return font
        size -= 8
    return ImageFont.truetype(FONT, size, index=1)


def render(cluster, label):
    img = gradient(*CLUSTERS[cluster])
    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=96, fill=255)
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    d = ImageDraw.Draw(out)
    font = fitted_font(d, label, SIZE - 120)
    l, t, r, b = d.textbbox((0, 0), label, font=font)
    d.text(((SIZE - (r - l)) / 2 - l, (SIZE - (b - t)) / 2 - t - 12), label, font=font, fill=(255, 255, 255))
    d.rounded_rectangle([SIZE / 2 - 60, SIZE - 110, SIZE / 2 + 60, SIZE - 96], radius=7, fill=(255, 255, 255, 170))
    return out


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for slug, (cluster, label) in ICONS.items():
        render(cluster, label).save(OUT / f"{slug}.png", optimize=True)
    print(f"wrote {len(ICONS)} icons to {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
