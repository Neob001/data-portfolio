#!/usr/bin/env python3
"""Discover JazzHR career pages (<company>.applytojob.com) from JazzHR's public job sitemaps.

Zero-token, stdlib only. Every applytojob.com host's robots.txt lists the same public sitemaps
(`Sitemap: http://app.jazz.co/feeds/google/xml/0` ... `/4`), which name every live job page as
https://<company>.applytojob.com/apply/<id>/<slug>. This script reads them (robots.txt of app.jazz.co first,
asked with Accept: text/plain, rule R1: only a 2xx text/plain file that allows the path counts; 404/410 = no
restrictions), takes the company subdomain of each job URL, and writes jazzhr_candidates.json:

  {"_comment": "...", "_source": {"sitemaps": [...], "fetched": "YYYY-MM-DD", "job_urls": N},
   "jazzhr": ["acme", ...]}

The file is committed; validate_boards.py checks each candidate (robots.txt of its own host, then its career page)
and only boards with >= 1 open job go to boards.json. No job page and no career page is fetched here.

Usage:
  python3 discover_jazzhr.py                  # all sitemap files (0..N until a file is missing or empty)
  python3 discover_jazzhr.py --max-files 1    # first file only (smoke)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from validate_boards import UA, Pacer, get_robots, robots_verdict  # noqa: E402  (same robots rules as the builder)

OUT = os.path.join(HERE, 'jazzhr_candidates.json')
SITEMAP_HOST = 'app.jazz.co'
SITEMAP_PATH = '/feeds/google/xml/{n}'
JOB_URL_RX = re.compile(r'<loc>\s*https?://([a-z0-9][a-z0-9-]{0,62})\.applytojob\.com/apply/([A-Za-z0-9]{6,80})[/?<]', re.I)
RESERVED = {'www', 'app', 'api', 'cdn', 'assets', 'static', 'support', 'help', 'status', 'docs', 'blog', 'developers',
            'developer', 'mail', 'demo', 'staging', 'test', 'sandbox', 'login', 'auth', 'sso'}


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, file=sys.stderr, flush=True)


def fetch(url, timeout=300, retries=2):
    """-> (status, text); status 0 when unreachable."""
    delay = 5
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/xml, text/xml;q=0.9, */*;q=0.1'})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.status, r.read().decode('utf-8', 'replace')
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            return e.code, ''
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            if attempt < retries:
                time.sleep(delay)
                delay *= 2
                continue
            return 0, ''
    return 0, ''


def tokens_from_sitemap(xml):
    """Sitemap XML -> {token: number of job URLs}."""
    counts = {}
    for host, _job in JOB_URL_RX.findall(xml):
        tok = host.lower()
        if tok not in RESERVED:
            counts[tok] = counts.get(tok, 0) + 1
    return counts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--max-files', type=int, default=10, help='read sitemap files 0..N-1 (stops at the first missing/empty one)')
    ap.add_argument('--out', default=OUT)
    args = ap.parse_args()
    pacer = Pacer(2.0)
    status, text, ctype = get_robots(f'https://{SITEMAP_HOST}/robots.txt', pacer)
    allowed, reason = robots_verdict(status, text, ctype, [SITEMAP_PATH.format(n=0)])
    log(f'{SITEMAP_HOST} robots.txt: {reason}')
    if not allowed:
        log('sitemaps not read (robots.txt); candidates unchanged')
        return 1
    counts, files, urls = {}, [], 0
    for n in range(args.max_files):
        url = f'http://{SITEMAP_HOST}{SITEMAP_PATH.format(n=n)}'
        pacer.wait()
        t0 = time.time()
        st, xml = fetch(url)
        found = tokens_from_sitemap(xml) if st == 200 else {}
        log(f'{url}: HTTP {st}, {sum(found.values())} job URLs on {len(found)} hosts ({time.time() - t0:.0f}s)')
        if st != 200 or not found:
            break
        files.append(url)
        urls += sum(found.values())
        for tok, c in found.items():
            counts[tok] = counts.get(tok, 0) + c
    if not counts:
        log('no job URLs found; candidates unchanged')
        return 1
    prev = []
    if os.path.exists(args.out):
        with open(args.out) as f:
            prev = json.load(f).get('jazzhr', [])
    tokens = sorted(set(prev) | set(counts))  # a company missing from today's sitemaps may post again later
    out = {
        '_comment': 'JazzHR career pages (<company>.applytojob.com/apply, token = subdomain) from discover_jazzhr.py: the public '
                    'job sitemaps listed in every applytojob.com robots.txt (app.jazz.co/feeds/google/xml/N; robots.txt of '
                    'app.jazz.co read first). Committed so the nightly validate_boards.py --max-new works through them; valid '
                    'boards (robots.txt of the host allows /apply, the career page lists >= 1 job) go to boards.json.',
        '_source': {'sitemaps': files, 'fetched': time.strftime('%Y-%m-%d', time.gmtime()), 'job_urls': urls,
                    'hosts_in_sitemaps': len(counts)},
        'jazzhr': tokens,
    }
    with open(args.out, 'w') as f:
        f.write('{\n' + ',\n'.join(f'{json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}' for k, v in out.items() if k != 'jazzhr'))
        f.write(',\n"jazzhr": [\n' + ',\n'.join(json.dumps(t) for t in tokens) + '\n]\n}\n')
    log(f'{len(tokens)} candidates ({len(counts)} in today\'s sitemaps, {urls} job URLs) -> {args.out}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
