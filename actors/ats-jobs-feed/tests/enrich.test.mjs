// Deterministic enrichment (src/core/enrich.js): table-driven cases from real-world postings, the
// `seniority` search filter, toOutput() wiring, and the dataset schema of every jobs Actor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  seniorityOf, yearsExperienceMin, salaryFromText, visaSponsorship, enrichRow, SENIORITY_LEVELS, SALARY_SOURCES,
} from '../src/core/enrich.js';
import { runFeed, toOutput, OUTPUT_FIELDS } from '../src/core/feed.js';
import { normalizeInput, compileSearch, filterIdentity } from '../src/core/filters.js';
import { apiUrlFor } from '../src/core/transform.js';
import { fakeNetwork, sink, FIXTURE_BOARDS, NOW, buildIndex, assertMatchesSchema } from './helpers.mjs';

// ------------------------------------------------------------------ seniority (title only)
const SENIORITY = [
  // English
  ['Software Engineering Intern - Fullstack (x/f/m)', 'intern'],
  ['Summer 2027 Core Banking Intern (Remote)', 'intern'],
  ['Intern/Co-op – Geotechnical Engineering (Summer 2027)', 'intern'],
  ['Automotive Technician Apprenticeship for Military Veterans', 'intern'],
  ['Trainee Accountant', 'intern'],
  ['Summer Associate (Summer 2027)', 'intern'],
  ['Product Manager Intern', 'intern'],
  ['Internship Program Manager', null],
  ['Internal Audit Manager', 'manager'],
  ['Junior Application Developer', 'entry'],
  ['Jr. Marketing Specialist (Contract, Remote)', 'entry'],
  ['Entry-level Auto Technician', 'entry'],
  ['2027 Graduate Scheme, Economic & Financial Consulting', 'entry'],
  ['Associate Product Manager', 'entry'],
  ['Customer Service Associate I', 'entry'],
  ['Data Entry Clerk', null],
  ['Engineer II, Verification & Validation', 'mid'],
  ['Implementation Specialist - II', 'mid'],
  ['Mid-Level DevSecOps Engineer', 'mid'],
  ['Experienced Registered Nurse, Ambulatory Procedures Unit', 'mid'],
  ['Senior Software Engineer, Backend', 'senior'],
  ['Sr. IT Network Engineer (Top Secret Clearance)', 'senior'],
  ['Staff Software Engineer', 'senior'],
  ['Staff Nurse', null],
  ['Staff Accountant', null],
  ['Principal Machine Learning Engineer', 'senior'],
  ['Electrical Integration & Test III', 'senior'],
  ['Senior Living Coordinator', null],
  ['Lead Electrical Design Engineer', 'lead'],
  ['Tech Lead, Payments', 'lead'],
  ['Shift Supervisor (Part Time, .3 Nights)', 'lead'],
  ['Lead Generation Specialist', null],
  ['Group Product Manager II - Tech Growth', 'lead'],
  ['Danish Speaking Customer Experts for an Electronics Leader - Work Remote', null],
  ['Engineering Manager, Platform', 'manager'],
  ['Senior Manager, Treasury', 'manager'],
  ['Manager, Customer Success', 'manager'],
  ['Product Manager', null],
  ['Senior Product Manager', 'senior'],
  ['Customer Success Manager - Corporate', null],
  ['Key Account Manager', null],
  ['Assistant Director of Nursing', 'manager'],
  ['Director, Engineering, Platform Operations & Productivity', 'director'],
  ['Associate Director, Clinical Operations', 'director'],
  ['Head of Brand & Product Marketing', 'director'],
  ['VP, Enterprise Product Management', 'director'],
  ['Vice President of Sales', 'director'],
  ['Chief Technology Officer', 'executive'],
  ['CTO & Co-Founder', 'executive'],
  ['Interim CFO', 'executive'],
  ['SVP, Agricultural & Rural Banking Policy', 'executive'],
  ['President - RG&E', 'executive'],
  ['Managing Director - France', 'executive'],
  ['Software Engineer - CTO Office', null],
  ['Executive Assistant to the CEO', null],
  ['Executive Assistant and PA to Chief Executive', null],
  ['Chief of Staff', null],
  ['Founding Engineer', null],
  ['Account Executive, Growth - UK&I', null],
  ['Patient Care Director General Pediatrics', 'director'],
  // German / French / Spanish / Dutch / Portuguese
  ['Werkstudent Marketing (m/w/d)', 'intern'],
  ['Praktikum Vertrieb (m/w/d)', 'intern'],
  ['Teamleiter Immobilienverwaltung (m/f/d)', 'lead'],
  ['Geschäftsführer (m/w/d)', 'executive'],
  ['Stagiaire Trade Marketing CHR H/F', 'intern'],
  ['Stage Produits Structurés - Janvier 2027', 'intern'],
  ['Stage Manager', 'manager'],
  ['Avocat junior en droit des affaires F/H', 'entry'],
  ['Responsable Commercial (H/F)', 'manager'],
  ['Directeur Financier', 'director'],
  ['Becario de Marketing', 'intern'],
  ['Desarrollador Semi Senior', 'mid'],
  ['Gerente de Ventas', 'manager'],
  ['Medior Mainstream Cloud Engineer', 'mid'],
  ['Estagiário de TI', 'intern'],
  ['Analista Pleno de Dados', 'mid'],
  ['Analista Sênior de Business Intelligence', 'senior'],
];

test(`seniorityOf: ${SENIORITY.length} real-world titles`, () => {
  for (const [title, want] of SENIORITY) assert.equal(seniorityOf(title), want, title);
  assert.equal(seniorityOf(''), null);
  assert.equal(seniorityOf(null), null);
});

test('seniorityOf: only enum values, fast enough for an index scan (~730k titles)', () => {
  const titles = SENIORITY.map(([t]) => t);
  for (const t of titles) assert.ok(SENIORITY_LEVELS.includes(seniorityOf(t)) || seniorityOf(t) === null);
  const t0 = process.hrtime.bigint();
  let n = 0;
  for (let i = 0; i < 100000; i += 1) if (seniorityOf(titles[i % titles.length])) n += 1;
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(n > 0);
  assert.ok(ms < 3000, `100k titles took ${ms.toFixed(0)} ms`); // ~150 ms on a laptop
});

// ------------------------------------------------------------------ salary in the description
const sal = (salary_min, salary_max, salary_currency, salary_period) => ({ salary_min, salary_max, salary_currency, salary_period });
const SALARY = [
  ['The base salary range for this role is $120,000 - $150,000.', [], sal(120000, 150000, 'USD', 'year')],
  ['Compensation: $120K–$150K USD + equity', [], sal(120000, 150000, 'USD', 'year')],
  ['Gehalt: €55.000 - €65.000 brutto pro Jahr', [], sal(55000, 65000, 'EUR', 'year')],
  ['Salary: £40k-£45k depending on experience', [], sal(40000, 45000, 'GBP', 'year')],
  ['Pay: $25/hour', [], sal(25, 25, 'USD', 'hour')],
  ['Annual base salary range (excluding equity and bonus):\n\n$186,065—$218,900 USD', [], sal(186065, 218900, 'USD', 'year')],
  ['Pay Range Italy: 72,833.00 - 97,110.00 - 121,388.00 EUR per annum.', [], sal(72833, 121388, 'EUR', 'year')],
  ['Salary Range: $27.46 - $30.10 per hour', ['CA'], sal(27.46, 30.1, 'CAD', 'hour')],
  ['Hourly pay range: $24.00 - $33.00', ['US'], sal(24, 33, 'USD', 'hour')],
  ['Rémunération : 1300€ brut/mois.\nTickets Restaurants : 11,97€/jour ouvré.', [], sal(1300, 1300, 'EUR', 'month')],
  ['mit einem Gehalt ab 2.981,00 Euro brutto/Monat', [], sal(2981, null, 'EUR', 'month')],
  ['Compensation & Benefits\n• Starting at $16.00/hour', [], sal(16, null, 'USD', 'hour')],
  ['The salary for this role is up to $150,000 per year.', [], sal(null, 150000, 'USD', 'year')],
  ['The annual base salary range for this role depends on location.\nZone A: $150,000 - $180,000\nZone B: $135,000 - $162,000', [], sal(135000, 180000, 'USD', 'year')],
  ['CTC: 12-18 LPA', ['IN'], sal(1200000, 1800000, 'INR', 'year')],
  ['Salary: CHF 110,000 - 130,000 per year', [], sal(110000, 130000, 'CHF', 'year')],
  ['Lön: 45 000 SEK per månad', [], null], // no pay word we know + "månad" unknown period: left alone
  // not pay
  ['We have raised $50M from top investors.', [], null],
  ['We process more than 200m transactions and over £180bn in payment value.', [], null],
  ['$2B in revenue and 1,200 employees.', [], null],
  ['Enjoy a $1,500 learning budget per year and a $500 home office stipend.', [], null],
  ['Signing bonus: $10,000', [], null],
  ['Experience managing at least $250,000/month Google Ads spend', [], null],
  ['EUR 250k - EUR 300k OTE 50/50 Split annually.', [], null],
  ['Competitive salary and equity.', [], null],
  ['Salary 58-62k', [], null], // no currency
  ['Salary: AED 13,000-15,000', [], null], // monthly or annual? not stated: left alone
  ['COMPENSATION $250 one-time', [], null],
  ['Our customers saved $3,000,000 last year.', [], null],
];

test(`salaryFromText: ${SALARY.length} pay / non-pay cases`, () => {
  for (const [text, cc, want] of SALARY) assert.deepEqual(salaryFromText(text, cc), want, text);
  assert.equal(salaryFromText(''), null);
  assert.equal(salaryFromText(null), null);
});

test('salaryFromText: a bare "$" follows the job country, then explicit currency words in the text', () => {
  assert.equal(salaryFromText('Salary: $90,000 - $100,000 per year', ['US']).salary_currency, 'USD');
  assert.equal(salaryFromText('Salary: $90,000 - $100,000 per year', ['AU']).salary_currency, 'AUD');
  assert.equal(salaryFromText('Salary: $90,000 - $100,000 per year (CAD)', ['GB']).salary_currency, 'CAD');
  // "...ic$" or "c$" inside other words must not read as Canadian dollars
  assert.equal(salaryFromText('Basic$ allowance aside, the salary is $175,000 to $200,000 base', []).salary_currency, 'USD');
});

// ------------------------------------------------------------------ years of experience
const YEARS = [
  ['• 3+ years of experience in illustration and design production.', 3],
  ['• At least 5 years of professional software development experience', 5],
  ['A minimum of 2 years in a customer-facing role', 2],
  ['• 3-5 years of relevant experience', 3],
  ['• Typically 6–10 years of experience in information security', 6],
  ['5 years of experience with Python', 5],
  ['• 7+ years (or equivalent depth) in power electronics design', 7],
  ['• 5+ years in People Operations / HR Operations in a scaling company', 5],
  ['Experience: 3+ yrs', 3],
  ['• 6 months to 1 year of experience in logistics', 0],
  ['three (3) years of experience', 3],
  ['Mindestens 3 Jahre Berufserfahrung im Vertrieb', 3],
  ['Tu justifies de 3 à 5 ans d’expérience en lutte contre la fraude', 3],
  ['Al menos 2 años de experiencia', 2],
  ['Minimaal 2 jaar aantoonbare ervaring', 2],
  ['Requirements:\n• 3+ years of experience\nPreferred:\n• 7+ years of experience', 3],
  ['Preferred qualifications:\n• 4+ years of experience with Kubernetes', 4],
  // company age and other years
  ['Founded 20 years ago, we build tools for teams.', null],
  ['For over 10 years we have been helping retailers.', null],
  ['With over 15 years of experience, our consultants help clients grow.', null],
  ['With 20+ years of proven success we’re the leading agency.', null],
  ['Our team has 15 years of combined experience.', null],
  ['Anniversary gifts when you hit 5 and 10 years of service.', null],
  ['Must be 18 years of age or older.', null],
  ['Du bist mindestens 16 Jahre alt', null],
  ['spécialisée depuis plus de 75 ans dans la conception', null],
  ['Minimum 2 years contract', null],
  ['25+ years of experience required', null], // outside 0..20
  ['• Up to 5 years of experience in Strategic Finance or FP&A', null], // a ceiling
  ['Qualifications\n• React: 5+ years\n• Software engineering: 10+ years', null], // per-skill lines: no overall minimum read
];

test(`yearsExperienceMin: ${YEARS.length} requirement / company-age cases`, () => {
  for (const [text, want] of YEARS) assert.equal(yearsExperienceMin(text), want, text);
  assert.equal(yearsExperienceMin(''), null);
});

// ------------------------------------------------------------------ visa sponsorship
const VISA = [
  ['Visa sponsorship is available for this role.', true],
  ['We sponsor visas for the right candidates.', true],
  ['H-1B transfers welcome', true],
  ['We are also committed to sponsoring work visas on behalf of qualified candidates if necessary.', true],
  ['Visa Sponsorship – we provide visa sponsorship for those of you who are eager to join us from outside of Germany.', true],
  ['Benefits\n- Visa Sponsor\n- Relocation Support', true],
  ['We are unable to sponsor visas for this position.', false],
  ['No visa sponsorship is available.', false],
  ['Candidates must be authorized to work in the US without sponsorship.', false],
  ['Please note that we currently do not offer visa sponsorship.', false],
  ['This role is not eligible for visa sponsorship.', false],
  ['Visa sponsorship available. Note: we cannot sponsor H-1B transfers.', false], // negation wins
  ['Visa sponsorship may be considered for exceptional candidates.', null],
  ['Applicants must be authorized to work in the US.', null],
  ['We partner with Visa and Mastercard.', null],
  ['Manage congress sponsorship activity on behalf of your client.', null],
];

test(`visaSponsorship: ${VISA.length} positive / negative / both / unrelated cases`, () => {
  for (const [text, want] of VISA) assert.equal(visaSponsorship(text), want, text);
  assert.equal(visaSponsorship(null), null);
});

test(`table sizes: at least 60 real-world-style cases (${SENIORITY.length + SALARY.length + YEARS.length + VISA.length})`, () => {
  assert.ok(SENIORITY.length + SALARY.length + YEARS.length + VISA.length >= 60);
});

// ------------------------------------------------------------------ enrichRow / toOutput
const baseJob = (extra = {}) => ({
  job_id: 'greenhouse:acme:1', title: 'Senior Data Engineer', company_name: 'Acme', company_board: 'acme', ats: 'greenhouse',
  department: null, team: null, employment_type: null, workplace_type: 'remote', locations: ['Remote, US'], country_codes: ['US'],
  remote: true, salary_min: null, salary_max: null, salary_currency: null, salary_period: null, posted_at: '2026-09-18T00:00:00.000Z',
  updated_at: null, apply_url: 'https://example.com/1', job_url: 'https://example.com/1', description_text: null, description_snippet: null,
  duplicate_sources: [], match_score: null, matched_in: null, source_url: 'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
  fetched_at: '2026-09-19T00:00:00.000Z', ...extra,
});
const DESC = 'Requirements:\n• 5+ years of experience building data pipelines\nThe base salary range for this role is $150,000 - $180,000 per year.\nWe are unable to sponsor visas.';

test('enrichRow: structured salary is never overwritten; description salary only fills empty pay fields', () => {
  const structured = enrichRow({ title: 'Engineer', salary_min: 100, salary_max: 200, salary_currency: 'EUR', salary_period: 'month', country_codes: [] }, DESC);
  assert.deepEqual([structured.salary_min, structured.salary_max, structured.salary_currency, structured.salary_period, structured.salary_source],
    [100, 200, 'EUR', 'month', 'structured']);
  assert.equal(structured.years_experience_min, 5);
  assert.equal(structured.visa_sponsorship, false);
  const parsed = enrichRow({ title: 'Engineer', salary_min: null, salary_max: null, salary_currency: null, salary_period: null, country_codes: ['US'] }, DESC);
  assert.deepEqual([parsed.salary_min, parsed.salary_max, parsed.salary_currency, parsed.salary_period, parsed.salary_source],
    [150000, 180000, 'USD', 'year', 'description']);
  const none = enrichRow({ title: 'Engineer', salary_min: null, salary_max: null, country_codes: [] }, null);
  assert.deepEqual([none.seniority, none.salary_source, none.years_experience_min, none.visa_sponsorship], [null, null, null, null]);
});

test('toOutput: enrichment fields in OUTPUT_FIELDS order; description fields need the description', () => {
  for (const f of ['seniority', 'salary_source', 'years_experience_min', 'visa_sponsorship']) assert.ok(OUTPUT_FIELDS.includes(f), f);
  // Index record without description (search mode, includeDescription false): only the title-based field.
  const slim = toOutput(baseJob(), false);
  assert.deepEqual(Object.keys(slim), OUTPUT_FIELDS);
  assert.deepEqual([slim.seniority, slim.salary_source, slim.years_experience_min, slim.visa_sponsorship], ['senior', null, null, null]);
  assertMatchesSchema(slim);
  // Description read (includeDescription true, or live mode where the board read returns it anyway).
  for (const include of [true, false]) {
    const row = toOutput(baseJob({ description_text: DESC }), include);
    assert.deepEqual([row.salary_min, row.salary_max, row.salary_source, row.years_experience_min, row.visa_sponsorship],
      [150000, 180000, 'description', 5, false]);
    assert.equal(row.description_text, include ? DESC : null);
    assertMatchesSchema(row);
  }
});

// ------------------------------------------------------------------ the `seniority` filter
test('normalizeInput: seniority validated, deduped, lowercase; part of the incremental key only when set', () => {
  assert.deepEqual(normalizeInput({}).seniority, []);
  assert.deepEqual(normalizeInput({ seniority: ['Senior', 'lead', 'senior'] }).seniority, ['senior', 'lead']);
  assert.deepEqual(normalizeInput({ seniority: 'intern, entry' }).seniority, ['intern', 'entry']);
  assert.throws(() => normalizeInput({ seniority: ['ninja'] }), /Unknown seniority "ninja"/);
  assert.ok(!('seniority' in filterIdentity(normalizeInput({}))), 'existing cursors keep their key');
  assert.deepEqual(filterIdentity(normalizeInput({ seniority: ['senior', 'lead'] })).seniority, ['lead', 'senior']);
});

test('compileSearch: seniority filter by title; null-seniority jobs excluded only when the filter is set', () => {
  const job = (title) => baseJob({ title });
  const all = compileSearch(normalizeInput({}));
  const senior = compileSearch(normalizeInput({ seniority: ['senior', 'lead'] }));
  assert.ok(all(job('Software Engineer')) && all(job('Senior Software Engineer')));
  assert.equal(senior(job('Software Engineer')), null);
  assert.ok(senior(job('Senior Software Engineer')));
  assert.ok(senior(job('Tech Lead, Payments')));
  assert.equal(senior(job('Engineering Manager')), null);
});

async function liveRun(input, extra) {
  const net = fakeNetwork(extra);
  const out = sink();
  await runFeed(normalizeInput(input), { ...out, fetchJson: net.fetchJson, fetchText: net.fetchText, now: () => NOW, hostGaps: {} });
  return out.rows;
}

test('search mode: seniority filter applied at index-scan time; rows schema-valid', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'enrich-index-'));
  try {
    await buildIndex(dir);
    const out = sink();
    const net = fakeNetwork();
    await runFeed(normalizeInput({ seniority: ['director', 'mid'], includeDescription: false }), {
      ...out, indexBaseUrl: pathToFileURL(dir).href, now: () => NOW, hostGaps: {}, fetchJson: net.fetchJson,
    });
    assert.ok(out.rows.length >= 2, `${out.rows.length} rows`);
    assert.deepEqual(new Set(out.rows.map((r) => r.seniority)), new Set(['director', 'mid']));
    for (const r of out.rows) {
      assert.equal(r.seniority, seniorityOf(r.title));
      // includeDescription false in search mode: no description, so no description-based fields
      assert.equal(r.years_experience_min, null);
      assert.equal(r.visa_sponsorship, null);
      assert.ok(r.salary_source === null || r.salary_source === 'structured');
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('live mode: description-based salary / years / visa on a board whose ATS has no pay fields', async () => {
  const board = { ats: 'greenhouse', token: 'enrichco' };
  const content = '<p>Requirements:</p><ul><li>5+ years of experience building data pipelines</li></ul>'
    + '<p>The base salary range for this role is $150,000 - $180,000 per year.</p><p>Visa sponsorship is available.</p>';
  const extra = {
    [apiUrlFor(board)]: () => ({ jobs: [{ id: 1, title: 'Staff Data Engineer', absolute_url: 'https://job-boards.greenhouse.io/enrichco/jobs/1',
      location: { name: 'Remote, US' }, updated_at: '2026-09-18T10:00:00Z', first_published: '2026-09-18T10:00:00Z', content, company_name: 'EnrichCo' }] }),
  };
  for (const includeDescription of [true, false]) {
    const rows = await liveRun({ companyUrls: ['greenhouse:enrichco'], includeDescription }, extra);
    assert.equal(rows.length, 1);
    const r = rows[0];
    assert.deepEqual([r.seniority, r.salary_min, r.salary_max, r.salary_currency, r.salary_period, r.salary_source, r.years_experience_min, r.visa_sponsorship],
      ['senior', 150000, 180000, 'USD', 'year', 'description', 5, true]);
  }
});

// ------------------------------------------------------------------ dataset schema of every jobs Actor
const ROOT = new URL('../../', import.meta.url);
const JOB_ACTORS = readdirSync(ROOT).filter((d) => existsSync(new URL(`${d}/src/core/feed.js`, ROOT)) && d !== 'companies-hiring');

function validator(slug) {
  const fields = JSON.parse(readFileSync(new URL(`${slug}/.actor/actor.json`, ROOT), 'utf8')).storages.dataset.fields.properties;
  return (row) => {
    for (const [key, value] of Object.entries(row)) {
      const spec = fields[key];
      assert.ok(spec, `${slug}: field ${key} is not declared`);
      const types = [].concat(spec.type);
      const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
      assert.ok(types.includes(actual) || (actual === 'integer' && types.includes('number')), `${slug}: ${key}=${JSON.stringify(value)} (${actual}) not in ${types}`);
      if (spec.enum) assert.ok(spec.enum.includes(value), `${slug}: ${key}=${value} not in enum (null must be listed too)`);
    }
    for (const key of Object.keys(fields)) assert.ok(key in row, `${slug}: row misses ${key}`);
  };
}

test(`every jobs Actor's dataset schema accepts enriched rows (${JOB_ACTORS.join(', ')})`, async () => {
  assert.ok(JOB_ACTORS.length >= 7, JOB_ACTORS.join(','));
  const golden = await liveRun({ companyUrls: [...FIXTURE_BOARDS.map((b) => `${b.ats}:${b.token}`), 'https://workday.wd5.myworkdayjobs.com/Workday'] });
  assert.ok(golden.some((r) => r.seniority !== null) && golden.some((r) => r.salary_source === 'structured'));
  // Every enum value (and null) of the new fields, and integer / boolean values.
  const synthetic = [...SENIORITY_LEVELS, null].map((level, i) => ({
    ...toOutput(baseJob({ description_text: DESC }), true),
    seniority: level,
    salary_source: [...SALARY_SOURCES, null][i % 3],
    years_experience_min: i % 2 ? null : i,
    visa_sponsorship: [true, false, null][i % 3],
  }));
  for (const slug of JOB_ACTORS) {
    const check = validator(slug);
    for (const row of [...golden, ...synthetic]) check(row);
  }
});
