// Deterministic job enrichment: seniority from the title; minimum years of experience, salary stated in
// the description text and visa sponsorship from the description. Pure functions, no I/O, no models:
// a fixed set of precompiled regular expressions. Anything ambiguous is left null instead of guessed.
//
//  - seniorityOf(title) runs at index-scan time for the `seniority` filter (up to ~730k titles per run),
//    so it is a handful of precompiled regexes tested in priority order (~1.5 us per title), with no
//    per-call allocations beyond the regex tests themselves.
//  - The description-based fields run only for delivered rows that have a description.

// ------------------------------------------------------------------ seniority (title only)
export const SENIORITY_LEVELS = ['intern', 'entry', 'mid', 'senior', 'lead', 'manager', 'director', 'executive'];

// Word boundaries that also work next to accented letters (JS \b is ASCII-only).
const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const words = (alts) => new RegExp(`${B}(?:${alts})${E}`, 'iu');
// Roman numerals / grade markers count only as a separate token at the end of the title or before a
// separator: "Software Engineer III", "Analyst II - Finance" (not "Part I of", not "IV therapy").
const GRADE_END = '(?=\\s*(?:$|[,(\\-–—|/:;]))';
// ...preceded by a word or a dash: "Engineer III", "Specialist - II".
const GRADE_START = '(?<=[\\p{L})]\\s+|[-–—]\\s*)';

// Phrases naming SOMEONE ELSE's level ("Executive Assistant to the CEO", "Engineer, Office of the CTO")
// are cut from the title before matching.
const STRIP_RX = /\b(?:(?:assistant|support|aide|reporting|reports|report|staff|partner|pa|ea)\s+to\b.*$|(?<=(?:executive|personal|administrative|admin|office|team)\s+assistant)\b.*$|office\s+of\s+the\s+\S+|to\s+the\s+(?:ceo|cto|cfo|coo|founders?|president|chairman|chair|md|vp|svp|evp|director|board)\b.*$)/i;

// "Product Manager", "Account Manager", "Project Manager"... are individual-contributor titles, not
// people managers: their "manager" is not a level marker (an explicit "Senior"/"Lead" still counts).
const IC_MANAGER = '(?:product|project|program|programme|account|accounts|key account|technical account|customer success|client success|'
  + 'success|partner|partnerships?|relationship|territory|community|social media|content|case|care|property|campaign|release|'
  + 'delivery|product marketing|scrum|channel|alliance|alliances|engagement|implementation|onboarding|solutions?)';

const STAFF_IC = '(?:engineer|engineering|software|developer|scientist|researcher|research|designer|design|architect|data|machine|ml|ai|'
  + 'product|security|site|sre|devops|frontend|front[- ]end|backend|back[- ]end|full[- ]?stack|infrastructure|platform|applied|'
  + 'technical|ux|ui|mobile|ios|android|systems?|hardware|firmware|analytics|analyst|quant|quantitative|program manager|technologist)';

const SENIORITY_RULES = [
  ['intern', words(
    'intern(?:ship)?s?(?!\\s+(?:program|programme|recruit|coordinator|manager|hiring|housing|experience team))|interne?s?(?=\\s*\\()|co-op|coop(?=\\s+(?:student|term|position|program|placement))'
    + '|trainee(?:ship)?s?|apprentice(?:ship)?s?|pre-apprentice|werkstudent(?:in)?|working student|praktikant(?:in)?|praktikum|pflichtpraktikum'
    + '|auszubildende[rn]?|ausbildung|azubi|duales studium|duale[rs]? student(?:in)?|stagiaire|alternant(?:e)?|alternance|apprenti(?:e)?'
    + '|becari[oa]s?|beca|pr[aá]cticas|pasant[ei]a?s?|practicante|stagiair(?:e)?|afstudeer\\p{L}*|meewerkstage|estagi[aá]ri[oa]s?|est[aá]gio'
    + '|jovem aprendiz|aprendiz|stagista|tirocini\\p{L}*|summer student|placement student|industrial placement|year in industry'
    + '|summer (?:associate|analyst)s?')],
  // French / Dutch "Stage" (internship) only where it cannot be the English word ("Stage Manager").
  ['intern', /^stage(?:\s*[-–:|(]|\s+(?:de|d['’]|en|bij|als|in de|chez)\s|\s+(?!(?:manager|management|hand|hands|technician|tech|crew|door|design|designer|director|electrician|carpenter|rigger|lighting|sound|actor|performer|coordinator|assistant|supervisor|lead|operations|engineer|gate|\d)(?![\p{L}]))\p{L})|(?<![\p{L}])stage(?![\p{L}]).*\b(?:h\/f|f\/h|m\/f|m\/v|v\/m)\b/iu],
  ['executive', words(
    'chief(?!\\s+of\\s+staff)(?:\\s+[\\p{L}&-]+){0,4}\\s+(?:officer|executive)|chief executive'
    + '|(?<!vice[\\s-]*)(?<!assistant[\\s-]+)(?<!associate[\\s-]+)pr[eé]sident(?:e|in)?(?!s)|(?:co-?)?founder(?![\'’]?s' + E + ')(?!\\s+(?:associate|office|in residence))'
    + '|svp|evp|senior vice[\\s-]+president|executive vice[\\s-]+president|managing director|managing partner|general partner'
    + '|gesch[aä]ftsf[uü]hrer(?:in)?|vorstand|pdg|(?:directeur g[eé]n[eé]ral|directrice g[eé]n[eé]rale|director general|directora general'
    + '|diretor(?:a)? geral)(?=\\s*(?:$|[,(\\-–—|/]))')], // + CxO acronyms, see CXO_ROLE_RX
  ['manager', /assistant\s+director|asst\.?\s+director|sous[-\s]directeur/i],
  ['director', words(
    'director(?:a)?|directeur|directrice|diretor(?:a)?|direktor(?:in)?|vp|v\\.p\\.|vice[\\s-]+pr[eé]sident(?:e)?|head\\s+of|head\\s*[,:\\-–]'
    + '|bereichsleiter(?:in)?|hoofd|jefe de [aá]rea|responsable de (?:departamento|[aá]rea)')],
  ['manager', words(
    `(?<!${IC_MANAGER}\\s+)(?:manager|mgr\\.?|managerin|managers)|abteilungsleiter(?:in)?|filialleiter(?:in)?|niederlassungsleiter(?:in)?`
    + '|leiter(?:in)?|leitung|responsable|gerente|jefe|jefa|gestor(?:a)?|leidinggevende|chef de service|chef de d[eé]partement')],
  ['lead', words(
    'lead(?![\\s-]+(?:generation|gen|qualification|nurtur\\p{L}*|management|development))|(?<!(?:for|with|at)\\s+(?:an?|the)\\s+(?:[\\p{L}-]+\\s+){0,3})leader|group (?:product|program) manager|team[\\s-]?lead(?:er)?|tech[\\s-]?lead'
    + '|supervisor|supervisora|foreman|forewoman|teamleiter(?:in)?|gruppenleiter(?:in)?|schichtleiter(?:in)?|teamleider|l[ií]der'
    + '|chef d[\'’][eé]quipe|head(?!\\s+(?:office|quarters|count|start))(?=\\s+\\p{L})|encargad[oa]')],
  ['mid', words('semi[\\s-]?senior|ssr')],
  ['senior', words(
    's[eê]nior(?!\\s+(?:living|care|housing|services|center|centre|community|citizens?|residents?))|sr\\.?|snr'
    + `|principal(?!\\s+investigator\\s+assistant)|staff(?=[\\s,-]+${STAFF_IC})|${GRADE_START}(?:iii|iv|v)${GRADE_END}|expert[oa]?|experte|expertin`)],
  ['mid', words(`mid[\\s-]?level|mid[\\s-]?career|mid[\\s-]?senior|intermediate|medior|pleno|confirm[eé]e?|${GRADE_START}ii${GRADE_END}|experienced`)],
  ['entry', words(
    'junior|jr\\.?|jnr|j[uú]nior|entry[\\s-]?level|(?<!data\\s)entry|graduate|grad|new[\\s-]grads?|early[\\s-]career|fresher|freshers'
    + '|berufseinsteiger(?:in)?|absolvent(?:in)?|d[eé]butant(?:e)?|associate(?!\\s+(?:partner|general counsel|professor|dean|principal|director|vice|vp|counsel))'
    + `|${GRADE_START}i${GRADE_END}`)],
];
// A CxO acronym is the role only at the start of the title or of a segment, and not followed by another
// noun: "CTO & Co-Founder", "Interim CFO" yes; "Engineer - CTO Office", "Quality Manager, CMO Oversight" no.
const CXO_ROLE_RX = new RegExp(`(?:^|[,(\\-–—|/&:]\\s*|(?:interim|fractional|acting|group|global|deputy|virtual|part[- ]time|founding|and|&)\\s+)`
  + `(?:ceo|cto|cfo|coo|cpo|cio|ciso|chro|cmo|cso|cdo|caio|cxo)(?=\\s*(?:$|[,)\\-–—|/&:(]|at\\s|for\\s|of\\s|and\\s|&|\\())`, 'iu');

/**
 * Job title -> one of SENIORITY_LEVELS or null. First matching rule wins, in this order: intern,
 * executive, director, manager, lead, senior, mid, entry. null when the title has no level marker
 * (no "mid" guess for unmarked titles).
 * Decisions: "Head of X" = director; VP / Vice President = director, SVP / EVP / Managing Director =
 * executive; "Product/Project/Program/Account... Manager" are individual-contributor titles (no
 * manager level); "Staff" counts as senior only for technical roles ("Staff Engineer", not "Staff Nurse").
 */
export function seniorityOf(title) {
  if (!title) return null;
  let t = String(title);
  if (t.length > 300) t = t.slice(0, 300);
  if (STRIP_RX.test(t)) t = t.replace(STRIP_RX, '');
  for (let i = 0; i < SENIORITY_RULES.length; i += 1) {
    const [level, rx] = SENIORITY_RULES[i];
    if (rx.test(t) || (level === 'executive' && CXO_ROLE_RX.test(t))) return level;
  }
  return null;
}

// ------------------------------------------------------------------ description helpers
const MAX_SCAN = 20000;

// ------------------------------------------------------------------ years of experience
const NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fifteen: 15, twenty: 20, ein: 1, einem: 1, einen: 1, eins: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, fuenf: 5, sechs: 6,
  sieben: 7, acht: 8, zehn: 10, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, dix: 10, uno: 1, dos: 2, tres: 3,
  cuatro: 4, cinco: 5, diez: 10, 'três': 3, um: 1, uma: 1, duas: 2, twee: 2, drie: 3, vijf: 5,
};
const NUM = `(?:\\d{1,2}(?:[.,]5)?|${Object.keys(NUM_WORDS).join('|')})(?:\\s*\\(\\s*\\d{1,2}\\s*\\))?`;
const YEARS = '(?:years?|yrs?|jahre[n]?|jahr|ans|années|años|anos|jaar|anni)';
const YEARS_RX = new RegExp(`${B}(${NUM})\\s*(\\+|plus)?\\s*(?:(?:-|–|—|to|bis|à|a|y|tot|or)\\s*(${NUM})\\s*\\+?\\s*)?(?:full[\\s-]+)?${YEARS}${E}`, 'giu');
const EXP_WORDS_RX = /experience|experienced|\bexp\b|background|track record|hands-on|expertise|professional|industry|working|work\b|in (?:a|an|the|this|similar|related) |berufserfahrung|erfahrung|praxis|exp[ée]rience|experiencia|experi[êe]ncia|ervaring|werkervaring|esperienza|anzianit/i;
// Company words BEFORE the number make it the company's age, not a requirement ("we have 20 years ...").
const COMPANY_AGE_RX = /\b(?:we|we['’]ve|we['’]re|our|ours|us|company|firm|agency|founded|established|since|history|anniversary|heritage|legacy|has been|have been|been around|serving|celebrating|gegründet|seit|fondée?|depuis|fundada|desde|opgericht|sinds)\b/i;
const COMPANY_LEAD_RX = /^\s*(?:with|for|over|since|after|celebrating|boasting|more than|nearly|almost|backed by)\b/i;
const COMPANY_AFTER_RX = /^[^.;\n]{0,50}?(?:,\s*|\s)(?:we|we['’](?:re|ve)|our|has been|have been|is|are)\b/i;
const AGE_AFTER_RX = /^\s*(?:old|of age|alt|oder älter|or older|ago|later|from now|in business|of history|of service|of (?:proven )?success|d['’]âge|de edad)/i;
const NOT_EXP_AFTER_RX = /^\s*(?:contract|commitment|term|lease|stay|warranty|guarantee|tenure|of (?:age|service)|old|alt)\b/i;
const REQ_PREP_RX = /^\s*['’]?\s*(?:of|in|as|with|working|building|leading|managing|doing|documenting|selling|developing|designing|running|across|at|on|within|post|pqe|exp)\b/i;
const CANDIDATE_RX = /\b(?:you|you'll|you've|your|candidates?|applicants?|required|requires?|requirements?|must|should|ideally|preferred|minimum|at least|need|needs|bring|looking for|seeking|qualifications?|hiring|join|role|position|ideal|someone|individual|person|profile|du|sie|ihr|mindestens|vous|votre|usted|tienes|voc[eê]|je|jij|minimaal|minstens)\b/i;
const PREF_RX = /\b(?:preferred|nice[\s-]to[\s-]have|bonus|a plus|is a plus|pluses|desirable|desired|advantage|advantageous|ideally|wünschenswert|von vorteil|un plus|idealmente|deseable|diferencial|pré|pluspunt)\b/i;
const MIN_HEAD_RX = /\b(?:required|requirements|minimum|basic|must|what you(?:'ll)? (?:need|bring)|qualifications|who you are|about you|anforderungen|profil|votre profil|requisitos|requisiti|functie-eisen)\b/i;
const MIN_WORD_RX = /(?:at least|minimum(?: of)?|min\.|a minimum|mindestens|minimal|minimaal|minstens|au moins|minimum de|al menos|m[ií]nimo(?: de)?|pelo menos|no less than)\s*$/i;

const toNum = (s) => {
  const k = String(s).toLowerCase().replace(/\s*\(\s*\d+\s*\)/, '').trim();
  if (k in NUM_WORDS) return NUM_WORDS[k];
  const n = Number(k.replace(',', '.'));
  return Number.isFinite(n) ? Math.floor(n) : null;
};

/**
 * Minimum years of experience a posting asks for, or null. Reads "3+ years", "3-5 years" (3),
 * "at least 5 years", "minimum of 2 years", "5 years of experience" in sentences about the
 * candidate; ignores company-age phrases ("founded 20 years ago", "for over 10 years we have",
 * "our team's 15 years of experience"). Only 0..20. The first requirement wins; requirements under
 * a "preferred / nice to have" heading are used only when no required one exists.
 */
export function yearsExperienceMin(text) {
  if (!text) return null;
  const s = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
  let pref = false;
  let fallback = null;
  for (const line of s.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Section headings switch between required and preferred requirements.
    if (trimmed.length < 90 && !/\d/.test(trimmed) && (/:$/.test(trimmed) || !/[.!?]$/.test(trimmed))) {
      if (PREF_RX.test(trimmed)) pref = true;
      else if (MIN_HEAD_RX.test(trimmed)) pref = false;
    }
    if (!/\d|one|two|three|four|five|six|seven|eight|nine|ten|zwei|drei|deux|trois|dos|tres/i.test(trimmed)) continue;
    for (const sentence of trimmed.split(/(?<=[.!?;])\s+/)) {
      YEARS_RX.lastIndex = 0;
      let m;
      while ((m = YEARS_RX.exec(sentence))) {
        const n = toNum(m[1]);
        if (n === null || n < 0 || n > 20) continue;
        const hi = m[3] ? toNum(m[3]) : null;
        if (hi !== null && (hi < n || hi > 30)) continue;
        const after = sentence.slice(m.index + m[0].length, m.index + m[0].length + 80).replace(/^\s*\([^)]{0,40}\)/, '');
        const head = sentence.slice(0, m.index);
        const before = head.slice(-60);
        if (AGE_AFTER_RX.test(after)) continue;
        if (/(?:up to|upto|no more than|not more than|less than|fewer than|under|max(?:imum)?\.?|bis zu|jusqu['’]à|hasta|até)\s*$/i.test(before)) continue; // a ceiling, not a minimum
        const minWord = MIN_WORD_RX.test(before);
        const expNear = EXP_WORDS_RX.test(after) || EXP_WORDS_RX.test(before);
        // "N years" must be about experience: an experience word next to it, or a requirement shape
        // ("5+ years in B2B sales", "3-5 years as ...", "at least 2 years with ...").
        if (!expNear && !((m[2] || m[3] || minWord) && REQ_PREP_RX.test(after))
          && !(minWord && !NOT_EXP_AFTER_RX.test(after))) continue;
        // Company age: "Founded 20 years ago", "our team has 15 years of experience",
        // "With over 20 years of experience, we ...".
        if (COMPANY_AGE_RX.test(head) && !CANDIDATE_RX.test(head) && !minWord) continue;
        if (COMPANY_LEAD_RX.test(head) && COMPANY_AFTER_RX.test(after)) continue;
        if (/\b(?:combined|collective|cumulative|zusammen)\b/i.test(after.slice(0, 40)) || /\b(?:combined|collective)\s*$/i.test(before)) continue;
        // "6 months to 1 year of experience" -> 0
        const v = /\d+\s*months?\s*(?:to|-|–|or)\s*$/i.test(before) ? 0 : n;
        const isPref = pref || PREF_RX.test(sentence);
        if (!isPref) return v;
        if (fallback === null) fallback = v;
      }
    }
  }
  return fallback;
}

// ------------------------------------------------------------------ salary in the description
export const SALARY_SOURCES = ['structured', 'description'];

// Approximate units per USD, used only for plausibility bounds (not for conversion).
const CUR_FACTOR = {
  USD: 1, EUR: 1, GBP: 1, CHF: 1, CAD: 1.4, AUD: 1.5, NZD: 1.7, SGD: 1.35, HKD: 7.8, SEK: 10.5, NOK: 10.5, DKK: 7,
  PLN: 4, INR: 85, JPY: 150, BRL: 5.5, MXN: 18, ZAR: 18, AED: 3.67, SAR: 3.75, QAR: 3.64, PHP: 58, MYR: 4.5, THB: 35,
  IDR: 16000, KRW: 1400, CZK: 23, HUF: 360, RON: 4.6, TRY: 40, ILS: 3.7, NGN: 1500, KES: 130, EGP: 50, CLP: 950, COP: 4000,
  ARS: 1000, UAH: 41,
};
const CODES = Object.keys(CUR_FACTOR).join('|');
// USD-equivalent bounds per period: [min, max].
const BOUNDS = { year: [3000, 2000000], month: [250, 170000], week: [60, 40000], day: [12, 8000], hour: [2, 1000] };

const CUR_PRE = `(US\\$|CA\\$|C\\$|AU\\$|A\\$|NZ\\$|S\\$|HK\\$|R\\$|MX\\$|${CODES}|€|£|₹|Rs\\.?|¥|\\$)`;
const CUR_POST = `(${CODES}|€|£|zł|euros?|dollars?|pounds?|Euro)`;
const AMOUNT = '(\\d{1,3}(?:[,.\\u00a0\\u202f ’\']\\d{3})+(?:[.,]\\d{1,2})?|\\d{1,7}(?:[.,]\\d{1,2})?)';
const MONEY_RX = new RegExp(`(?<![\\p{L}\\p{N}.,$€£₹])(?:${CUR_PRE}\\s?)?${AMOUNT}(?:\\s?([kK])(?![\\p{L}]))?(?:\\s?${CUR_POST}(?![\\p{L}]))?`, 'gu');
const SYMBOL_CODE = {
  'US$': 'USD', USD: 'USD', 'CA$': 'CAD', C$: 'CAD', CAD: 'CAD', 'AU$': 'AUD', A$: 'AUD', AUD: 'AUD', 'NZ$': 'NZD', NZD: 'NZD',
  S$: 'SGD', SGD: 'SGD', 'HK$': 'HKD', HKD: 'HKD', R$: 'BRL', BRL: 'BRL', 'MX$': 'MXN', MXN: 'MXN', '€': 'EUR', EUR: 'EUR',
  euro: 'EUR', euros: 'EUR', '£': 'GBP', GBP: 'GBP', pound: 'GBP', pounds: 'GBP', '₹': 'INR', INR: 'INR', Rs: 'INR', 'Rs.': 'INR',
  CHF: 'CHF', SEK: 'SEK', NOK: 'NOK', DKK: 'DKK', PLN: 'PLN', 'zł': 'PLN', JPY: 'JPY', '¥': 'JPY', ZAR: 'ZAR',
  $: '$', dollar: '$', dollars: '$',
};
for (const c of Object.keys(CUR_FACTOR)) SYMBOL_CODE[c] = c;
const DOLLAR_BY_COUNTRY = { US: 'USD', PR: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD' };
const RANGE_SEP_RX = /^\s*(?:-|–|—|−|~|to|bis|à|au|a|y|and|e|tot|til|até|hasta|through)\s*$/i;

// Pay vs. non-pay words around an amount. The keyword nearest to the amount decides.
const PAY_WORDS = 'salary|salaries|pay|paid|compensation|comp|base|wage|wages|rate|range|band|earn|earning|earnings|ote|remuneration|hiring range|'
  + 'gehalt|jahresgehalt|bruttojahresgehalt|zieljahresgehalt|vergütung|verguetung|verdienst|lohn|stundenlohn|entgelt|bezahlung|salär|'
  + 'salaire|rémunération|remuneration|rémunéré|brut|salario|sueldo|remuneración|retribución|salário|remuneração|salaris|loon|bruto|'
  + 'retribuzione|stipendio|ral|lpa|ctc|package';
const NONPAY_WORDS = 'differential|differentials|premium|premiums|uplift|uplifts|incentive|incentives|raised|raise|raising|funding|funded|series|valuation|valued|revenue|revenues|arr|turnover|budget|budgets|stipend|stipends|'
  + 'allowance|allowances|bonus|bonuses|equity|stock|rsus?|shares|options|relocation|reimbursement|reimbursed|reimburse|credit|credits|'
  + 'wellness|learning|education|tuition|referral|signing|sign-on|gift|gifts|donation|donations|grant|grants|prize|prizes|award|awards|'
  + 'investment|investments|invested|investors|aum|assets|capital|fund|funds|loan|loans|deposits?|transactions?|processed|gmv|spend|spending|'
  + 'savings|saved|cost|costs|price|prices|pricing|fees?|subscription|insurance|coverage|401|match|matching|rewards?|discount|perks?|'
  + 'contribution|contributions|cover|claims?|sales|market|worth|value|umsatz|finanzierung|chiffre|levée|tickets?|vouchers?|meals?|lunch|'
  + 'restaurants?|chèques?|primes?|mutuelle|\\p{L}*(?:vergoeding|zuschuss|zulage|pauschale|budget)';
const KW_RX = new RegExp(`(?<![\\p{L}])(?:(${PAY_WORDS})|(${NONPAY_WORDS}))(?![\\p{L}])`, 'giu');
const OTE_RX = /\b(?:ote|on[\s-]target|total (?:target )?(?:cash|compensation)|ttc|commission|variable)\b/i;
const MAGNITUDE_RX = /^\s*\+?\s*(?:million|billion|trillion|mio\.?|mrd\.?|mn|bn|m|b|mil|mm|millones|milhões|milliards?|milliarden|crores?|cr|млн|млрд|тыс|万|億|亿)(?![\p{L}])/iu;
const PERIOD_WORDS = [
  ['hour', 'hour|hr|hrs|hourly|stunde|std\\.?|heure|hora|uur|ora|h'],
  ['day', 'day|daily|tag|jour|día|dia|dag|diem'],
  ['week', 'week|wk|weekly|woche|semaine|semana'],
  ['month', 'month|mo|mth|monthly|monat|monatlich|mois|mensuel|mensuelle|mes|mensual|mês|maand|mese|mensili'],
  ['year', 'year|yr|annum|annually|annual|yearly|p\\.?\\s?a\\.?|jahr|jährlich|jaehrlich|an|année|annuel|annuelle|año|anual|ano|jaar|jaarlijks|anno|annui|lpa'],
];
const PERIOD_AFTER_RX = new RegExp(`^\\s*(?:${CUR_POST}\\s*)?(?:\\+\\s*)?(?:\\((?:[^)]{0,20})\\)\\s*)?(?:(?:gross|brutto|bruto|brut|base|fixed)\\s*)?`
  + `(?:(?:per|\\/|a|an|pro|par|por|al|each|every|im|p\\.?|in|by|the)\\s*)*(?:(${PERIOD_WORDS.map((p) => p[1]).join(')|(')}))(?![\\p{L}])`, 'iu');
const PERIOD_BEFORE_RX = /(annual|yearly|annum|jahres|jährlich|annuel|anual|hourly|stunden|horaire|monthly|monats|mensuel|mensual|weekly|daily|day rate|tagessatz)\p{L}*[^.\n]{0,60}$/iu;
const PERIOD_BEFORE_MAP = { annual: 'year', yearly: 'year', annum: 'year', jahres: 'year', 'jährlich': 'year', annuel: 'year', anual: 'year',
  hourly: 'hour', stunden: 'hour', horaire: 'hour', monthly: 'month', monats: 'month', mensuel: 'month', mensual: 'month', weekly: 'week',
  daily: 'day', 'day rate': 'day', tagessatz: 'day' };
const UP_TO_RX = /(?:up to|upto|max(?:imum)?\.?|bis zu|jusqu['’]à|hasta|até|tot|no more than)\s*$/i;
const FROM_RX = /(?:from|starting(?: at| from)?|starts at|at least|minimum(?: of)?|min\.?|ab|à partir de|desde|a partir de|vanaf|beginning at)\s*$/i;
const LAKH_RX = /(?<![\p{L}\p{N}])(\d{1,3}(?:\.\d{1,2})?)\s*(?:(?:-|–|to)\s*(\d{1,3}(?:\.\d{1,2})?)\s*)?(?:lpa|lakhs?(?:\s+per\s+annum)?|lacs?)(?![\p{L}])/giu;

function parseAmount(raw) {
  let s = raw.replace(/[   ’']/g, (c) => (c === ' ' || c === ' ' || c === ' ' || c === '’' || c === "'" ? '' : c));
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, '');
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,2}(?:,\d{2})+,\d{3}$/.test(s)) s = s.replace(/,/g, ''); // Indian grouping 12,00,000
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.');
  else if (/[,.]\d{3}/.test(s)) return null; // mixed grouping we cannot read safely
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Closest keyword before (last) and after (first) an amount: 'pay' | 'nonpay' | null. */
function nearestKind(win, last) {
  KW_RX.lastIndex = 0;
  let kind = null;
  let m;
  while ((m = KW_RX.exec(win))) {
    kind = m[1] ? 'pay' : 'nonpay';
    if (!last) return kind;
  }
  return kind;
}

function periodOf(after, before) {
  const m = PERIOD_AFTER_RX.exec(after);
  if (m) {
    for (let i = 0; i < PERIOD_WORDS.length; i += 1) if (m[i + 2]) return PERIOD_WORDS[i][0];
  }
  const b = PERIOD_BEFORE_RX.exec(before);
  return b ? PERIOD_BEFORE_MAP[b[1].toLowerCase()] || null : null;
}

function resolveCurrency(sym, text, countryCodes) {
  const code = SYMBOL_CODE[sym] ?? SYMBOL_CODE[sym?.toLowerCase?.()] ?? null;
  if (code !== '$') return code;
  // A bare "$": the job's own countries decide when they all use the same dollar, then the text.
  const cur = new Set((countryCodes || []).map((c) => DOLLAR_BY_COUNTRY[c] || 'other'));
  if (cur.size === 1 && !cur.has('other')) return [...cur][0];
  if (/\bUSD\b|(?<![A-Za-z])US\$|U\.S\. dollars?/.test(text)) return 'USD';
  if (/\bCAD\b|(?<![A-Za-z])CA?\$|Canadian dollars?/.test(text)) return 'CAD';
  if (/\bAUD\b|(?<![A-Za-z])AU?\$|Australian dollars?/.test(text)) return 'AUD';
  return 'USD';
}

function plausible(v, cur, period) {
  if (v === null) return true;
  const [lo, hi] = BOUNDS[period];
  const usd = v / (CUR_FACTOR[cur] || 1);
  return usd >= lo && usd <= hi;
}

// Text before an amount, back to the start of its sentence (a heading right above it counts:
// "Annual base salary range:\n\n$186,065 - $218,900"). Asides that name non-pay items are dropped:
// "(excluding equity and bonus)", "plus bonus".
const ASIDE_RX = /\([^)]*\)|\b(?:excluding|not including|excl\.?|exclusive of|plus|in addition to|on top of|as well as)\s[^,.;:\n]*/gi;
const sentenceStart = (s) => {
  const t = s.replace(/\s+$/, '');
  const i = Math.max(t.lastIndexOf('. '), t.lastIndexOf('\n\n'), t.lastIndexOf('! '), t.lastIndexOf('? '));
  return (i < 0 ? t : t.slice(i + 2)).replace(ASIDE_RX, ' ');
};

/**
 * Pay stated in a description -> { salary_min, salary_max, salary_currency, salary_period } or null.
 * Needs a currency (symbol or code) and either a pay word before the amount ("salary", "pay range",
 * "Gehalt", "salaire"...) or an explicit period ("per hour", "/yr", "brutto pro Jahr"). Amounts next to
 * non-pay words (funding, revenue, budget, bonus, equity, stipend...) or followed by million/billion
 * are ignored, as are implausible values for the period. Several ranges with the same currency and
 * period (e.g. per-location pay zones) are merged into one min..max; base pay wins over OTE.
 * @param countryCodes the job's country codes: a bare "$" in a Canada-only job is CAD, etc.
 */
export function salaryFromText(text, countryCodes = []) {
  if (!text) return null;
  const s = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
  if (!/[$€£₹¥]|USD|EUR|GBP|CAD|AUD|INR|CHF|SEK|NOK|DKK|PLN|NZD|SGD|HKD|BRL|MXN|JPY|ZAR|zł|lpa|lakh|lac|euro|dollar|pound/i.test(s)) return null;
  const tokens = [];
  MONEY_RX.lastIndex = 0;
  let m;
  while ((m = MONEY_RX.exec(s))) {
    if (m[0].length === 0) { MONEY_RX.lastIndex += 1; continue; }
    const value = parseAmount(m[2]);
    if (value === null) continue;
    tokens.push({ start: m.index, end: m.index + m[0].length, cur: m[1] || m[4] || null, value: m[3] ? value * 1000 : value, k: Boolean(m[3]) });
  }
  const cands = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const a = tokens[i];
    const b = tokens[i + 1];
    let lo = a;
    let hi = null;
    const c = tokens[i + 2];
    if (b && c && RANGE_SEP_RX.test(s.slice(a.end, b.start)) && RANGE_SEP_RX.test(s.slice(b.end, c.start)) && (a.cur || b.cur || c.cur)
      && a.value <= b.value && b.value <= c.value) {
      hi = { ...c, cur: c.cur || b.cur };
      if (!lo.cur) lo = { ...a, cur: b.cur || c.cur };
      i += 2;
    } else if (b && RANGE_SEP_RX.test(s.slice(a.end, b.start)) && (a.cur || b.cur)) {
      hi = b;
      i += 1;
    }
    const sym = lo.cur || hi?.cur;
    if (!sym) continue;
    let loV = lo.value;
    let hiV = hi ? hi.value : null;
    if (hi && hi.k && !lo.k && loV < 1000) loV *= 1000; // "$120-150K"
    const end = (hi || lo).end;
    const after = s.slice(end, end + 60);
    if (MAGNITUDE_RX.test(after)) continue;
    const before = sentenceStart(s.slice(Math.max(0, lo.start - 140), lo.start));
    const preKind = nearestKind(before, true);
    const postKind = nearestKind(after.slice(0, 40), false);
    const period0 = periodOf(after, before);
    if (preKind === 'nonpay') continue;
    // "+$2.25/hr": an add-on to a rate (shift differential), not the rate itself.
    if (/\+\s*$/.test(s.slice(Math.max(0, lo.start - 3), lo.start))) continue;
    if (preKind === null && !(period0 || postKind === 'pay')) continue;
    if (preKind === null && postKind === 'nonpay' && !period0) continue;
    const cur = resolveCurrency(sym, s, countryCodes);
    if (!cur) continue;
    let period = period0;
    const big = Math.max(loV, hiV ?? 0) / (CUR_FACTOR[cur] || 1);
    if (!period) {
      if (big >= 10000 || lo.k || hi?.k) period = 'year';
      // "Pay range: $21.00 - $24.50" (a pay word, small amounts): an hourly rate.
      else if (preKind === 'pay' && big >= 7 && big <= 200) period = 'hour';
      else continue; // "$5,000": a monthly salary or a one-off amount? leave it
    }
    if (!hi) {
      if (UP_TO_RX.test(before)) { hiV = loV; loV = null; } else if (FROM_RX.test(before)) hiV = null; else hiV = loV;
    }
    if (loV !== null && hiV !== null && (hiV < loV || hiV > loV * 4)) continue;
    if (!plausible(loV, cur, period) || !plausible(hiV, cur, period)) continue;
    cands.push({ lo: loV, hi: hiV, cur, period, ote: OTE_RX.test(before) || OTE_RX.test(after.slice(0, 30)) });
  }
  // Indian "12-18 LPA" / "15 lakhs per annum" (no currency symbol needed).
  LAKH_RX.lastIndex = 0;
  while ((m = LAKH_RX.exec(s))) {
    const lo = Number(m[1]) * 100000;
    const hi = m[2] ? Number(m[2]) * 100000 : lo;
    const before = sentenceStart(s.slice(Math.max(0, m.index - 140), m.index));
    if (nearestKind(before, true) === 'nonpay' || hi < lo) continue;
    if (plausible(lo, 'INR', 'year') && plausible(hi, 'INR', 'year')) cands.push({ lo, hi, cur: 'INR', period: 'year', ote: OTE_RX.test(before) });
  }
  // On-target earnings (base + commission) are not a salary: OTE-only postings get no salary.
  const base = cands.filter((c) => !c.ote);
  if (!base.length) return null;
  const { cur, period } = base[0];
  let lo = null;
  let hi = null;
  for (const c of base) {
    if (c.cur !== cur || c.period !== period) continue;
    if (c.lo !== null) lo = lo === null ? c.lo : Math.min(lo, c.lo);
    if (c.hi !== null) hi = hi === null ? c.hi : Math.max(hi, c.hi);
  }
  const round = (v) => (v === null ? null : Math.round(v * 100) / 100);
  return { salary_min: round(lo), salary_max: round(hi), salary_currency: cur, salary_period: period };
}

// ------------------------------------------------------------------ visa sponsorship
const VISA = '(?:visa|visas|sponsorship|sponsor|sponsored|sponsoring|work permit|work permits|h-?1-?b|h1b|immigration|tn visa|blue card|skilled worker|tier 2|right to work|work authori[sz]ation|visum|visa-unterstützung|arbeitserlaubnis|parrainage|patrocinio|patroc[ií]nio)';
const VISA_NEG_RX = new RegExp([
  `(?:unable|not able|cannot|can't|can not|won't|will not|do not|does not|don't|doesn't|are not|is not|not in a position|no longer|are unable|not currently|not offering|not providing)\\s+(?:to\\s+)?(?:currently\\s+)?(?:able\\s+to\\s+)?(?:provide|offer|support|sponsor|sponsoring|consider|accommodate|assist|be sponsoring|pursue|facilitate|accept)\\b[^.\\n]{0,80}?${VISA}`,
  `\\bno\\s+(?:visa\\s+|immigration\\s+|work\\s+permit\\s+|h-?1-?b\\s+)?sponsorship`,
  `\\bsponsorship\\s+(?:is\\s+|will\\s+)?(?:not|unavailable|n't)`,
  '\\bwithout\\s+(?:the\\s+)?(?:need\\s+(?:for|of)\\s+|requiring\\s+|any\\s+|current\\s+or\\s+future\\s+|employer\\s+|company\\s+|our\\s+)*(?:visa\\s+|immigration\\s+|employment\\s+)?(?:sponsorship|sponsoring|a visa)',
  `\\bnot\\s+(?:eligible|available|able)\\s+(?:for|to\\s+receive)\\s+(?:visa\\s+|immigration\\s+)?(?:sponsorship|${VISA})`,
  `\\b(?:does|do|will|can|cannot|can't)\\s+not\\s+(?:be\\s+)?(?:sponsor|sponsoring|provide sponsorship|offer sponsorship)`,
  '\\b(?:require|requires|requiring|need|needs)\\s+(?:visa\\s+|immigration\\s+)?sponsorship[^.\\n]{0,80}(?:not be considered|ineligible|not eligible|cannot be considered|will not)',
  '\\bvisa\\s+sponsorship\\s*(?::|-|–)\\s*(?:no|not available|none)\\b',
  '\\b(?:kein(?:e|en)?|ohne)\\s+(?:visa|visum|visa-?unterstützung|arbeitserlaubnis-?unterstützung|sponsoring)',
  '\\b(?:pas de|aucun)\\s+(?:parrainage|sponsoring|visa)',
  '\\bne\\s+(?:pouvons|pouvez|peut)\\s+pas\\s+(?:parrainer|sponsoriser|fournir de visa)',
  '\\bgeen\\s+(?:visum|sponsoring|sponsorship)',
  '\\bno\\s+(?:ofrecemos|podemos ofrecer|patrocinamos)\\s+(?:visa|patrocinio)',
].join('|'), 'i');
const VISA_POS_RX = new RegExp([
  '\\b(?:visa|immigration|h-?1-?b|work permit)\\s+(?:sponsorship|support|assistance|transfer|transfers)\\s+(?:is\\s+|are\\s+|will be\\s+)?(?:available|provided|offered|possible|welcome)',
  '\\b(?:we|will|can|able to|happy to|glad to|open to|do|does|is able to|are able to|company will|employer will)\\s+(?:also\\s+)?(?:offer|provide|support|sponsor|sponsoring|assist with)\\s+(?:you\\s+with\\s+)?(?:visa|visas|work visas|h-?1-?b|sponsorship|work permits?|immigration)',
  '\\b(?:offer|offers|offering|provide|provides|providing|including|includes|plus|with|and|full|including full)\\s+(?:relocation\\s+(?:and|&)\\s+)?(?:visa|immigration|h-?1-?b)\\s+(?:sponsorship|support|assistance)',
  '\\bh-?1-?b\\s+(?:sponsorship|transfers?|visa sponsorship)\\s+(?:available|welcome|offered|provided|supported|is available|are welcome)',
  '\\b(?:visa|h-?1-?b)\\s+sponsorship\\s+(?:for\\s+(?:the\\s+)?right\\s+candidate|available)',
  '\\bsponsorship\\s+(?:is\\s+)?(?:available|provided|offered)\\b',
  '\\bwe\\s+sponsor\\s+(?:work\\s+)?(?:visas|h-?1-?b|work permits)',
  '\\b(?:relocation|umzugs?)\\s*(?:and|&|\\+|/|und)\\s*(?:visa|visum)\\s*(?:support|sponsorship|assistance|unterstützung)?',
  '\\bvisa[-\\s]?unterstützung|unterstützung\\s+(?:beim|bei der)\\s+(?:visum|visa)',
  '\\b(?:aide|accompagnement)\\s+(?:au|pour le)\\s+visa',
  '\\bpatrocinio\\s+de\\s+visa\\s+(?:disponible|ofrecido)',
  '\\b(?:committed to|will|can|happy to|glad to|able to|open to)\\s+sponsor(?:ing|s)?\\s+(?:work\\s+|employment\\s+)?(?:visas?|h-?1-?bs?|work permits?)\\b',
  // A benefits bullet that is just "Visa sponsorship" / "Work visa" / "Visa support".
  '^\\W*(?:work\\s+visa|visa\\s+sponsor(?:ship)?|visa\\s+support|visa\\s+assistance)(?:\\s*(?:[&+,]|and)\\s*\\p{L}[^:\\n]{0,60})?\\s*$',
].join('|'), 'iu');
const HEDGE_RX = /\b(?:may|might|could|possibly|potentially|case[\s-]by[\s-]case|in some cases|limited|depending|depends|considered|not guaranteed)\b/i;
const NEGATION_RX = /\b(?:not|no|unable|cannot|can't|won't|without|n't|never|nor)\b|n't\b/i;

/**
 * Visa sponsorship stated in a description: true ("visa sponsorship available", "we sponsor visas",
 * "H-1B transfers welcome"), false ("unable to sponsor", "no visa sponsorship", "must be authorized to
 * work ... without sponsorship"), null when not mentioned or hedged ("may be considered"). A negative
 * statement anywhere wins over a positive one.
 */
export function visaSponsorship(text) {
  if (!text) return null;
  const s = text.length > MAX_SCAN ? text.slice(0, MAX_SCAN) : text;
  if (!/visa|sponsor|permit|h-?1-?b|immigra|visum|parrainage|patroc/i.test(s)) return null;
  if (VISA_NEG_RX.test(s)) return false;
  for (const sentence of s.split(/(?<=[.!?;])\s+|\n+/)) {
    if (!VISA_POS_RX.test(sentence)) continue;
    if (NEGATION_RX.test(sentence) || HEDGE_RX.test(sentence)) continue;
    return true;
  }
  return null;
}

// ------------------------------------------------------------------ row enrichment
/**
 * Adds the enrichment fields to an output row in place: seniority (title, always), salary_source,
 * and - only when `description` (the full text) is available - years_experience_min, visa_sponsorship
 * and the salary_* fields from the text when the ATS gave no structured salary. Structured values are
 * never overwritten.
 */
export function enrichRow(row, description) {
  row.seniority = seniorityOf(row.title);
  const structured = row.salary_min !== null && row.salary_min !== undefined
    || row.salary_max !== null && row.salary_max !== undefined;
  row.salary_source = structured ? 'structured' : null;
  row.years_experience_min = null;
  row.visa_sponsorship = null;
  if (!description) return row;
  if (!structured) {
    const sal = salaryFromText(description, row.country_codes);
    if (sal) {
      Object.assign(row, sal);
      row.salary_source = 'description';
    }
  }
  row.years_experience_min = yearsExperienceMin(description);
  row.visa_sponsorship = visaSponsorship(description);
  return row;
}
