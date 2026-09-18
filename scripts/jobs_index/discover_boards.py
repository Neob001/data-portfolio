#!/usr/bin/env python3
"""Discover public ATS job-board identifiers from the Common Crawl URL index.

Zero-token, stdlib only. For each supported ATS host we list every URL Common Crawl captured
(latest 2 crawls by default; a host with no board pages there - jobs.lever.co in 2026 crawls, where
Common Crawl only fetched robots.txt - walks back to older crawls), take the first path segment (or the subdomain) as the board token,
normalize and dedupe.

Two access paths, tried in order per (crawl, host):
  1. The public CDX API (index.commoncrawl.org), paginated, with sleeps + retries.
  2. Direct zipnum reads of the same index on data.commoncrawl.org: binary-search cluster.idx
     with HTTP Range requests, then fetch only the compressed CDX blocks where the board token
     changes (a block whose first and next-block keys share a token holds only that token).
     This is what the CDX server does internally, and it keeps working when the server 504s.

Resumable: every finished (crawl, host) unit is checkpointed to state/discover/*.json and
skipped on re-run. Output: candidates.json ({ats: [token, ...]}, plus EU Lever tokens).

Usage:
  python3 discover_boards.py                 # latest 2 crawls, all hosts
  python3 discover_boards.py --crawls 1 --mode zipnum --ats lever,ashby
"""
from __future__ import annotations

import argparse
import gzip
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, 'state', 'discover')
OUT = os.path.join(HERE, 'candidates.json')
UA = 'factpipe-jobs-index/1.0 (board discovery; polite; contact via apify.com/factpipe)'
DATA = 'https://data.commoncrawl.org'
INDEX = 'https://index.commoncrawl.org'

# (ats, url pattern for the CDX API, SURT prefix for zipnum, token extractor kind, region)
HOSTS = [
    ('greenhouse', 'boards.greenhouse.io/*', 'io,greenhouse,boards)/', 'path', None),
    ('greenhouse', 'job-boards.greenhouse.io/*', 'io,greenhouse,job-boards)/', 'path', None),
    ('lever', 'jobs.lever.co/*', 'co,lever,jobs)/', 'path', None),
    ('lever', 'jobs.eu.lever.co/*', 'co,lever,eu,jobs)/', 'path', 'eu'),
    ('ashby', 'jobs.ashbyhq.com/*', 'com,ashbyhq,jobs)/', 'path', None),
    ('workable', 'apply.workable.com/*', 'com,workable,apply)/', 'path', None),
    ('recruitee', '*.recruitee.com', 'com,recruitee,', 'subdomain', None),
]

RESERVED = {
    'greenhouse': {'embed', 'v1', 'robots.txt', 'favicon.ico', 'static', 'assets', 'jobs', 'api', 'sitemap.xml',
                   'include', 'packs', 'job_board', 'boards', 'users', 'unsubscribe', 'privacy', 'eu', 'healthz'},
    'lever': {'robots.txt', 'favicon.ico', 'static', 'api', 'v0', 'assets', 'sitemap.xml', 'healthz', 'jobs'},
    'ashby': {'robots.txt', 'favicon.ico', 'api', 'static', 'assets', 'sitemap.xml', 'embed', '_next', 'posting-api'},
    'workable': {'j', 'api', 'robots.txt', 'favicon.ico', 'static', 'assets', 'sitemap.xml', 'careers', 'jobs',
                 'oauth', 'login', 'signup', 'workable', 'backend', 'recaptcha'},
    'recruitee': {'www', 'app', 'api', 'blog', 'support', 'help', 'careers', 'cdn', 's', 'status', 'docs',
                  'partners', 'marketplace', 'static', 'assets', 'mail', 'go', 'demo', 'staging', 'test'},
}
TOKEN_RX = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_.\- ]{0,99}$')


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, file=sys.stderr, flush=True)


def http_get(url, rng=None, retries=6, timeout=90):
    """GET with retries/backoff on 429/5xx/timeouts. rng=(start, end) inclusive byte range."""
    delay = 3
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, headers={'User-Agent': UA})
        if rng:
            req.add_header('Range', f'bytes={rng[0]}-{rng[1]}')
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (404,) and not rng:
                raise
            if attempt == retries or e.code not in (429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
            if attempt == retries:
                raise
        time.sleep(delay)
        delay = min(delay * 2, 60)
    raise RuntimeError('unreachable')


def extract_token(ats, kind, url):
    """Original-case URL -> board token or None."""
    try:
        p = urllib.parse.urlsplit(url if '://' in url else 'https://' + url)
    except ValueError:
        return None
    if kind == 'subdomain':
        host = (p.hostname or '').lower()
        parts = host.split('.')
        if len(parts) != 3 or parts[1:] != ['recruitee', 'com']:
            return None
        tok = parts[0]
    else:
        segs = [s for s in p.path.split('/') if s]
        if ats == 'greenhouse' and segs and segs[0] == 'embed':
            q = urllib.parse.parse_qs(p.query)
            tok = (q.get('for') or [None])[0]
        else:
            tok = urllib.parse.unquote(segs[0]) if segs else None
    if not tok:
        return None
    tok = tok.strip()
    if ats != 'ashby':
        tok = tok.lower() if ats in ('greenhouse', 'recruitee') else tok
    if tok.lower() in RESERVED[ats] or not TOKEN_RX.match(tok):
        return None
    return tok


def surt_token(surt_key, prefix, kind):
    """Token portion of a SURT key (lowercased) - used only to decide which blocks to fetch."""
    rest = surt_key[len(prefix):]
    if kind == 'subdomain':
        return rest.split(')', 1)[0].split(',', 1)[0]
    return rest.split('/', 1)[0].split('?', 1)[0]


# ---------------------------------------------------------------- CDX API path
def cdx_api(crawl, pattern, ats, kind, max_pages=None):
    base = f'{INDEX}/{crawl}-index'
    q = urllib.parse.urlencode({'url': pattern, 'output': 'json', 'showNumPages': 'true'})
    info = json.loads(http_get(f'{base}?{q}', retries=3, timeout=60))
    pages = int(info.get('pages', 0))
    log(f'  cdx api: {pages} pages for {pattern}')
    tokens = set()
    for page in range(pages if max_pages is None else min(pages, max_pages)):
        q = urllib.parse.urlencode({'url': pattern, 'output': 'json', 'fl': 'url', 'page': page})
        body = http_get(f'{base}?{q}', retries=4, timeout=120).decode('utf-8', 'replace')
        for line in body.splitlines():
            try:
                tok = extract_token(ats, kind, json.loads(line)['url'])
            except (ValueError, KeyError):
                continue
            if tok:
                tokens.add(tok)
        time.sleep(1.5)
    return tokens


# ------------------------------------------------------------- zipnum direct path
class RemoteLines:
    """Random access to lines of a sorted remote text file via Range requests."""

    def __init__(self, url):
        self.url = url
        for attempt in range(6):
            try:
                head = urllib.request.Request(url, method='HEAD', headers={'User-Agent': UA})
                with urllib.request.urlopen(head, timeout=60) as r:
                    self.size = int(r.headers['Content-Length'])
                return
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError):
                if attempt == 5:
                    raise
                time.sleep(5 * (attempt + 1))

    def line_at(self, off):
        """First complete line starting at or after byte off -> (line_start, line)."""
        chunk = http_get(self.url, (off, min(self.size - 1, off + 8191))).decode('utf-8', 'replace')
        if off > 0:
            nl = chunk.find('\n')
            if nl < 0:
                return self.size, None
            start, chunk = off + nl + 1, chunk[nl + 1:]
        else:
            start = 0
        end = chunk.find('\n')
        return start, (chunk if end < 0 else chunk[:end]) or None

    def lower_bound(self, key):
        """Byte offset of the last line whose key is < key (so its block may contain key)."""
        lo, hi = 0, self.size
        best = 0
        while hi - lo > 8192:
            mid = (lo + hi) // 2
            start, line = self.line_at(mid)
            if line is None or line.split(' ', 1)[0] >= key:
                hi = mid
            else:
                best, lo = start, mid
        return best

    def iter_from(self, off, chunk=262144):
        buf = ''
        while off < self.size:
            data = http_get(self.url, (off, min(self.size - 1, off + chunk - 1))).decode('utf-8', 'replace')
            off += chunk
            buf += data
            *lines, buf = buf.split('\n')
            yield from lines
        if buf:
            yield buf


def zipnum(crawl, prefix, ats, kind):
    idx = RemoteLines(f'{DATA}/cc-index/collections/{crawl}/indexes/cluster.idx')
    start = idx.lower_bound(prefix)
    blocks = []  # (first_key, file, offset, length)
    for line in idx.iter_from(start):
        parts = line.split('\t')
        if len(parts) < 4:
            continue
        key = parts[0].split(' ', 1)[0]
        blocks.append((key, parts[1], int(parts[2]), int(parts[3])))
        if key > prefix and not key.startswith(prefix):
            break
    # Keep blocks that overlap the prefix and contain a token boundary.
    want, skipped = [], []
    for i, (key, fn, off, ln) in enumerate(blocks[:-1]):
        nxt = blocks[i + 1][0]
        if nxt < prefix:
            continue
        if key.startswith(prefix) and nxt.startswith(prefix) and surt_token(key, prefix, kind) == surt_token(nxt, prefix, kind):
            skipped.append((surt_token(key, prefix, kind), (fn, off, ln)))  # one token only
            continue
        want.append((fn, off, ln))
    log(f'  zipnum: {len(blocks)} blocks in range, fetching {len(want)}')
    tokens = set()

    def read_block(fn, off, ln):
        raw = http_get(f'{DATA}/cc-index/collections/{crawl}/indexes/{fn}', (off, off + ln - 1))
        for line in gzip.decompress(raw).decode('utf-8', 'replace').splitlines():
            if not line.startswith(prefix):
                continue
            j = line.find('{')
            try:
                url = json.loads(line[j:])['url']
            except (ValueError, KeyError):
                continue
            tok = extract_token(ats, kind, url)
            if tok:
                tokens.add(tok)
        time.sleep(0.3)

    for n, blk in enumerate(want):
        read_block(*blk)
        if n % 25 == 24:
            log(f'    {n + 1}/{len(want)} blocks, {len(tokens)} tokens')
    # A token that fills whole blocks and starts exactly on a block boundary is not in any fetched
    # block; read one of its blocks to recover the original-case spelling.
    seen_lower, done = {t.lower() for t in tokens}, set()
    for tok, blk in skipped:
        if tok not in seen_lower and tok not in done:
            done.add(tok)
            read_block(*blk)
    return tokens


def latest_crawls(n):
    info = json.loads(http_get(f'{INDEX}/collinfo.json', retries=4, timeout=60))
    return [c['id'] for c in info[:n]]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--crawls', type=int, default=2, help='how many latest crawls to use')
    ap.add_argument('--crawl-ids', default='', help='comma list, overrides --crawls')
    ap.add_argument('--mode', choices=['auto', 'api', 'zipnum'], default='auto')
    ap.add_argument('--ats', default='', help='comma list to restrict')
    ap.add_argument('--walk-back', type=int, default=12,
                    help='for a host with 0 tokens in the chosen crawls, try up to N older crawls until one has pages '
                         '(recent crawls only fetched robots.txt on jobs.lever.co)')
    args = ap.parse_args()
    os.makedirs(STATE, exist_ok=True)
    crawls = [c for c in args.crawl_ids.split(',') if c] or latest_crawls(args.crawls)
    only = {a for a in args.ats.split(',') if a}
    t0 = time.time()
    units = [(crawl, h) for crawl in crawls for h in HOSTS if not only or h[0] in only]
    for crawl, host in units:
        run_unit(crawl, host, args.mode)
    if args.walk_back:
        older = [c for c in latest_crawls(len(crawls) + args.walk_back) if c not in crawls]
        for host in HOSTS:
            if only and host[0] not in only:
                continue
            if any(unit_tokens(c, host) for c in crawls):
                continue
            for crawl in older:
                log(f'{host[1]}: no board pages in {",".join(crawls)} - walking back to {crawl}')
                if run_unit(crawl, host, args.mode):
                    break
    merge(t0)


def unit_path(crawl, pattern):
    return os.path.join(STATE, f'{crawl}__{re.sub(r"[^a-z0-9]+", "_", pattern)}.json')


def unit_tokens(crawl, host):
    ck = unit_path(crawl, host[1])
    if not os.path.exists(ck):
        return 0
    with open(ck) as f:
        return len(json.load(f)['tokens'])


def run_unit(crawl, host, mode):
    """Discover one (crawl, host) unit unless checkpointed; returns its token count."""
    ats, pattern, prefix, kind, region = host
    ck = unit_path(crawl, pattern)
    if not os.path.exists(ck):
        log(f'{crawl} {pattern}')
        tokens, how = None, None
        if mode in ('auto', 'api'):
            try:
                tokens, how = cdx_api(crawl, pattern, ats, kind), 'cdx_api'
            except Exception as e:  # noqa: BLE001 - fall through to zipnum
                log(f'  cdx api failed ({e}); falling back to zipnum')
                if mode == 'api':
                    return 0
        if tokens is None:
            tokens, how = zipnum(crawl, prefix, ats, kind), 'zipnum'
        with open(ck, 'w') as f:
            json.dump({'crawl': crawl, 'pattern': pattern, 'ats': ats, 'region': region, 'via': how,
                       'tokens': sorted(tokens)}, f)
        log(f'  -> {len(tokens)} tokens via {how}')
    return unit_tokens(crawl, host)


def merge(t0):
    # Merge every checkpoint into candidates.json (case-insensitive dedupe, first spelling wins).
    merged = {}
    for fn in sorted(os.listdir(STATE)):
        if not fn.endswith('.json'):
            continue
        with open(os.path.join(STATE, fn)) as f:
            d = json.load(f)
        key = d['ats'] + (':' + d['region'] if d.get('region') else '')
        bucket = merged.setdefault(key, {})
        for t in d['tokens']:
            bucket.setdefault(t.lower(), t)
    out = {k: sorted(v.values(), key=str.lower) for k, v in sorted(merged.items())}
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    log('candidates:', {k: len(v) for k, v in out.items()}, f'({time.time() - t0:.0f}s)')


if __name__ == '__main__':
    main()
