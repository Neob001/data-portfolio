// Pure logic of the Career Page Jobs Scraper: input URLs, careers-page discovery (which links to follow),
// job-platform detection on a page (links, iframes, scripts, redirects, Teamtailor career-site markers),
// and the extra output fields. Job rows themselves come from the shared jobs core (src/core/, synced from
// actors/ats-jobs-feed by scripts/sync_jobs_core.py), so they have the same schema as the other jobs Actors.
import { parseBoardRef, boardKey, ATS_LIST } from './core/transform.js';
import { OUTPUT_FIELDS } from './core/feed.js';
import { decodeEntities } from './core/text.js';

// Same product token and User-Agent as the jobs core (robots.txt groups for "factpipe-jobs-feed" apply).
export const UA = 'Mozilla/5.0 (compatible; factpipe-jobs-feed/1.0; +https://apify.com/factpipe)';

// Limits per company (input URL): page requests (redirect hops included; robots.txt not counted), per host,
// boards fetched, links followed from one page, discovery depth.
export const LIMITS = { pagesPerCompany: 8, pagesPerHost: 6, boardsPerCompany: 3, linksPerPage: 3, maxDepth: 2, redirects: 5 };
export const HOST_GAP_MS = 1000; // one page request start per second per company host
export const PAGE_MAX_BYTES = 8 * 1024 * 1024; // some careers pages inline every job as JSON (4.6 MB seen)

/** Paths probed on the company's site when no page links to a careers page. */
export const CAREERS_PATHS = ['/careers', '/jobs', '/careers/jobs', '/company/careers', '/about/careers', '/join-us', '/karriere'];

// ------------------------------------------------------------------ output
// Extra fields of this Actor (in front of the core's job fields).
export const EXTRA_FIELDS = ['query', 'found', 'reason', 'reason_detail', 'careers_page_url', 'detected_platform'];
export const ROW_FIELDS = [...EXTRA_FIELDS, ...OUTPUT_FIELDS];

/**
 * reason (null on job rows) - every non-job row is free:
 *  invalid_url               the input is not a website URL
 *  site_unreachable          the company website did not answer (DNS, timeout, HTTP error)
 *  robots_disallowed         the website's robots.txt does not allow reading the pages we need (or it has none)
 *  unsupported_platform      the careers page uses a job platform this Actor does not read (detected_platform)
 *  no_supported_ats_detected no supported job-board link found (in-house careers system, JavaScript-only page...)
 *  ats_board_empty           the job board exists but lists no open job
 *  ats_board_not_found       the job-board link is dead (HTTP 404)
 *  ats_board_disallowed      the job board's own robots.txt does not allow reading it (Workday, Personio, Teamtailor)
 *  ats_board_failed          the job board did not answer (after retries)
 *  duplicate_input           an earlier input of the run leads to the same job board (its jobs are listed once)
 *  not_processed             the run's time limit was reached before this company
 */
export const REASONS = [
  'invalid_url', 'site_unreachable', 'robots_disallowed', 'unsupported_platform', 'no_supported_ats_detected',
  'ats_board_empty', 'ats_board_not_found', 'ats_board_disallowed', 'ats_board_failed', 'duplicate_input', 'not_processed',
];

const ARRAY_FIELDS = new Set(['locations', 'country_codes', 'duplicate_sources']);

/** One explanatory (uncharged) row for a company without jobs: every job field null / []. */
export function missRow({ query, reason, detail = null, careersPageUrl = null, platform = null, sourceUrl = null, fetchedAt = new Date() }) {
  if (!REASONS.includes(reason)) throw new Error(`unknown reason ${reason}`);
  const row = {};
  for (const k of ROW_FIELDS) row[k] = ARRAY_FIELDS.has(k) ? [] : null;
  Object.assign(row, {
    query: String(query ?? ''), found: false, reason, reason_detail: detail, careers_page_url: careersPageUrl,
    detected_platform: platform, source_url: sourceUrl, fetched_at: new Date(fetchedAt).toISOString(),
  });
  return row;
}

/** Core output row (toOutput) + this Actor's fields, in ROW_FIELDS order. */
export function jobRow(coreRow, { query, careersPageUrl }) {
  const row = { query: String(query ?? ''), found: true, reason: null, reason_detail: null, careers_page_url: careersPageUrl, detected_platform: coreRow.ats };
  for (const k of OUTPUT_FIELDS) row[k] = coreRow[k] === undefined ? (ARRAY_FIELDS.has(k) ? [] : null) : coreRow[k];
  return row;
}

// ------------------------------------------------------------------ input
/** Raw input line -> { url } (absolute http(s) URL) or { error }. Board refs such as "greenhouse:acme" -> { board }. */
export function parseCompanyInput(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { error: 'empty' };
  const explicit = /^(?:greenhouse|lever|ashby|workable|recruitee|personio|teamtailor|workday):/i.test(s) ? parseBoardRef(s) : null;
  if (explicit) return { board: explicit };
  if (/\s/.test(s)) return { error: 'contains spaces' };
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
  } catch {
    return { error: 'not a URL' };
  }
  if (!/^https?:$/.test(u.protocol)) return { error: `unsupported scheme ${u.protocol}` };
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || /^\d+(\.\d+){3}$/.test(host) || /^-|-\.|\.-/.test(host)) return { error: 'not a public host name' };
  if (/(^|\.)(localhost|local|internal|lan|test|example|invalid)$/.test(host)) return { error: 'not a public host name' };
  u.hash = '';
  return { url: u.href };
}

// ------------------------------------------------------------------ site helpers
const TWO_LEVEL_SUFFIX = /\.(?:co|com|org|net|ac|gov|edu|ne|or|go)\.[a-z]{2}$/;
/** Registrable-domain guess ("careers.acme.co.uk" -> "acme.co.uk"); enough to tell same-site links apart. */
export function siteOf(host) {
  const h = String(host || '').toLowerCase().replace(/^www\d?\./, '');
  const labels = h.split('.');
  const n = TWO_LEVEL_SUFFIX.test(h) ? 3 : 2;
  return labels.slice(-n).join('.');
}

/** Path + query of a URL (what a robots.txt rule is matched against). */
export function robotsPath(url) {
  const u = new URL(url);
  return `${u.pathname || '/'}${u.search}`;
}

// ------------------------------------------------------------------ platform detection
// Hosts of job platforms this Actor does NOT read (named in detected_platform so the user knows why).
export const UNSUPPORTED_PLATFORMS = [
  ['smartrecruiters', /(^|\.)smartrecruiters\.com$/],
  ['icims', /(^|\.)icims\.com$/],
  ['successfactors', /(^|\.)(successfactors\.(com|eu)|sapsf\.(com|eu|cn))$/],
  ['taleo', /(^|\.)taleo\.net$/],
  ['oracle_recruiting_cloud', /\.oraclecloud\.com$/, /\/hcmUI\/CandidateExperience/i],
  ['bamboohr', /(^|\.)bamboohr\.com$/],
  ['jobvite', /(^|\.)jobvite\.com$/],
  ['eightfold', /(^|\.)eightfold\.ai$/],
  ['phenom', /(^|\.)phenompeople\.com$/],
  ['avature', /(^|\.)avature\.net$/],
  ['breezy', /(^|\.)breezy\.hr$/],
  ['pinpoint', /(^|\.)pinpointhq\.com$/],
  ['jazzhr', /(^|\.)applytojob\.com$/],
  ['rippling', /^ats\.rippling\.com$/],
  ['dover', /^app\.dover\.com$/, /^\/(?:jobs|apply)\//],
  ['gem', /^jobs\.gem\.com$/],
  ['join', /^join\.com$/, /^\/companies\//],
  ['softgarden', /(^|\.)softgarden\.(io|de)$/],
  ['ukg', /(^|\.)(ultipro\.com|ukg\.net)$/],
  ['adp', /^(workforcenow|myjobs|recruiting)\.adp\.com$/],
  ['dayforce', /(^|\.)dayforcehcm\.com$/],
  ['paylocity', /^recruiting\.paylocity\.com$/],
  ['zoho_recruit', /(^|\.)zohorecruit\.(com|eu|in)$/],
  ['freshteam', /(^|\.)freshteam\.com$/],
  ['homerun', /(^|\.)homerun\.co$/],
  ['jobylon', /(^|\.)jobylon\.com$/],
  ['comeet', /(^|\.)comeet\.(com|co)$/],
  ['factorial', /(^|\.)factorialhr\.com$/],
];

/** Unsupported job platform an URL belongs to (e.g. "smartrecruiters"), or null. */
export function unsupportedPlatformOf(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  for (const [name, hostRx, pathRx] of UNSUPPORTED_PLATFORMS) {
    if (hostRx.test(host) && (!pathRx || pathRx.test(u.pathname))) return name;
  }
  return null;
}

// Tokens that are template placeholders or generic words, not a company's board.
// Teamtailor's own service hosts linked from its pages (not company career sites; the core skips www/app/...).
const TT_NOT_CAREER_SITES = new Set(['trust', 'security', 'privacy', 'legal', 'academy', 'community', 'integrations', 'hub', 'media', 'career-site-builder']);
const BAD_TOKEN =/^(?:\$|\{|%7b|undefined|null|none|example|your-?company|company|token|board)$|[${}<>]/i;

/**
 * Supported job board an URL points at -> { ats, token, region? } or null. The core's parseBoardRef, plus
 * Greenhouse embed URLs (boards.greenhouse.io/embed/job_board/js?for=acme, .../embed/job_app?for=acme).
 */
export function boardFromUrl(url) {
  const s = String(url || '');
  const gh = s.match(/(?:boards|job-boards)\.(?:eu\.)?greenhouse\.io\/embed\/job_(?:board|app)(?:\/js)?\/?\?(?:[^#\s"']*&)?for=([A-Za-z0-9_-]+)/i);
  if (gh) return BAD_TOKEN.test(gh[1]) ? null : { ats: 'greenhouse', token: gh[1].toLowerCase() };
  if (/greenhouse\.io\/embed\//i.test(s)) return null; // an embed URL without a board token
  let host;
  try { host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname.toLowerCase(); } catch { return null; }
  // Only the platforms' own board hosts (parseBoardRef also accepts "ats:token" strings, never wanted here).
  if (!/(^|\.)(greenhouse\.io|lever\.co|ashbyhq\.com|workable\.com|recruitee\.com|myworkdayjobs\.com|myworkdaysite\.com|jobs\.personio\.(de|com)|teamtailor\.com)$/.test(host)) return null;
  if (/(^|\.)greenhouse\.io$/.test(host) && !/^(boards|job-boards|boards-api)\./.test(host)) return null; // www/app/api docs
  const b = parseBoardRef(s.replace(/^\/\//, 'https://'));
  if (!b || BAD_TOKEN.test(b.token)) return null;
  if (b.ats === 'teamtailor' && TT_NOT_CAREER_SITES.has(b.token)) return null;
  return b;
}

/** HTML -> text with entities and JSON/JS escapes undone, so URLs inside attributes and scripts read plainly. */
export function unescapePage(html) {
  return decodeEntities(String(html || '')
    .replace(/\\u002[fF]/g, '/').replace(/\\u0026/g, '&').replace(/\\u003[dD]/g, '=').replace(/\\u003[fF]/g, '?')
    .replace(/\\\//g, '/'))
    .replace(/&#0*34;|&quot;/g, '"');
}

const URL_RX = /(?:https?:)?\/\/[a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?::\d+)?(?:\/[^\s"'<>`\\)\]}|^]*)?/gi;

/** Every absolute URL in the page (attributes, inline scripts, JSON), resolved against the page URL. */
export function urlsInPage(html, pageUrl) {
  return urlsInText(unescapePage(html), pageUrl);
}

function urlsInText(text, pageUrl) {
  const out = [];
  for (const m of text.matchAll(URL_RX)) {
    let raw = m[0].replace(/[.,;:!?]+$/, '');
    if (raw.startsWith('//')) raw = `https:${raw}`;
    try { out.push(new URL(raw, pageUrl).href); } catch { /* skip */ }
  }
  return out;
}

// A careers page that calls the board API from inline JavaScript with the token in a variable:
//   const boardToken = 'acme'; fetch(`https://boards-api.greenhouse.io/v1/boards/${boardToken}/jobs`)
const TEMPLATE_URL = /((?:boards-api\.greenhouse\.io\/v1\/boards|(?:job-)?boards\.greenhouse\.io|api\.(?:eu\.)?lever\.co\/v0\/postings|jobs\.(?:eu\.)?lever\.co|api\.ashbyhq\.com\/posting-api\/job-board|jobs\.ashbyhq\.com)\/)\$\{\s*([A-Za-z_$][\w$]*)\s*\}/gi;

/** Boards whose token sits in a JS variable next to a templated board-API URL. */
export function templatedBoards(text) {
  const out = [];
  for (const m of String(text || '').matchAll(TEMPLATE_URL)) {
    const name = m[2].replace(/\$/g, '\\$');
    const v = text.match(new RegExp(`(?:^|[^\\w$.])${name}\\s*[:=]\\s*["'\`]([A-Za-z0-9][A-Za-z0-9_.-]{0,80})["'\`]`));
    const b = v && boardFromUrl(`https://${m[1]}${v[1]}`);
    if (b) out.push(b);
  }
  return out;
}

/**
 * Is this page a Teamtailor career site (custom domain such as careers.acme.com)? Its markup loads the
 * career-site stylesheet from teamtailor-cdn.com and uses "careersite--" Stimulus controllers.
 */
export function isTeamtailorCareerSite(html) {
  const s = String(html || '');
  return /teamtailor-cdn\.com\/assets\/careersite/i.test(s) && /data-controller="[^"]*careersite--/i.test(s);
}

// boardHost() in the core reads a token "<label>.<2 letters>" as a regional Teamtailor subdomain
// ("acme.na" -> acme.na.teamtailor.com), so a two-label custom domain with a 2-letter TLD can't be a token.
const TT_REGIONAL_LIKE = /^[a-z0-9-]+\.[a-z]{2}$/;

/**
 * Job platforms on one fetched page -> { boards: [{ ats, token, region?, refs }], unsupported: name|null }.
 * boards: supported boards referenced by links, iframes, scripts or inline JSON (most referenced first, at
 * most LIMITS.boardsPerCompany); a Teamtailor career site on its own domain is the board itself.
 */
export function detectPlatforms(html, pageUrl) {
  const counts = new Map();
  const add = (b, n = 1) => {
    const k = boardKey(b);
    const cur = counts.get(k);
    if (cur) cur.refs += n; else counts.set(k, { ...b, refs: n });
  };
  const unsupported = new Map();
  const text = unescapePage(html);
  for (const u of urlsInText(text, pageUrl)) {
    const b = boardFromUrl(u);
    if (b) { add(b); continue; }
    const p = unsupportedPlatformOf(u);
    if (p) unsupported.set(p, (unsupported.get(p) || 0) + 1);
  }
  // Greenhouse's embed script reads the board token from a global (Grnhse.Settings / grnhse_app + "for=").
  for (const b of templatedBoards(text)) add(b, 2);
  for (const m of text.matchAll(/grnhse[\s\S]{0,300}?[?&]for=([A-Za-z0-9_-]+)/gi)) {
    if (!BAD_TOKEN.test(m[1])) add({ ats: 'greenhouse', token: m[1].toLowerCase() }, 0);
  }
  const host = new URL(pageUrl).hostname.toLowerCase();
  const own = boardFromUrl(pageUrl);
  if (own) add(own, 1000); // the page itself is a board page (after a redirect, or given directly)
  else if (isTeamtailorCareerSite(html) && !/\.teamtailor\.com$/.test(host) && !TT_REGIONAL_LIKE.test(host)) add({ ats: 'teamtailor', token: host }, 1000);
  const boards = [...counts.values()].sort((a, b) => b.refs - a.refs).slice(0, LIMITS.boardsPerCompany);
  const top = [...unsupported.entries()].sort((a, b) => b[1] - a[1])[0];
  return { boards, unsupported: top ? top[0] : null };
}

// ------------------------------------------------------------------ careers-page discovery
const CAREERS_TEXT = /\b(?:careers?|jobs?|job openings|open (?:roles|positions|jobs)|join (?:us|our team|the team)|we(?:'|’)?re hiring|work (?:with|for|at) us|vacanc(?:y|ies)|opportunities|hiring|karriere|stellenangebote|stellen|jobs bei|emplois?|carri[eè]res?|recrutement|empleos?|trabaja con nosotros|vacatures|werken bij|lavora con noi|jobb|lediga jobb|karriär|ty[oö]paikat|rekrytointi|praca|kariera)\b/i;
const CAREERS_PATH = /\/(?:careers?|jobs?|job-openings|join(?:-?us)?|work-?with-?us|work-?at-?|vacanc(?:y|ies)|open-?(?:roles|positions)|openings|positions|hiring|karriere|stellen(?:angebote)?|emplois?|carrieres?|recrutement|empleos?|trabaja-con-nosotros|vacatures|werken-?bij|jobb|lavora-con-noi|karriar)(?:[/?#.\-_]|$)/i;
const CAREERS_HOST = /^(?:careers?|jobs?|karriere|work|join|hiring|talent|apply)\./i;
const NOT_PAGES = /\.(?:pdf|jpe?g|png|gif|svg|webp|ico|css|js|json|xml|zip|mp4|mov|woff2?|ttf)(?:[?#]|$)/i;
// Job aggregators and social sites are never followed (and LinkedIn etc. are off-limits for this business).
const NEVER_FOLLOW = /(^|\.)(linkedin\.com|facebook\.com|twitter\.com|x\.com|instagram\.com|youtube\.com|tiktok\.com|glassdoor\.[a-z.]+|indeed\.[a-z.]+|xing\.com|kununu\.com|stepstone\.[a-z.]+|monster\.[a-z.]+|welcometothejungle\.com|wellfound\.com|angel\.co|builtin\.com|github\.com|medium\.com|google\.com|apple\.com|t\.co)$/i;
const NOISE_PATH = /\/(?:blog|news|press|articles?|stories|events?|webinars?|podcasts?|docs?|help|support|legal|privacy|cookies?|terms)(?:[/?#]|$)/i;

/** Careers-likeness of a link (0 = not a careers link). */
export function careersScore(href, text) {
  let u;
  try { u = new URL(href); } catch { return 0; }
  let s = 0;
  if (CAREERS_TEXT.test(text || '')) s += 3;
  if (CAREERS_PATH.test(u.pathname)) s += 3;
  if (CAREERS_HOST.test(u.hostname)) s += 3;
  if (s && NOISE_PATH.test(u.pathname)) s -= 2;
  if (s && /\/(?:jobs?|positions|openings)\/[^/]*\d{3,}/i.test(u.pathname)) s -= 1; // one job posting, not the list
  return Math.max(0, s);
}

/**
 * Links on a page worth following to find the job board: careers-like (careersScore >= 3), http(s), on the
 * same site as the page or the company, or a careers host of another domain ("careers.acme-group.com") when
 * the link text says so. Best first, at most `limit`, never one in `seen`.
 */
export function careersLinks(html, pageUrl, { companySite = null, seen = new Set(), limit = LIMITS.linksPerPage } = {}) {
  const pageSite = siteOf(new URL(pageUrl).hostname);
  const found = new Map();
  for (const m of String(html || '').matchAll(/<a\b([^>]*)>([\s\S]{0,600}?)<\/a>/gi)) {
    const href = m[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
    const raw = href && decodeEntities(href[1] ?? href[2] ?? href[3] ?? '').trim();
    if (!raw || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(raw)) continue;
    let u;
    try { u = new URL(raw, pageUrl); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || NOT_PAGES.test(u.pathname) || NEVER_FOLLOW.test(u.hostname)) continue;
    u.hash = '';
    const text = decodeEntities(`${m[2].replace(/<[^>]+>/g, ' ')} ${(m[1].match(/\b(?:aria-label|title)\s*=\s*"([^"]*)"/i) || [])[1] || ''}`).replace(/\s+/g, ' ').trim();
    const score = careersScore(u.href, text);
    if (score < 3) continue;
    const site = siteOf(u.hostname);
    const sameSite = site === pageSite || site === companySite;
    if (!sameSite && !(CAREERS_HOST.test(u.hostname) && CAREERS_TEXT.test(text))) continue;
    if (seen.has(u.href) || u.href === pageUrl) continue;
    const prev = found.get(u.href);
    if (!prev || prev.score < score) found.set(u.href, { url: u.href, score: score + (sameSite ? 0 : -1) });
  }
  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
    .slice(0, limit);
}

// One job posting on the company's own site (its Apply button often points at the ATS).
const POSTING_URL = /\/(?:jobs?|positions?|openings?|careers?|vacanc(?:y|ies)|stellen(?:angebote)?|job-?offers?|roles?|opportunities)\/(?:[^/?#]+\/)*[^/?#]*\d{4,}[^/?#]*\/?$|[?&](?:gh_jid|jobId|job_id|jid)=\w+/i;

/**
 * Last resort when a careers page shows jobs but no board link: links to single postings on the same site
 * (one of them is read; postings rendered by the company's own front end often embed or link the ATS).
 */
export function postingLinks(html, pageUrl, { companySite = null, seen = new Set(), limit = 1 } = {}) {
  const pageSite = siteOf(new URL(pageUrl).hostname);
  const out = [];
  for (const m of String(html || '').matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    let u;
    try { u = new URL(decodeEntities(m[1] ?? m[2] ?? ''), pageUrl); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || NOT_PAGES.test(u.pathname)) continue;
    const site = siteOf(u.hostname);
    if (site !== pageSite && site !== companySite) continue;
    u.hash = '';
    if (!POSTING_URL.test(`${u.pathname}${u.search}`) || seen.has(u.href) || out.includes(u.href)) continue;
    out.push(u.href);
    if (out.length >= limit) break;
  }
  return out;
}

export { ATS_LIST };
