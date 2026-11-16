// Companies by technology ("technographics from job posts"): one row per company whose open job posts name the
// requested technologies. Shared by actors/companies-by-technology and the `mode: "companies-by-technology"` of
// actors/ats-jobs-feed. Pure apart from loadTechIndex() / runTechnographics(), whose I/O is injected.
//
// Data: the nightly build (index_writer.js, option `tech`) detects technologies (tech.js) in every job's title and
// full description before the description is truncated, and publishes `companies_tech.json.gz` next to the jobs
// index (manifest key `companies_tech`). Format 1:
//   { format: 1, built_at, dictionary_version,
//     technologies: [[slug, name, category], ...],            // position = id used below
//     boards: [{ a: ats, t: token, r?: region, n: company name, f: fetched_at,
//                o: open jobs (after the index dedupe), x: open jobs whose description was read,
//                L: [location strings], D: [departments],
//                j: [[ "3.17.45" tech ids, "US.CA" country codes, "0.2" location indices, department index | -1,
//                     job_url (only on a few sample jobs per technology)? ], ...] }] }
// Only jobs that name at least one technology are listed in `j`; boards without any are left out.
// Company facts only: no person data. Job descriptions themselves are never published.
import { normalizeInput, compileSearch, companyMatches } from './filters.js';
import { openIndex } from './feed.js';
import { boardUrlFor, apiUrlFor } from './transform.js';
import { companyKey } from './text.js';
import { countryCode } from './geo.js';
import { TECH_CATEGORIES, findTechnology, suggestTechnologies } from './tech.js';
import { gunzipSync } from 'node:zlib';

export const TECH_ASSET = 'companies_tech.json.gz';
export const TECH_ASSET_FORMAT = 1;
export const TECH_EVENT = 'company-result';
export const TOP_TECHNOLOGIES = 15;
export const MAX_SAMPLES = 3;
export const MAX_TECHNOLOGIES = 50;

export const TECH_OUTPUT_FIELDS = [
  'company_name', 'company_board', 'ats', 'careers_url', 'boards', 'technologies_matched', 'top_technologies',
  'jobs_mentioning_matched', 'open_jobs_total', 'jobs_with_text', 'sample_job_urls', 'source_url', 'fetched_at',
];

const strList = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? v.split(',') : [])
  .map((x) => String(x ?? '').trim())
  .filter(Boolean);

/**
 * Raw input -> { technologies: [{slug, name}], match, countries, locations, departments, companies, minJobsMentioning,
 * maxResults, unknown: [term] }. Throws a readable Error when no technology is recognised (and no company lookup).
 */
export function normalizeTechInput(input = {}) {
  const terms = strList(input.technologies);
  if (terms.length > MAX_TECHNOLOGIES) throw new Error(`"technologies" takes at most ${MAX_TECHNOLOGIES} entries`);
  const match = input.match ?? input.technologyMatch ?? 'any';
  if (!['any', 'all'].includes(match)) throw new Error(`"match" must be any or all (got ${match})`);
  const technologies = [];
  const unknown = [];
  for (const term of terms) {
    const t = findTechnology(term);
    if (!t) { unknown.push(term); continue; }
    if (!technologies.some((x) => x.slug === t.slug)) technologies.push({ slug: t.slug, name: t.name });
  }
  const companies = strList(input.companies);
  if (unknown.length && !technologies.length) {
    const hints = unknown.slice(0, 3).map((u) => {
      const s = suggestTechnologies(u, 3);
      return s.length ? `"${u}" (did you mean ${s.join(', ')}?)` : `"${u}"`;
    });
    throw new Error(`Unknown technology ${hints.join('; ')}. Use names such as Snowflake, Salesforce, dbt, Kubernetes, React, SAP.`);
  }
  if (!technologies.length && !companies.length) throw new Error('"technologies" needs at least one technology (or set "companies" to list every technology of those companies)');
  const countries = [];
  for (const c of strList(input.countries)) {
    const code = countryCode(c) || (/^[A-Za-z]{2}$/.test(c) ? c.toUpperCase() : null);
    if (!code) throw new Error(`Unknown country "${c}". Use ISO codes such as US, GB, DE or English names.`);
    if (!countries.includes(code)) countries.push(code);
  }
  const minJobsMentioning = input.minJobsMentioning === undefined || input.minJobsMentioning === null || input.minJobsMentioning === ''
    ? 1 : Number(input.minJobsMentioning);
  if (!Number.isInteger(minJobsMentioning) || minJobsMentioning < 1) throw new Error('"minJobsMentioning" must be a positive integer');
  const maxResults = input.maxResults === undefined || input.maxResults === null || input.maxResults === '' ? 100 : Number(input.maxResults);
  if (!Number.isInteger(maxResults) || maxResults < 1) throw new Error('"maxResults" must be a positive integer');
  return {
    technologies, match, countries, locations: strList(input.locations), departments: strList(input.departments),
    companies, minJobsMentioning, maxResults, unknown,
  };
}

// ---------------------------------------------------------------- loading
/** Open the published index and read its companies_tech asset -> { manifest, data }. */
export async function loadTechIndex(deps = {}) {
  const index = await openIndex(deps);
  const file = index.manifest.companies_tech;
  if (!file) throw Object.assign(new Error('The published jobs index has no technology data yet (built before companies-by-technology existed)'), { failureClass: 'site_down' });
  const data = JSON.parse(gunzipSync(await index.readFile(index.base, file, { timeoutMs: 60000, attempts: 4 })).toString('utf8'));
  if (data.format !== TECH_ASSET_FORMAT || !Array.isArray(data.boards)) {
    throw Object.assign(new Error(`unsupported technology data format ${data.format}`), { failureClass: 'schema_change' });
  }
  return { manifest: index.manifest, data };
}

// ---------------------------------------------------------------- aggregation
/** Lowercase alphanumerics of a board token without a trailing number ("Lago-1" -> "lago"). */
const normToken = (token) => {
  const t = String(token).toLowerCase().replace(/[^a-z0-9]/g, '');
  return t.replace(/[0-9]+$/, '') || t;
};
const ids = (s) => (s ? String(s).split('.').map(Number) : []);

/**
 * Asset + normalized input -> company rows (sorted, before maxResults), pure.
 * Boards of one company (same name without legal suffix AND same board token, e.g. "wayve" on Greenhouse and Ashby)
 * are one row. The index already removed the same opening listed on two boards, so their jobs simply add up.
 */
export function techRows(data, input) {
  const techs = data.technologies.map(([slug, name, category], id) => ({ id, slug, name, category }));
  const idOf = new Map(techs.map((t) => [t.slug, t.id]));
  const wanted = input.technologies.map((t) => idOf.get(t.slug)).filter((x) => x !== undefined);
  const lookupAll = !input.technologies.length; // companies lookup without technologies: every technology counts
  if (!lookupAll && !wanted.length) return { rows: [], missing: input.technologies.map((t) => t.slug) };
  const missing = input.technologies.filter((t) => !idOf.has(t.slug)).map((t) => t.slug);
  // "all" needs every requested technology the data knows (a technology newer than the data cannot match).
  const wantSet = new Set(wanted);

  const filtered = input.countries.length || input.locations.length || input.departments.length;
  const search = filtered ? compileSearch(normalizeInput({
    locations: input.locations, countryCodes: input.countries, departments: input.departments, includeDescription: false,
  })) : null;

  const groups = new Map();
  for (const b of data.boards) {
    if (input.companies.length && !input.companies.some((c) => companyMatches(c, { ats: b.a, company_board: b.t, company_name: b.n }))) continue;
    const key = `${companyKey(b.n) || `${b.a}:${b.t}`}#${normToken(b.t)}`;
    (groups.get(key) || groups.set(key, []).get(key)).push(b);
  }

  const rows = [];
  for (const boards of groups.values()) {
    const all = new Map(); // tech id -> jobs (all of the company's jobs)
    const hit = new Map(); // tech id -> jobs (jobs passing the location filters), requested technologies only
    let matchedJobs = 0;
    const perBoard = new Map();
    const samples = [];
    for (const b of boards) {
      let boardMatched = 0;
      for (const j of b.j) {
        const tids = ids(j[0]);
        for (const id of tids) all.set(id, (all.get(id) || 0) + 1);
        if (search) {
          const locs = ids(j[2]).map((i) => b.L?.[i]).filter(Boolean);
          const dept = j[3] >= 0 ? b.D?.[j[3]] ?? null : null;
          const pseudo = {
            ats: b.a, title: '', company_name: b.n, company_board: b.t, locations: locs, country_codes: j[1] ? j[1].split('.') : [],
            department: dept, team: null, workplace_type: null, remote: null, employment_type: null, posted_at: null,
          };
          if (!search(pseudo)) continue;
        }
        let any = false;
        for (const id of tids) {
          if (lookupAll || wantSet.has(id)) { hit.set(id, (hit.get(id) || 0) + 1); any = true; }
        }
        if (any) {
          matchedJobs += 1;
          boardMatched += 1;
          if (j[4]) samples.push({ url: j[4], n: tids.filter((id) => lookupAll || wantSet.has(id)).length });
        }
      }
      perBoard.set(b, boardMatched);
    }
    if (!matchedJobs) continue;
    if (!lookupAll && input.match === 'all' && wanted.some((id) => !hit.has(id))) continue;
    if (matchedJobs < input.minJobsMentioning) continue;
    const ordered = [...boards].sort((x, y) => perBoard.get(y) - perBoard.get(x) || y.o - x.o || `${x.a}:${x.t}`.localeCompare(`${y.a}:${y.t}`));
    const primary = ordered[0];
    const label = (t) => TECH_CATEGORIES[t.category] || t.category;
    const byJobs = (m) => [...m].sort((a, b) => b[1] - a[1] || techs[a[0]].name.localeCompare(techs[b[0]].name));
    const board = (b) => ({ ats: b.a, token: b.t, ...(b.r ? { region: b.r } : {}) });
    samples.sort((a, b) => b.n - a.n);
    rows.push({
      company_name: String(primary.n || primary.t).trim(),
      company_board: primary.t,
      ats: primary.a,
      careers_url: boardUrlFor(board(primary)),
      boards: ordered.map((b) => ({ ats: b.a, token: b.t, careers_url: boardUrlFor(board(b)), open_jobs: b.o, jobs_with_text: b.x })),
      technologies_matched: byJobs(hit).map(([id, jobs]) => ({ technology: techs[id].name, jobs })),
      top_technologies: byJobs(all).slice(0, TOP_TECHNOLOGIES).map(([id, jobs]) => ({ technology: techs[id].name, category: label(techs[id]), jobs })),
      jobs_mentioning_matched: matchedJobs,
      open_jobs_total: boards.reduce((n, b) => n + (b.o || 0), 0),
      jobs_with_text: boards.reduce((n, b) => n + (b.x || 0), 0),
      sample_job_urls: [...new Set(samples.map((s) => s.url))].slice(0, MAX_SAMPLES),
      source_url: apiUrlFor(board(primary)),
      fetched_at: boards.map((b) => b.f).filter(Boolean).sort().pop() || data.built_at,
    });
  }
  rows.sort((a, b) => b.jobs_mentioning_matched - a.jobs_mentioning_matched
    || b.technologies_matched.length - a.technologies_matched.length
    || b.open_jobs_total - a.open_jobs_total
    || a.ats.localeCompare(b.ats) || a.company_board.localeCompare(b.company_board));
  return { rows, missing };
}

// ---------------------------------------------------------------- the run
/**
 * @param input normalizeTechInput() result
 * @param deps { pushData, charge, log?, indexBaseUrl?, readIndexFile? }
 */
export async function runTechnographics(input, deps) {
  const log = deps.log || (() => {});
  const summary = {
    mode: 'companies-by-technology', rows: 0, charged_events: 0, stop_reason: 'exhausted', companies_qualified: 0,
    technologies: input.technologies.map((t) => t.slug), unknown_technologies: input.unknown, missing_in_data: [],
    boards_in_data: 0, index_built_at: null, technology_data_built_at: null,
  };
  if (input.unknown.length) log(`Ignored unknown technologies: ${input.unknown.join(', ')}`);
  const { manifest, data } = await loadTechIndex(deps);
  summary.index_built_at = manifest.built_at;
  summary.technology_data_built_at = data.built_at;
  summary.boards_in_data = data.boards.length;
  const { rows, missing } = techRows(data, input);
  summary.missing_in_data = missing;
  if (missing.length) log(`Not in tonight's technology data yet (added to the dictionary after the build): ${missing.join(', ')}`);
  summary.companies_qualified = rows.length;
  for (const row of rows.slice(0, input.maxResults)) {
    await deps.pushData(row);
    summary.rows += 1;
    // PPE: one company-result per delivered company row (never for an empty run); nothing else is charged.
    const res = await deps.charge({ eventName: TECH_EVENT });
    summary.charged_events += 1;
    if (res?.eventChargeLimitReached) { summary.stop_reason = 'charge_limit'; break; }
  }
  if (summary.stop_reason === 'exhausted' && rows.length > input.maxResults) summary.stop_reason = 'max_results';
  return summary;
}

/**
 * Pricing guard for Actors whose Store pricing may not have the company-result event yet (Jobs Feed): true when the
 * run's pay-per-event prices include it. Pure, exported for tests.
 */
export function hasTechEvent(perEventPrices) {
  return perEventPrices != null && Object.prototype.hasOwnProperty.call(perEventPrices, TECH_EVENT);
}

export const STANDALONE_URL = 'https://apify.com/factpipe/companies-by-technology';

/** Fail-fast message for an Actor whose pricing has no company-result event (Jobs Feed until it is added). */
export function missingEventMessage() {
  return `Companies-by-technology mode is not enabled for this Actor's pricing yet (no "${TECH_EVENT}" event), `
    + `so nothing was run or charged. Use the standalone Actor ${STANDALONE_URL} with the same input.`;
}
