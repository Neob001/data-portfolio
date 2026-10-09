#!/usr/bin/env python3
"""Generate / refresh the per-ATS jobs Actors (greenhouse-jobs-api, lever-jobs-api, ashby-jobs-api).

The three Actors are ONE family: the same shared jobs core (actors/ats-jobs-feed/src/core, copied by
scripts/sync_jobs_core.py) with the platform fixed. Everything in their directories except src/core/
and src/lib/ is written by this script from one template plus the small per-ATS dict in FAMILY, so a
fix is applied to all three by editing this file and rerunning it:

    python3 scripts/make_ats_actors.py            # write all three (then sync core + lib)
    python3 scripts/make_ats_actors.py --check    # exit 1 if a generated file is stale (no writes)

Derived from the multi-ATS model actor (actors/ats-jobs-scraper), so field names and semantics stay
identical for users switching between them:
  - INPUT_SCHEMA.json properties (minus `ats`, with per-platform descriptions and prefill)
  - the dataset field schema in .actor/actor.json
  - golden fixtures (the platform's own board + one other platform's board, for the "ignored" tests)

On a refresh, a README hero block (scripts/readme_hero.py markers) is kept, and registry.json entries
are only CREATED when missing (status "staging"); an existing entry is never overwritten, the script
just reports a listing that drifted from the generated actor.json.
"""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ACTORS = ROOT / "actors"
MODEL = ACTORS / "ats-jobs-scraper"

PRICE_USD = 0.002  # per delivered job (PPE event below), $2 per 1,000
EVENT = "job-result"  # same event as the core charges in feed.js emit()
DISCOUNT_TIERS = {"FREE": 0.002, "BRONZE": 0.0018, "SILVER": 0.0016, "GOLD": 0.0014}
CATEGORIES = ["JOBS", "LEAD_GENERATION"]
APPROVAL = "built 2026-10-09; publish pending owner approval (J4)"
PREFILL_MAX_RESULTS = 20
PREFILL_MAX_PER_COMPANY = 3
INDEX_DATE = "2026-10-09"  # coverage numbers below are from this index build

# ------------------------------------------------------------------ per-ATS config
FAMILY = {
    "greenhouse": {
        "slug": "greenhouse-jobs-api",
        "name": "Greenhouse",
        "title": "Greenhouse Jobs API — Search All Greenhouse Job Boards",
        "description": "Search open jobs on 3,600+ Greenhouse job boards (Stripe, Databricks, Anthropic…) by keyword, "
                       "location, remote and department, or fetch any Greenhouse board live. Full descriptions. "
                       "$2 per 1,000 jobs.",
        "seoTitle": "Greenhouse Jobs API: Greenhouse Job Board Scraper",
        "seoDescription": "Search every Greenhouse job board via the public Greenhouse API: keywords, locations, "
                          "remote, departments, full descriptions. $2 per 1,000 jobs.",
        "boards": 3698, "jobs": 148132,
        "examples": ["Stripe", "Databricks", "Anthropic", "Datadog", "Cloudflare", "GitLab"],
        "company_example": ["Stripe", "Datadog"],
        "token_example": ("Stripe", "stripe"),
        "url_examples": ["https://job-boards.greenhouse.io/gitlab", "https://boards.greenhouse.io/stripe"],
        "url_forms": [
            ("Board page", "`https://job-boards.greenhouse.io/gitlab`, `https://boards.greenhouse.io/gitlab`"),
            ("Embedded board", "`https://boards.greenhouse.io/embed/job_board?for=gitlab`"),
            ("API URL", "`https://boards-api.greenhouse.io/v1/boards/gitlab`"),
            ("Token", "`gitlab` or `greenhouse:gitlab`"),
        ],
        "token_hint": "`job-boards.greenhouse.io/`**`gitlab`**",
        "keywords": ["software engineer"],
        "prefill_story": "Greenhouse jobs for \"software engineer\" (backend, frontend, machine learning, platform…)",
        "api": ("Job Board API", "https://developers.greenhouse.io/job-board.html",
                "\"Job Board data is publicly available\"; no authentication for GET"),
        "api_host": "boards-api.greenhouse.io",
        "employment_note": "Greenhouse's job-board API does not state an employment type, so Greenhouse jobs have none and are excluded when this is set.",
        "fields_note": "Greenhouse's job-board API has no employment type or pay range, so `employment_type` and the `salary_*` fields are always `null` here. They are never guessed. `posted_at` is the job's first publication date.",
        "faq": [
            ("Why is there no salary or employment type on Greenhouse jobs?",
             "Greenhouse's public job-board API does not include pay ranges or employment types. We never extract or "
             "estimate them from free text. For pay data, [Lever Jobs API](https://apify.com/factpipe/lever-jobs-api) "
             "and [Ashby Jobs API](https://apify.com/factpipe/ashby-jobs-api) return the ranges employers publish."),
        ],
        "use_cases": [
            "**Greenhouse API without integration work**: one call returns jobs from thousands of Greenhouse boards in one flat schema, instead of polling `boards-api.greenhouse.io` board by board.",
            "**Greenhouse job board scraper for aggregators**: feed a niche job board with Greenhouse jobs filtered by keyword, location and department, refreshed daily with `sinceLastRun: true`.",
            "**Tracking specific companies**: `companies: [\"Stripe\", \"Datadog\"]`, scheduled daily, to see new Greenhouse openings as they appear.",
            "**Recruiting and sales intelligence**: who is hiring which team, and where. For one row per company, see [Companies Hiring](https://apify.com/factpipe/companies-hiring).",
        ],
        "view": ["title", "company_name", "department", "locations", "workplace_type", "posted_at", "job_url", "match_score"],
        "other_fixture": "lever",
        # Real row from a local prefill run, 2026-10-09 (descriptions shortened).
        "sample": {'job_id': 'greenhouse:coinbase:8174232',
         'title': 'Senior Software Engineer, Backend/Fullstack (Coinbase Advisor - Agentic Trading)',
         'company_name': 'Coinbase',
         'company_board': 'coinbase',
         'ats': 'greenhouse',
         'department': 'Engineering',
         'team': None,
         'employment_type': None,
         'workplace_type': 'remote',
         'locations': ['Remote - USA'],
         'country_codes': ['US'],
         'remote': True,
         'salary_min': None,
         'salary_max': None,
         'salary_currency': None,
         'salary_period': None,
         'posted_at': '2026-10-08T23:50:37.000Z',
         'updated_at': '2026-10-08T23:50:38.000Z',
         'apply_url': 'https://www.coinbase.com/careers/positions/8174232?gh_jid=8174232',
         'job_url': 'https://www.coinbase.com/careers/positions/8174232?gh_jid=8174232',
         'description_text': 'Ready to do the most impactful work of your career? At Coinbase, we…',
         'description_snippet': 'Ready to do the most impactful work of your career? At Coinbase, we are '
                                'uncompromising on our mission to increase economic freedom. The bar…',
         'description_status': 'included',
         'duplicate_sources': [],
         'match_score': 100,
         'matched_in': 'title',
         'source_url': 'https://boards-api.greenhouse.io/v1/boards/coinbase/jobs?content=true',
         'fetched_at': '2026-10-09T03:18:53.181Z'},
    },
    "lever": {
        "slug": "lever-jobs-api",
        "name": "Lever",
        "title": "Lever Jobs API — Search All Lever Job Postings",
        "description": "Search open jobs on 1,500+ Lever job boards (Palantir, Spotify, Zoox…) by keyword, location, "
                       "remote and department, or fetch any jobs.lever.co board live. Salary where published. "
                       "$2 per 1,000 jobs.",
        "seoTitle": "Lever Jobs API: Lever Postings API & Job Scraper",
        "seoDescription": "Search every Lever job board via the public Lever Postings API: keywords, locations, "
                          "remote, salary where published, full descriptions. $2 per 1,000 jobs.",
        "boards": 1574, "jobs": 50951,
        "examples": ["Palantir", "Spotify", "Zoox", "Shield AI", "Veeva", "Gopuff"],
        "company_example": ["Palantir", "Spotify"],
        "token_example": ("Palantir", "palantir"),
        "url_examples": ["https://jobs.lever.co/palantir", "https://jobs.lever.co/spotify"],
        "url_forms": [
            ("Board page", "`https://jobs.lever.co/palantir` (any page of the board)"),
            ("EU board", "`https://jobs.eu.lever.co/acme`"),
            ("API URL", "`https://api.lever.co/v0/postings/palantir`"),
            ("Token", "`palantir`, `lever:palantir` or `lever:eu:acme`"),
        ],
        "token_hint": "`jobs.lever.co/`**`palantir`**",
        "keywords": ["sales"],
        "prefill_story": "Lever jobs for \"sales\" (account executives, sales development, sales engineers…)",
        "api": ("Postings API", "https://github.com/lever/postings-api",
                "Published postings \"are publicly viewable\" and \"may be scraped by third parties\"; we respect its 1 request/s crawl delay"),
        "api_host": "api.lever.co",
        "employment_note": "Normalized from Lever's commitment field (Full-time, Part-time, Contract, Intern…). Jobs without one are excluded when this is set.",
        "fields_note": "`employment_type` comes from Lever's commitment field, `workplace_type` from its workplace setting, and the `salary_*` fields from the pay range the employer publishes on Lever (otherwise `null`, never guessed). `posted_at` is the posting's creation date; Lever has no update date, so `updated_at` is `null`.",
        "faq": [
            ("Are EU Lever boards (jobs.eu.lever.co) supported?",
             "Yes. EU boards are in the index like any other, and in live mode `https://jobs.eu.lever.co/<company>` or "
             "`lever:eu:<company>` reads Lever's EU API."),
            ("Why is a Lever run with full descriptions slower?",
             "Lever's API asks crawlers for one request per second, and we respect that. Full descriptions need one "
             "request per company, so 20 jobs from 7 companies add about 7 seconds. Set `includeDescription: false` "
             "if the 300-character snippet is enough."),
        ],
        "use_cases": [
            "**Lever postings API for every company at once**: one call searches thousands of Lever boards instead of calling `api.lever.co/v0/postings/<company>` one by one.",
            "**Lever jobs scraper for job boards**: Lever jobs filtered by keyword, location, remote and department, with salary ranges where the employer publishes them.",
            "**Tracking specific companies**: `companies: [\"Palantir\", \"Spotify\"]`, scheduled daily with `sinceLastRun: true`.",
            "**Sales and recruiting intelligence**: which teams companies on Lever are growing, and where. For one row per company, see [Companies Hiring](https://apify.com/factpipe/companies-hiring).",
        ],
        "view": ["title", "company_name", "locations", "workplace_type", "employment_type", "salary_min", "salary_max",
                 "salary_currency", "posted_at", "job_url", "match_score"],
        "other_fixture": "ashby",
        # Real row from a local prefill run, 2026-10-09 (descriptions shortened).
        "sample": {'job_id': 'lever:pointclickcare:5aaaf912-ca44-4ccf-a307-9178e6a152ab',
         'title': '(US) Sales Development Representative',
         'company_name': 'PointClickCare',
         'company_board': 'pointclickcare',
         'ats': 'lever',
         'department': 'Acute & Payer',
         'team': 'Sales',
         'employment_type': 'full_time',
         'workplace_type': 'remote',
         'locations': ['Remote, USA'],
         'country_codes': ['US'],
         'remote': True,
         'salary_min': 76000,
         'salary_max': 85000,
         'salary_currency': 'USD',
         'salary_period': 'year',
         'posted_at': '2026-10-08T15:01:24.432Z',
         'updated_at': None,
         'apply_url': 'https://jobs.lever.co/pointclickcare/5aaaf912-ca44-4ccf-a307-9178e6a152ab/apply',
         'job_url': 'https://jobs.lever.co/pointclickcare/5aaaf912-ca44-4ccf-a307-9178e6a152ab',
         'description_text': 'At PointClickCare our mission is simple: to help providers deliver…',
         'description_snippet': 'At PointClickCare our mission is simple: to help providers deliver exceptional care. '
                                'And that starts with our people. As a leading health…',
         'description_status': 'included',
         'duplicate_sources': [],
         'match_score': 100,
         'matched_in': 'title',
         'source_url': 'https://api.lever.co/v0/postings/pointclickcare?mode=json',
         'fetched_at': '2026-10-09T03:35:17.669Z'},
    },
    "ashby": {
        "slug": "ashby-jobs-api",
        "name": "Ashby",
        "title": "Ashby Jobs API — Search All Ashby Job Boards",
        "description": "Search open jobs on 2,700+ Ashby job boards (OpenAI, Ramp, Notion, Snowflake…) by keyword, "
                       "location, remote and department, or fetch any jobs.ashbyhq.com board live. Salary where "
                       "published. $2 per 1,000 jobs.",
        "seoTitle": "Ashby Jobs API: Ashby Job Board Scraper",
        "seoDescription": "Search every Ashby job board via Ashby's public posting API: keywords, locations, remote, "
                          "salary where published, full descriptions. $2 per 1,000 jobs.",
        "boards": 2790, "jobs": 54302,
        "examples": ["OpenAI", "Ramp", "Notion", "Snowflake", "Harvey", "Perplexity"],
        "company_example": ["OpenAI", "Ramp"],
        "token_example": ("Ramp", "ramp"),
        "url_examples": ["https://jobs.ashbyhq.com/ramp", "https://jobs.ashbyhq.com/notion"],
        "url_forms": [
            ("Board page", "`https://jobs.ashbyhq.com/ramp` (any page of the board)"),
            ("API URL", "`https://api.ashbyhq.com/posting-api/job-board/ramp`"),
            ("Token", "`ramp` or `ashby:ramp`"),
        ],
        "token_hint": "`jobs.ashbyhq.com/`**`ramp`**",
        "keywords": ["engineer"],
        "prefill_story": "Ashby jobs for \"engineer\", mostly at venture-backed startups",
        "api": ("Public Job Posting API", "https://developers.ashbyhq.com/docs/public-job-posting-api",
                "Public, unauthenticated posting API"),
        "api_host": "api.ashbyhq.com",
        "employment_note": "Normalized from Ashby's employment type (FullTime, PartTime, Contract, Intern, Temporary). Jobs without one are excluded when this is set.",
        "fields_note": "`employment_type`, `workplace_type` and `remote` come from Ashby's own fields, and the `salary_*` fields from the compensation the employer publishes on Ashby (otherwise `null`, never guessed). `posted_at` is the publication date; Ashby has no update date, so `updated_at` is `null`.",
        "faq": [
            ("Does it include Ashby salary ranges?",
             "Yes, where the employer publishes compensation on Ashby. The run requests Ashby's compensation data and "
             "maps the salary (or hourly) range to `salary_min`, `salary_max`, `salary_currency` and `salary_period`."),
        ],
        "use_cases": [
            "**Ashby jobs API across every company**: one call searches thousands of Ashby boards instead of calling the Ashby posting API company by company.",
            "**Ashby job board scraper for startup job boards**: Ashby is popular with venture-backed startups, so it is a strong source for startup and AI jobs, with salary ranges where published.",
            "**Tracking specific companies**: `companies: [\"OpenAI\", \"Ramp\"]`, scheduled daily with `sinceLastRun: true`.",
            "**Investor and sales intelligence**: which startups are hiring which teams, and where. For one row per company, see [Companies Hiring](https://apify.com/factpipe/companies-hiring).",
        ],
        "view": ["title", "company_name", "locations", "workplace_type", "employment_type", "salary_min", "salary_max",
                 "salary_currency", "posted_at", "job_url", "match_score"],
        "other_fixture": "greenhouse",
        # Real row from a local prefill run, 2026-10-09 (descriptions shortened).
        "sample": {'job_id': 'ashby:fal-ai:70031914-e873-451d-8d17-712bada15563',
         'title': 'Senior Software Engineer, Machine Learning Infrastructure & Automation',
         'company_name': 'fal',
         'company_board': 'fal-ai',
         'ats': 'ashby',
         'department': 'Engineering',
         'team': 'ML',
         'employment_type': 'full_time',
         'workplace_type': 'remote',
         'locations': ['Remote - USA'],
         'country_codes': ['US'],
         'remote': True,
         'salary_min': 170000,
         'salary_max': 230000,
         'salary_currency': 'USD',
         'salary_period': 'year',
         'posted_at': '2026-10-09T00:48:32.515Z',
         'updated_at': None,
         'apply_url': 'https://jobs.ashbyhq.com/fal-ai/70031914-e873-451d-8d17-712bada15563/application',
         'job_url': 'https://jobs.ashbyhq.com/fal-ai/70031914-e873-451d-8d17-712bada15563',
         'description_text': 'fal is the generative media ecosystem powering the next generation of…',
         'description_snippet': 'fal is the generative media ecosystem powering the next generation of AI products. We '
                                'build the infrastructure, tools, and model access…',
         'description_status': 'included',
         'duplicate_sources': [],
         'match_score': 100,
         'matched_in': 'title',
         'source_url': 'https://api.ashbyhq.com/posting-api/job-board/fal-ai?includeCompensation=true',
         'fetched_at': '2026-10-09T03:18:48.297Z'},
    },
}

# Golden fixtures of the model actor, by platform: (board token, file).
FIXTURES = {
    "greenhouse": ("gitlab", "greenhouse_jobs.json"),
    "lever": ("shieldai", "lever_postings.json"),
    "ashby": ("ramp", "ashby_jobs.json"),
}
ATS_NAMES = {"greenhouse": "Greenhouse", "lever": "Lever", "ashby": "Ashby", "workable": "Workable", "recruitee": "Recruitee"}
VIEW_LABELS = {"department": ("Department", "text"), "employment_type": ("Employment", "text")}


# ------------------------------------------------------------------ helpers
def render(text, **values):
    """Replace [[KEY]] tokens; fail on any token left unreplaced."""
    for k, v in values.items():
        text = text.replace(f"[[{k}]]", str(v))
    left = re.findall(r"\[\[[A-Z_]+\]\]", text)
    if left:
        raise ValueError(f"unreplaced template tokens: {sorted(set(left))}")
    return text


def jdump(obj):
    return json.dumps(obj, indent=2, ensure_ascii=False) + "\n"


def money(x):
    return f"${x:.2f}"


def others(platform):
    return [ATS_NAMES[a] for a in ATS_NAMES if a != platform]


def join_names(names):
    return ", ".join(names[:-1]) + " or " + names[-1]


def readme_sample(cfg):
    if cfg["sample"] is None:
        raise ValueError(f"{cfg['slug']}: no README sample row configured (run the prefill locally and paste one)")
    return json.dumps(cfg["sample"], indent=2, ensure_ascii=False)


# ------------------------------------------------------------------ file builders
def input_schema(platform, cfg):
    model = json.loads((MODEL / "INPUT_SCHEMA.json").read_text())
    props = model["properties"]
    expected = ["ats", "companies", "keywords", "keywordMatch", "keywordScope", "excludeKeywords", "locations", "remote",
                "postedWithinDays", "departments", "employmentTypes", "maxResults", "maxPerCompany", "includeDescription",
                "sinceLastRun", "companyUrls"]
    if list(props) != expected:
        raise ValueError(f"ats-jobs-scraper INPUT_SCHEMA properties changed: {list(props)} — update make_ats_actors.py")
    name = cfg["name"]
    out = {k: dict(v) for k, v in props.items() if k != "ats"}
    out["companies"]["description"] = (
        f"Optional: only these companies, by name (\"{cfg['token_example'][0]}\") or {name} board token "
        f"(\"{cfg['token_example'][1]}\"). Empty = every company with a {name} job board in the index.")
    out["keywords"]["prefill"] = cfg["keywords"]
    out["employmentTypes"]["description"] = cfg["employment_note"]
    out["maxResults"]["prefill"] = PREFILL_MAX_RESULTS
    out["maxPerCompany"]["prefill"] = PREFILL_MAX_PER_COMPANY
    out["companyUrls"]["title"] = f"Live mode: {name} board URLs or tokens"
    out["companyUrls"]["description"] = (
        f"Optional. Fetch these {name} boards live instead of searching the index, e.g. "
        f"{', '.join(cfg['url_examples'])} or just the board token \"{cfg['token_example'][1]}\". "
        f"URLs of other platforms ({join_names(others(platform))}) are ignored with a warning: use ats-jobs-scraper for those. "
        "All filters above still apply.")
    out["companyUrls"]["sectionCaption"] = f"Live mode ({name} boards not yet in the index)"
    return {"title": f"{name} Jobs API", "type": "object", "schemaVersion": 1, "properties": out}


def actor_json(platform, cfg):
    model = json.loads((MODEL / ".actor" / "actor.json").read_text())
    dataset = model["storages"]["dataset"]
    model_view = next(iter(dataset["views"].values()))
    labels = dict(model_view["display"]["properties"])
    for f, (label, fmt) in VIEW_LABELS.items():
        labels.setdefault(f, {"label": label, "format": fmt})
    for f in cfg["view"]:
        if f not in dataset["fields"]["properties"] or f not in labels:
            raise ValueError(f"view field {f} has no dataset field / label")
    return {
        "actorSpecification": 1,
        "name": cfg["slug"],
        "title": cfg["title"],
        "description": cfg["description"],
        "version": "0.1",
        "buildTag": "latest",
        "input": "../INPUT_SCHEMA.json",
        "readme": "../README.md",
        "dockerfile": "./Dockerfile",
        "outputSchema": "./output_schema.json",
        "categories": CATEGORIES,
        "storages": {
            "dataset": {
                "actorSpecification": 1,
                "views": {
                    "jobs": {
                        "title": f"{cfg['name']} jobs",
                        "transformation": {"fields": cfg["view"]},
                        "display": {"component": "table", "properties": {f: labels[f] for f in cfg["view"]}},
                    }
                },
                "fields": dataset["fields"],
            }
        },
    }


def output_schema(cfg):
    return {
        "actorOutputSchemaVersion": 1,
        "title": f"Output of {cfg['slug']}",
        "type": "object",
        "properties": {
            "resultsDatasetUrl": {"type": "string", "title": "Jobs", "template": "{{actorRun.defaultDatasetUrl}}?format=json&view=jobs"},
            "runSummary": {"type": "string", "title": "Run summary", "template": "{{actorRun.defaultKeyValueStoreUrl}}/records/RUN_SUMMARY"},
        },
    }


def package_json(cfg):
    return {
        "name": cfg["slug"],
        "version": "0.1.0",
        "type": "module",
        "description": f"Jobs from {cfg['name']} public job-board APIs: search the factpipe jobs index or fetch {cfg['name']} boards live. Generated by scripts/make_ats_actors.py.",
        "engines": {"node": ">=22"},
        "dependencies": {"apify": "^3.2.6"},
        "scripts": {"start": "node src/main.js", "test": "node --test 'tests/*.test.mjs'"},
    }


GENERATED_JS = "// Generated by scripts/make_ats_actors.py from one template for the per-ATS family — edit it there and rerun.\n"

MAIN_JS = GENERATED_JS + """import { log } from 'apify';
import { runJobsActor } from './core/actor_main.js';
import { toScraperOptions, noBoardsMessage, otherPlatformWarning } from './scraper.js';

await runJobsActor({
  slug: '[[SLUG]]',
  toOptions: (input) => {
    const opts = toScraperOptions(input);
    if (opts.otherPlatformRefs.length) log.warning(otherPlatformWarning(opts.otherPlatformRefs));
    return opts;
  },
  noBoardsMessage,
});
"""

SCRAPER_JS = GENERATED_JS + """// [[NAME]] Jobs API: input mapping onto the shared jobs core with the platform fixed. Pure, no I/O.
//  - search mode: every filter of ats-jobs-scraper, same field names; `ats` is always ['[[PLATFORM]]']
//    (an `ats` value in a copied ats-jobs-scraper input is ignored)
//  - live mode (`companyUrls`): only [[NAME]] board URLs / tokens are fetched; a bare token ("[[TOKEN]]")
//    means a [[NAME]] board. Board URLs of other platforms are ignored with a warning and reported in
//    badRefs, so a run with nothing usable left ends SUCCEEDED with noBoardsMessage() (core actor_main)
import { normalizeInput } from './core/filters.js';
import { parseBoardRef } from './core/transform.js';

export const PLATFORM = '[[PLATFORM]]';
export const PLATFORM_NAME = '[[NAME]]';
const OTHER_NAMES = '[[OTHER_NAMES]]';
const BARE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.%-]*$/;

const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : [])
  .map((x) => String(x ?? '').trim())
  .filter(Boolean);

export function toScraperOptions(input = {}) {
  const { ats: _ignored, companyUrls, boards, ...rest } = input ?? {};
  const keep = [];
  const otherPlatformRefs = [];
  for (const ref of [...strList(companyUrls), ...strList(boards)]) {
    const b = parseBoardRef(ref);
    if (b && b.ats !== PLATFORM) otherPlatformRefs.push(ref);
    else keep.push(!b && BARE_TOKEN.test(ref) ? `${PLATFORM}:${ref}` : ref);
  }
  const opts = normalizeInput({ ...rest, ats: [PLATFORM], companyUrls: keep });
  opts.otherPlatformRefs = otherPlatformRefs;
  if (otherPlatformRefs.length) {
    opts.badRefs = [...opts.badRefs, ...otherPlatformRefs];
    opts.mode = 'live';
  }
  return opts;
}

export function otherPlatformWarning(refs) {
  return `Ignored ${refs.length} board URL(s) of other platforms (${refs.slice(0, 5).join(', ')}${refs.length > 5 ? ', ...' : ''}): `
    + `this Actor reads [[NAME]] boards only. For ${OTHER_NAMES} boards use https://apify.com/factpipe/ats-jobs-scraper`;
}

/** Status message when live mode has no usable [[NAME]] board (passed to runJobsActor). */
export function noBoardsMessage(badRefs) {
  return `No [[NAME]] job-board URL in input (${badRefs.slice(0, 3).join(', ')}${badRefs.length > 3 ? ', ...' : ''}). `
    + 'This Actor reads [[NAME]] boards only, e.g. [[URL_EXAMPLE]] or the board token "[[TOKEN]]". '
    + `For ${OTHER_NAMES} boards use https://apify.com/factpipe/ats-jobs-scraper; for a company's own careers page use `
    + 'https://apify.com/factpipe/company-jobs-scraper';
}
"""

HELPERS_MJS = GENERATED_JS + """// Shared test helpers: fixtures, a fake ATS network, and the dataset-schema guard.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apiUrlFor } from '../src/core/transform.js';
import { fetchBoard } from '../src/core/feed.js';
import { IndexWriter } from '../src/core/index_writer.js';

export const load = (f) => JSON.parse(readFileSync(new URL(`../golden/${f}`, import.meta.url), 'utf8'));

// This Actor's platform plus one other platform (whose jobs must never come out of this Actor).
export const FIXTURES = [[FIXTURES]];
export const FIXTURE_BOARDS = Object.entries(FIXTURES).map(([ats, { token }]) => ({ ats, token }));

// Apify validates every pushed row against .actor/actor.json dataset fields (types AND enums); a
// violating row is rejected and the run crashes. Every row produced in tests goes through this.
const DATASET_FIELDS = JSON.parse(readFileSync(new URL('../.actor/actor.json', import.meta.url), 'utf8')).storages.dataset.fields.properties;
export function assertMatchesSchema(row) {
  for (const [key, value] of Object.entries(row)) {
    const spec = DATASET_FIELDS[key];
    assert.ok(spec, `field ${key} is not declared in .actor/actor.json`);
    const types = [].concat(spec.type);
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    const ok = types.includes(actual) || (actual === 'integer' && types.includes('number'));
    assert.ok(ok, `field ${key}=${JSON.stringify(value)} is ${actual}, schema allows ${types}`);
    // Apify validates enums like JSON Schema: null must itself be listed in the enum.
    if (spec.enum) assert.ok(spec.enum.includes(value), `field ${key}=${value} not in enum ${spec.enum}`);
    if (actual === 'array' && spec.items?.type) for (const v of value) assert.equal(typeof v, spec.items.type, `${key}[] item ${v}`);
  }
  for (const key of Object.keys(DATASET_FIELDS)) assert.ok(key in row, `row misses declared field ${key}`);
}

/** fetchJson stand-in serving golden fixtures by ATS API URL; records calls. */
export function fakeNetwork(extra = {}) {
  const routes = new Map();
  for (const [ats, { token, file }] of Object.entries(FIXTURES)) routes.set(apiUrlFor({ ats, token }), () => load(file));
  for (const [url, fn] of Object.entries(extra)) routes.set(url, fn);
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    const route = routes.get(url);
    if (!route) throw Object.assign(new Error(`HTTP 404 at ${url}`), { status: 404, failureClass: 'http_error' });
    return structuredClone(route());
  };
  const fetchText = async (url) => {
    calls.push(url);
    if (url.includes('lever.co/shieldai')) return '<html><head><title>Shield AI</title></head></html>';
    if (url.includes('ashbyhq.com/ramp')) return '<html><head><title>Ramp Jobs</title></head></html>';
    throw new Error('no page');
  };
  return { fetchJson, fetchText, calls };
}

/** pushData/charge recorder with the schema guard and an optional charge limit. */
export function sink({ chargeLimit = Infinity, event = 'job-result' } = {}) {
  const rows = [];
  let charges = 0;
  return {
    rows,
    get charges() { return charges; },
    pushData: async (row) => { assertMatchesSchema(row); rows.push(row); },
    charge: async ({ eventName }) => {
      assert.equal(eventName, event);
      charges += 1;
      return { eventChargeLimitReached: charges >= chargeLimit };
    },
  };
}

// Fixed clock: two days after the newest fixture posting.
export const NOW = Date.parse('2026-09-20T12:00:00Z');

/** Build a real index (same writer the builder uses) from the fixture boards into a temp dir. */
export async function buildIndex(dir, { builtAt = new Date(NOW - 86400000) } = {}) {
  const net = fakeNetwork();
  const writer = await new IndexWriter(dir, { builtAt }).open();
  for (const b of FIXTURE_BOARDS) {
    const r = await fetchBoard(b, { fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => builtAt });
    await writer.addBoard(b, r.company_name, r.jobs);
  }
  return writer.finish();
}
"""

PLATFORM_TEST = GENERATED_JS + """import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runFeed, streamShardLines } from '../src/core/feed.js';
import { toScraperOptions, noBoardsMessage, otherPlatformWarning, PLATFORM } from '../src/scraper.js';
import { fakeNetwork, sink, NOW, buildIndex, assertMatchesSchema, FIXTURES, load } from './helpers.mjs';

const OWN = FIXTURES[PLATFORM];
const OTHER = '[[OTHER]]';

async function run(input, { dir } = {}) {
  const out = sink();
  const net = fakeNetwork();
  const read = [];
  const summary = await runFeed(toScraperOptions(input), {
    ...out, indexBaseUrl: dir ? pathToFileURL(dir).href : undefined, now: () => NOW, hostGaps: {},
    fetchJson: net.fetchJson, fetchText: net.fetchText,
    streamShardLines: (base, rel) => { read.push(rel); return streamShardLines(base, rel); },
  });
  return { summary, rows: out.rows, charges: out.charges, calls: net.calls, read };
}

test('options: platform is forced, whatever `ats` says', () => {
  for (const ats of [undefined, [], ['[[OTHER]]'], ['greenhouse', 'lever', 'ashby', 'workable', 'recruitee'], 'workable']) {
    const o = toScraperOptions({ ats, keywords: ['engineer'] });
    assert.deepEqual([o.mode, o.ats, o.keywords], ['search', [PLATFORM], ['engineer']], JSON.stringify(ats));
  }
  assert.deepEqual(toScraperOptions({}).ats, [PLATFORM]);
  assert.deepEqual(toScraperOptions(undefined).ats, [PLATFORM]);
});

test('options: same filters and defaults as ats-jobs-scraper', () => {
  const o = toScraperOptions({ keywords: 'a, b', locations: ['US'], remote: 'remote_only', postedWithinDays: 7, departments: ['eng'],
    employmentTypes: ['full_time'], companies: ['x'], excludeKeywords: ['senior'], maxPerCompany: 2, sinceLastRun: true,
    keywordMatch: 'all', keywordScope: 'title', includeDescription: false, maxResults: 5 });
  assert.deepEqual([o.keywords, o.locations, o.remote, o.postedWithinDays, o.departments, o.employmentTypes, o.companies, o.excludeKeywords],
    [['a', 'b'], ['US'], 'remote_only', 7, ['eng'], ['full_time'], ['x'], ['senior']]);
  assert.deepEqual([o.maxPerCompany, o.sinceLastRun, o.keywordMatch, o.keywordScope, o.includeDescription, o.maxResults], [2, true, 'all', 'title', false, 5]);
  const d = toScraperOptions({});
  assert.deepEqual([d.maxResults, d.includeDescription, d.remote, d.keywordScope, d.keywordMatch], [100, true, 'any', 'title_and_description', 'any']);
  assert.throws(() => toScraperOptions({ remote: 'mars' }), /remote/);
});

test('options: other-platform board URLs are dropped (with a warning), own URLs and bare tokens kept', () => {
  const own = '[[URL_EXAMPLE]]';
  const foreign = ['[[FOREIGN_URL]]', 'workable:acme', 'https://acme.recruitee.com'];
  const o = toScraperOptions({ companyUrls: [own, ...foreign, '[[TOKEN]]', 'https://www.example.com/careers'] });
  assert.equal(o.mode, 'live');
  assert.ok(o.boards.every((b) => b.ats === PLATFORM), JSON.stringify(o.boards));
  assert.deepEqual(o.boards.map((b) => b.token.toLowerCase()), ['[[URL_TOKEN]]', '[[TOKEN]]'].filter((t, i, a) => a.indexOf(t) === i));
  assert.deepEqual(o.otherPlatformRefs, foreign);
  assert.deepEqual(o.badRefs, ['https://www.example.com/careers', ...foreign]);
  assert.match(otherPlatformWarning(o.otherPlatformRefs), /^Ignored 3 board URL\\(s\\) of other platforms[\\s\\S]*[[NAME]] boards only[\\s\\S]*ats-jobs-scraper/);
});

test('options: only other-platform URLs -> live mode with no boards (core exits SUCCEEDED with noBoardsMessage)', () => {
  const o = toScraperOptions({ companyUrls: ['[[FOREIGN_URL]]'] });
  assert.equal(o.mode, 'live');
  assert.deepEqual(o.boards, []);
  assert.deepEqual(o.badRefs, ['[[FOREIGN_URL]]']);
  const msg = noBoardsMessage(o.badRefs);
  assert.match(msg, /^No [[NAME]] job-board URL in input \\(/);
  assert.ok(msg.includes('https://apify.com/factpipe/ats-jobs-scraper'), msg);
  assert.ok(msg.length < 400, `status message ${msg.length} chars`);
});

test('search mode: only [[NAME]] jobs, other-platform shards never downloaded, rows match the dataset schema', async () => {
  const dir = await mkdtemp(join(tmpdir(), '[[SLUG]]-index-'));
  try {
    await buildIndex(dir);
    const r = await run({ ats: [OTHER], includeDescription: false }, { dir });
    assert.ok(r.rows.length > 0);
    assert.deepEqual(new Set(r.rows.map((x) => x.ats)), new Set([PLATFORM]));
    assert.ok(r.read.length > 0 && r.read.every((f) => f.includes(`/${PLATFORM}-`)), r.read.join(','));
    for (const x of r.rows) assertMatchesSchema(x);
    assert.equal(r.charges, r.rows.length, 'one job-result per delivered job');
    assert.equal(r.summary.mode, 'search');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('search mode: maxResults caps delivery and charging', async () => {
  const dir = await mkdtemp(join(tmpdir(), '[[SLUG]]-index-'));
  try {
    await buildIndex(dir);
    const r = await run({ maxResults: 1, includeDescription: false }, { dir });
    assert.equal(r.rows.length, 1);
    assert.equal(r.charges, 1);
    assert.equal(r.summary.stop_reason, 'max_results');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('live mode: own board fetched, other-platform board ignored (never requested)', async () => {
  const r = await run({ companyUrls: [`${PLATFORM}:${OWN.token}`, `${OTHER}:${FIXTURES[OTHER].token}`] });
  assert.equal(r.summary.mode, 'live');
  assert.ok(r.rows.length > 0);
  assert.ok(r.rows.every((x) => x.ats === PLATFORM && x.company_board.toLowerCase() === OWN.token));
  assert.ok(r.rows.every((x) => x.description_status === 'included'));
  for (const x of r.rows) assertMatchesSchema(x);
  assert.equal(r.charges, r.rows.length);
  assert.ok(!r.calls.some((u) => u.includes(FIXTURES[OTHER].token)), r.calls.join(','));
});

test('golden fixture of this platform parses into schema-valid rows', async () => {
  assert.ok(load(OWN.file));
  const r = await run({ companyUrls: [OWN.token], includeDescription: false });
  assert.ok(r.rows.length > 0);
  for (const x of r.rows) assertMatchesSchema(x);
  assert.ok(r.rows.every((x) => x.description_status === 'not_requested'));
});
"""

METADATA_TEST = GENERATED_JS + """import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { OUTPUT_FIELDS } from '../src/core/feed.js';
import { toScraperOptions, PLATFORM, PLATFORM_NAME } from '../src/scraper.js';

const SLUG = '[[SLUG]]';
const FAMILY = ['greenhouse-jobs-api', 'lever-jobs-api', 'ashby-jobs-api'];
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const readRepo = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');
const actor = JSON.parse(read('.actor/actor.json'));
const schema = JSON.parse(read('INPUT_SCHEMA.json'));
const PRICE = '$2 per 1,000 jobs';

test('actor.json: Store limits, platform name first, categories, price mention', () => {
  assert.equal(actor.name, SLUG);
  assert.ok(actor.title.length <= 60, `title ${actor.title.length} chars`);
  assert.ok(actor.title.startsWith(`${PLATFORM_NAME} `), actor.title);
  assert.ok(actor.description.length <= 220, `description ${actor.description.length} chars`);
  assert.ok(actor.description.includes(PRICE), actor.description);
  assert.deepEqual(actor.categories, ['JOBS', 'LEAD_GENERATION']);
});

test('dataset schema declares exactly the fields the Actor outputs (same as ats-jobs-scraper)', () => {
  assert.deepEqual(Object.keys(actor.storages.dataset.fields.properties), OUTPUT_FIELDS);
  for (const f of actor.storages.dataset.views.jobs.transformation.fields) assert.ok(OUTPUT_FIELDS.includes(f), f);
  for (const f of Object.keys(actor.storages.dataset.views.jobs.display.properties)) assert.ok(actor.storages.dataset.views.jobs.transformation.fields.includes(f), f);
  const model = JSON.parse(readRepo('actors/ats-jobs-scraper/.actor/actor.json'));
  assert.deepEqual(actor.storages.dataset.fields, model.storages.dataset.fields);
});

test('output schema has no resourceType; Dockerfile uses apify/actor-node:22', () => {
  assert.ok(!read('.actor/output_schema.json').includes('resourceType'));
  assert.match(read('.actor/Dockerfile'), /^FROM apify\\/actor-node:22$/m);
});

test('src/lib is the synced shared copy; src/core is the synced ats-jobs-feed core (scripts/sync_jobs_core.py)', () => {
  for (const f of readdirSync(new URL('../../../shared/js/', import.meta.url)).filter((x) => x.endsWith('.js'))) {
    assert.equal(read(`src/lib/${f}`), readRepo(`shared/js/${f}`), `lib/${f} drifted: run python3 scripts/sync_shared.py`);
  }
  const src = new URL('../../ats-jobs-feed/src/core/', import.meta.url);
  const files = readdirSync(src).filter((f) => f.endsWith('.js')).sort();
  assert.deepEqual(readdirSync(new URL('../src/core/', import.meta.url)).filter((f) => f.endsWith('.js')).sort(), files);
  for (const f of files) assert.equal(read(`src/core/${f}`), readFileSync(new URL(f, src), 'utf8'), `core/${f} drifted: run python3 scripts/sync_jobs_core.py`);
});

test('input schema: no `ats`, same fields as ats-jobs-scraper otherwise, prefill accepted', () => {
  const model = JSON.parse(readRepo('actors/ats-jobs-scraper/INPUT_SCHEMA.json'));
  assert.ok(!('ats' in schema.properties));
  assert.deepEqual(Object.keys(schema.properties), Object.keys(model.properties).filter((k) => k !== 'ats'));
  for (const [k, p] of Object.entries(schema.properties)) {
    for (const attr of ['type', 'editor', 'enum', 'default', 'minimum', 'maximum', 'items']) assert.deepEqual(p[attr], model.properties[k][attr], `${k}.${attr}`);
  }
  const prefill = Object.fromEntries(Object.entries(schema.properties).filter(([, p]) => 'prefill' in p).map(([k, p]) => [k, p.prefill]));
  assert.deepEqual(prefill, { keywords: [[KEYWORDS]], maxResults: 20, maxPerCompany: 3 });
  const o = toScraperOptions(prefill);
  assert.deepEqual([o.mode, o.ats, o.maxResults, o.maxPerCompany, o.includeDescription], ['search', [PLATFORM], 20, 3, true]);
});

test('PPE: one job-result per delivered job (the event the core charges), $2 per 1,000 in registry', () => {
  assert.match(read('src/core/feed.js'), /deps\\.charge\\(\\{ eventName: 'job-result' \\}\\)/);
  const reg = JSON.parse(readRepo('registry.json')).actors[SLUG];
  assert.ok(reg, 'registry.json entry');
  assert.deepEqual(Object.keys(reg.ppe_events), ['job-result']);
  assert.equal(reg.ppe_events['job-result'].proposed_price_usd, 0.002);
  assert.deepEqual(reg.ppe_events['job-result'].store_discount_tiers_usd, { FREE: 0.002, BRONZE: 0.0018, SILVER: 0.0016, GOLD: 0.0014 });
  assert.equal(reg.listing.title, actor.title);
  assert.equal(reg.listing.description, actor.description);
  assert.ok(reg.listing.seoTitle.length <= 60 && reg.listing.seoDescription.length <= 160);
  assert.deepEqual(reg.listing.categories, actor.categories);
});

test('README: price, quick start cost, search keywords', () => {
  const md = read('README.md');
  assert.ok(md.startsWith(`# ${actor.title}\\n`));
  assert.ok(md.includes(`**${PRICE}**`));
  assert.match(md, /## Quick start[\\s\\S]*\\$0\\.04 \\(20 jobs × \\$0\\.002\\)/);
  assert.match(md, /\\| `job-result` \\| \\*\\*\\$2\\.00 per 1,000\\*\\* \\(\\$0\\.002 each\\)/);
  for (const k of [[README_KEYWORDS]]) assert.ok(md.includes(k), k);
  assert.ok(!/\\n\\| `ats` \\|/.test(md), 'README documents no `ats` input');
});

test('README: sections in order, related Actors before FAQ incl. the other per-ATS Actors, sample JSON parses', () => {
  const md = read('README.md');
  const at = (h) => md.indexOf(`\\n## ${h}\\n`);
  const order = ['Quick start', 'What you get', 'Use cases', 'Input', 'Pricing (pay per event)', 'factpipe Jobs Data', 'FAQ'].map(at);
  assert.ok(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1])), JSON.stringify(order));
  const suite = md.slice(at('factpipe Jobs Data'), at('FAQ'));
  for (const s of ['ats-jobs-feed', 'ats-jobs-scraper', 'remote-jobs-feed', 'companies-hiring', ...FAMILY]) assert.ok(suite.includes(`https://apify.com/factpipe/${s})`), s);
  assert.match(suite, new RegExp(`apify\\\\.com/factpipe/${SLUG}\\\\)[^\\\\n]*\\\\(this Actor\\\\)`));
  assert.match(md, /\\*\\*Switching from ats-jobs-scraper or other [[NAME]] scrapers\\?\\*\\*/);
  const sample = JSON.parse(md.match(/## What you get[\\s\\S]*?```json\\n([\\s\\S]*?)\\n```/)[1]);
  assert.deepEqual(Object.keys(sample), OUTPUT_FIELDS);
  assert.equal(sample.ats, PLATFORM);
});
"""

README_MD = """# [[TITLE]]

A **[[NAME]] jobs API** and **[[NAME]] job board scraper** in one: search every open job on **[[BOARDS]] [[NAME]] company job boards** ([[EXAMPLES]]…) by keyword, location, remote, department and posting date, and get flat, deduplicated JSON: title, department, locations, country codes, remote flag, [[SALARY_PHRASE]]apply link and full description. Paste any [[NAME]] board URL ("[[URL_EXAMPLE]]") to fetch it live. **$2 per 1,000 jobs**, and you pay only for the jobs you get.

## Quick start

1. Click **Start** with the prefilled input: `keywords: [[KEYWORDS_JSON]]`, `maxResults: 20`, `maxPerCompany: 3`. The run usually takes under a minute.
2. You get the 20 most relevant [[PREFILL_STORY]], at most 3 per company: jobs with the keyword in the title come first, newest first among equals.
3. That first run costs at most **$0.04 (20 jobs × $0.002)**, which fits in Apify's free monthly credit. Then name the companies you track (`companies: [[COMPANY_EXAMPLE_JSON]]`), add `locations` or `remote`, or paste board URLs in `companyUrls`.

## What you get

One flat record per job opening, from a real run:

```json
[[SAMPLE]]
```

- [[FIELDS_NOTE]]
- `match_score` (0–100) and `matched_in` (`title`, `department`, `description`) explain keyword matches. Both are `null` without keywords.
- `duplicate_sources` lists other `job_id`s of the same opening (for example a company with two boards). Each opening is delivered and charged once.
- **No personal data.** Recruiter and hiring-manager fields are never copied, and contact details in descriptions are replaced with `[… redacted]`.

## Use cases

[[USE_CASES]]

## Input

| Field | Type | Notes |
|---|---|---|
| `keywords` | string[] | Case-insensitive. Title matches rank first, then department/team, then description (first ~1,500 characters) |
| `keywordMatch` | `any` \\| `all` | Default `any` |
| `keywordScope` | `title` \\| `title_and_description` | Default `title_and_description` |
| `companies` | string[] | Company names (`[[TOKEN_NAME]]`) or [[NAME]] board tokens (`[[TOKEN]]`). Empty = every [[NAME]] company in the index |
| `excludeKeywords` | string[] | Drops jobs whose title contains any of them |
| `locations` | string[] | Location text as written in the posting, or an ISO country code (`US`, `DE`) |
| `remote` | `any` \\| `remote_only` \\| `onsite_only` | Default `any` |
| `postedWithinDays` | integer | First published within the last N days |
| `departments` | string[] | Substring match on department or team |
| `employmentTypes` | string[] | `full_time`, `part_time`, `contract`, `temporary`, `internship`, `other`. [[EMPLOYMENT_NOTE]] |
| `maxResults` | integer | Default 100 |
| `maxPerCompany` | integer | Optional cap on jobs from any one company (prefill 3), so a single employer posting many near-identical roles can't fill your results |
| `includeDescription` | boolean | Default `true`: full description fetched live from [[NAME]] for each delivered job |
| `sinceLastRun` | boolean | Only jobs not delivered by an earlier run with the same filters |
| `companyUrls` | string[] | **Live mode**: [[NAME]] board URLs or tokens, fetched directly from [[NAME]]. URLs of other platforms are ignored with a warning |

**[[NAME]] board references accepted in live mode:**

| Form | Example |
|---|---|
[[URL_FORMS]]

**How it works.** Without `companyUrls`, the Actor searches a compact search index of every [[NAME]] board in our directory, rebuilt daily from [[NAME]]'s public API, and downloads only the [[NAME]] parts of it for your date range. With keywords, it ranks every matching job before delivering the top `maxResults`. For each delivered job it then fetches the full description live from [[NAME]] (one API call per company), which also drops jobs closed since the nightly build (not delivered, not charged).

## Pricing (pay per event)

| Event | Price | Meaning |
|---|---|---|
| `job-result` | **$2.00 per 1,000** ($0.002 each) | One job delivered. **No start fee.** Runs with no matches, jobs skipped by `sinceLastRun`, jobs found closed and failed boards are never charged. |

Set a maximum charge per run in Apify, and the Actor stops cleanly when it is reached.

## Coverage

Search-index build of [[INDEX_DATE]]: **[[JOBS]] open jobs** on **[[BOARDS]] [[NAME]] company job boards**, including [[EXAMPLES]].

Boards were discovered from Common Crawl's public URL index and validated against [[NAME]]'s API. Every indexed board had at least one open job when last checked. A company that isn't indexed yet works in live mode through `companyUrls`.

## Sources and terms

Only [[NAME]]'s official, public, unauthenticated [[[API_NAME]]]([[API_URL]]), which [[NAME]] publishes for displaying and syndicating open jobs: [[API_TERMS]]. No career-site HTML scraping, no logins, no LinkedIn or Indeed.

## factpipe Jobs Data

All of these Actors search the same daily index of open jobs from 10,000+ company job boards:

- [Jobs Feed API](https://apify.com/factpipe/ats-jobs-feed): every job from every platform, every filter, ranked by relevance.
- [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper): pick several applicant tracking systems (also Workable and Recruitee) in one run.
- [Remote Jobs API](https://apify.com/factpipe/remote-jobs-feed): remote and work-from-home jobs only, filtered by region or time zone.
- [Companies Hiring](https://apify.com/factpipe/companies-hiring): one row per company that is hiring for a role, as sales leads or market research.
[[FAMILY_LINKS]]

## FAQ

**Do I need [[A_NAME]] account or API key?**
No. This is the public job-board API that powers each company's [[NAME]] careers page. No key, no login.

**How do I find a company's board token?**
It is the last part of the careers-page URL: [[TOKEN_HINT]]. Or just type the company name in `companies`.

**How fresh is the data?**
The index is rebuilt daily. With `includeDescription` on (the default), every delivered job is re-checked live against [[NAME]] during your run. Live mode (`companyUrls`) always reads [[NAME]] directly.

[[FAQ]]

**What happens to [[OTHER_NAMES]] URLs?**
They are ignored with a warning in the log, and the rest of the run goes ahead. If no [[NAME]] board is left, the run ends successfully with a message and nothing is charged. For several platforms in one run, use [Greenhouse, Lever & Ashby Jobs Scraper](https://apify.com/factpipe/ats-jobs-scraper).

**Switching from ats-jobs-scraper or other [[NAME]] scrapers?**
Inputs from [ats-jobs-scraper](https://apify.com/factpipe/ats-jobs-scraper) work as they are: the same fields minus `ats` (ignored if present, the platform is always [[NAME]]), and the same output records. Only `companyUrls` of other platforms are skipped. From other tools, this field map covers the usual settings:

| You want | Use here |
|---|---|
| Company name, board token or board URL | `companies` (index) or `companyUrls` (live) |
| Job title / search query | `keywords` (+ `keywordScope: "title"` for titles only) |
| Location or country | `locations` (text or ISO code) |
| Remote only | `remote: "remote_only"` |
| Date posted | `postedWithinDays` |
| Result limit | `maxResults` |
| Job description | `includeDescription` → `description_text` |
| Job id / URL / apply link | `job_id` / `job_url` / `apply_url` |
| Company / location / date | `company_name` / `locations` / `posted_at` |

**Can I call it from Python, JavaScript, Make, Zapier or an AI agent?**
Yes, through the Apify API, the official clients, Apify integrations (Make, Zapier, n8n, Google Sheets, Slack) or the Apify MCP server.

## Reliability

Official [[NAME]] API only. Retries with backoff, per-host rate limits[[RATE_NOTE]], a `RUN_SUMMARY` record on every run, and a built-in live fallback if the search index is ever unreachable.
"""

FAMILY_LINK_TEXT = {
    "greenhouse": "every Greenhouse job board in one search.",
    "lever": "every Lever job board, with salary where published.",
    "ashby": "every Ashby job board: startup and AI jobs, with salary where published.",
}


def readme(platform, cfg):
    name = cfg["name"]
    fam = []
    for p, c in FAMILY.items():
        label = c["title"].split(" — ")[0]
        this = " (this Actor)" if p == platform else ""
        fam.append(f"- [{label}](https://apify.com/factpipe/{c['slug']}){this}: {FAMILY_LINK_TEXT[p]}")
    faq = "\n\n".join(f"**{q}**\n{a}" for q, a in cfg["faq"])
    return render(
        README_MD,
        TITLE=cfg["title"], NAME=name, A_NAME=("an " if name[0] in "AEIOU" else "a ") + name, BOARDS=f"{cfg['boards']:,}", JOBS=f"{cfg['jobs']:,}",
        EXAMPLES=", ".join(cfg["examples"]), URL_EXAMPLE=cfg["url_examples"][0],
        SALARY_PHRASE="" if platform == "greenhouse" else "salary range (where the employer publishes one), employment type, ",
        KEYWORDS_JSON=json.dumps(cfg["keywords"]), PREFILL_STORY=cfg["prefill_story"],
        COMPANY_EXAMPLE_JSON=json.dumps(cfg["company_example"]),
        SAMPLE=readme_sample(cfg), FIELDS_NOTE=cfg["fields_note"],
        USE_CASES="\n".join(f"- {u}" for u in cfg["use_cases"]),
        TOKEN_NAME=cfg["token_example"][0], TOKEN=cfg["token_example"][1], EMPLOYMENT_NOTE=cfg["employment_note"],
        URL_FORMS="\n".join(f"| {a} | {b} |" for a, b in cfg["url_forms"]),
        INDEX_DATE=INDEX_DATE, API_NAME=cfg["api"][0], API_URL=cfg["api"][1], API_TERMS=cfg["api"][2],
        FAMILY_LINKS="\n".join(fam), TOKEN_HINT=cfg["token_hint"], FAQ=faq,
        OTHER_NAMES=join_names(others(platform)),
        RATE_NOTE=" (Lever 1 request/s)" if platform == "lever" else "",
    )


def preserve_hero(old, new):
    """Keep a hero block that scripts/readme_hero.py inserted under the H1 of an existing README."""
    start, end = "<!-- factpipe:hero:start -->", "<!-- factpipe:hero:end -->"
    m = re.search(re.escape(start) + r".*?" + re.escape(end), old or "", flags=re.S)
    if not m:
        return new
    h1_end = new.index("\n") + 1
    return new[:h1_end] + "\n" + m.group(0) + "\n" + new[h1_end:]


def files_for(platform, cfg):
    other = cfg["other_fixture"]
    fixtures = {p: FIXTURES[p] for p in (platform, other)}
    fixtures_js = "{\n" + "".join(f"  {p}: {{ token: '{t}', file: '{f}' }},\n" for p, (t, f) in fixtures.items()) + "}"
    foreign_url = {"greenhouse": "https://job-boards.greenhouse.io/gitlab", "lever": "https://jobs.lever.co/shieldai",
                   "ashby": "https://jobs.ashbyhq.com/ramp"}[other]
    url_token = cfg["url_examples"][0].rstrip("/").rsplit("/", 1)[1].lower()
    readme_keywords = {
        "greenhouse": ["Greenhouse API", "Greenhouse job board scraper", "Greenhouse jobs API"],
        "lever": ["Lever postings API", "Lever jobs scraper", "Lever jobs API"],
        "ashby": ["Ashby jobs API", "Ashby job board scraper", "Ashby posting API"],
    }[platform]
    tokens = dict(
        SLUG=cfg["slug"], NAME=cfg["name"], PLATFORM=platform, OTHER=other, TOKEN=cfg["token_example"][1],
        URL_EXAMPLE=cfg["url_examples"][0], URL_TOKEN=url_token, FOREIGN_URL=foreign_url, FIXTURES=fixtures_js,
        OTHER_NAMES=join_names(others(platform)), KEYWORDS="[" + ", ".join(json.dumps(k) for k in cfg["keywords"]).replace('"', "'") + "]",
        README_KEYWORDS="[" + ", ".join(json.dumps(k) for k in readme_keywords).replace('"', "'") + "]",
    )
    out = {
        "package.json": jdump(package_json(cfg)),
        "INPUT_SCHEMA.json": jdump(input_schema(platform, cfg)),
        ".actor/actor.json": jdump(actor_json(platform, cfg)),
        ".actor/output_schema.json": jdump(output_schema(cfg)),
        ".actor/Dockerfile": (MODEL / ".actor" / "Dockerfile").read_text(),
        ".dockerignore": (MODEL / ".dockerignore").read_text(),
        "src/main.js": render(MAIN_JS, **tokens),
        "src/scraper.js": render(SCRAPER_JS, **tokens),
        "tests/helpers.mjs": render(HELPERS_MJS, **tokens),
        "tests/platform.test.mjs": render(PLATFORM_TEST, **tokens),
        "tests/metadata.test.mjs": render(METADATA_TEST, **tokens),
        "README.md": readme(platform, cfg),
    }
    for p, (_, f) in fixtures.items():
        out[f"golden/{f}"] = (MODEL / "golden" / f).read_text()
    return out


def registry_entry(cfg):
    return {
        "apify_actor_id": None,
        "source": "factpipe jobs index (GitHub release jobs-index; public ATS job-board APIs)",
        "variant": f"search index ({cfg['name']} only)",
        "status": "staging",
        "approval": APPROVAL,
        "origin": "scan",
        "incumbent_actor_id": None,
        "first_paid_run_date": None,
        "ppe_events": {
            EVENT: {
                "proposed_price_usd": PRICE_USD,
                "title": "Job result",
                "description": "One job posting delivered. Nothing else is charged.",
                "store_discount_tiers_usd": DISCOUNT_TIERS,
            }
        },
        "pricing_rationale": "Per-ATS Store searches (state/ats_demand_2026-10-09.txt): dedicated per-ATS leaders "
                             "$2-2.5/1k with 72-130 users30; multi-ATS leader $1.5/1k. Same index as ats-jobs-scraper; "
                             "$2/1k (owner J4 brief).",
        "launched_at": None,
        "last_fix_date": None,
        "kpis": {},
        "listing": {
            "title": cfg["title"],
            "description": cfg["description"],
            "seoTitle": cfg["seoTitle"],
            "seoDescription": cfg["seoDescription"],
            "categories": CATEGORIES,
        },
        "staging_validated": False,
        "monetization_configured": False,
    }


def validate(cfg):
    errs = []
    if len(cfg["title"]) > 60:
        errs.append(f"title {len(cfg['title'])} > 60")
    if len(cfg["description"]) > 220:
        errs.append(f"description {len(cfg['description'])} > 220")
    if "$2 per 1,000 jobs" not in cfg["description"]:
        errs.append("description lacks the price")
    if len(cfg["seoTitle"]) > 60:
        errs.append(f"seoTitle {len(cfg['seoTitle'])} > 60")
    if len(cfg["seoDescription"]) > 160:
        errs.append(f"seoDescription {len(cfg['seoDescription'])} > 160")
    if not cfg["title"].startswith(cfg["name"] + " "):
        errs.append("title must start with the platform name")
    if errs:
        raise ValueError(f"{cfg['slug']}: " + "; ".join(errs))


def main(check_only=False):
    stale = []
    for platform, cfg in FAMILY.items():
        validate(cfg)
        actor = ACTORS / cfg["slug"]
        for rel, content in files_for(platform, cfg).items():
            path = actor / rel
            old = path.read_text() if path.exists() else None
            if rel == "README.md":
                content = preserve_hero(old, content)
            if old == content:
                continue
            if check_only:
                stale.append(str(path.relative_to(ROOT)))
                continue
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
            print(f"wrote {path.relative_to(ROOT)}")
        # Generated files that the template no longer produces (golden fixtures, tests) are removed.
        if actor.is_dir():
            wanted = set(files_for(platform, cfg))
            for sub in ("golden", "tests"):
                for p in sorted((actor / sub).glob("*")) if (actor / sub).is_dir() else []:
                    rel = f"{sub}/{p.name}"
                    if rel not in wanted:
                        if check_only:
                            stale.append(f"{p.relative_to(ROOT)} (not generated)")
                        else:
                            p.unlink()
                            print(f"removed {p.relative_to(ROOT)}")

    reg_path = ROOT / "registry.json"
    registry = json.loads(reg_path.read_text())
    added = []
    for cfg in FAMILY.values():
        entry = registry["actors"].get(cfg["slug"])
        if entry is None:
            added.append(cfg["slug"])
            registry["actors"][cfg["slug"]] = registry_entry(cfg)
        elif entry.get("listing") != registry_entry(cfg)["listing"]:
            print(f"NOTE registry.json {cfg['slug']}.listing differs from the generated listing (not changed: update it deliberately)")
    if added:
        if check_only:
            stale += [f"registry.json (missing {s})" for s in added]
        else:
            reg_path.write_text(json.dumps(registry, indent=2, ensure_ascii=True))  # file has no trailing newline
            print(f"registry.json: added {', '.join(added)} (staging)")

    if check_only:
        if stale:
            print("STALE (run scripts/make_ats_actors.py):\n  " + "\n  ".join(stale))
            return 1
        return 0
    # Vendored code: shared jobs core and shared lib (both scripts are idempotent).
    for script in ("sync_jobs_core.py", "sync_shared.py"):
        subprocess.run([sys.executable, str(ROOT / "scripts" / script)], check=True)
    return 0


if __name__ == "__main__":
    sys.exit(main(check_only="--check" in sys.argv))
