// Compact keyword field (`kw`) used by the slim search index, and keyword matching over it.
//
// kw = distinct lowercase words (stopwords removed) from department, team and the first
// KW_SOURCE_CHARS characters of the description. Words already in the title are left out (the
// title is always searched), and so are words shared by most postings of the same board (company
// boilerplate): those are stored once per board in the shard header and merged back at read time.

export const KW_SOURCE_CHARS = 1500;
export const KW_MAX_CHARS = 500; // per-job budget after removing title and board-shared words
export const BOARD_KW_MAX_CHARS = 1500;

const STOPWORDS = new Set((
  'a an the and or of to in on for with at by from as is are be we you our your will this that it its their they them us '
  + 'can all any have has more who what how into about than also such other not but so if do may per via etc was were been '
  + 'being i me my he she his her there here which while where when would should could must just only own same very each '
  + 'both few most some no nor too under over again further then once why because until against between through during '
  + 'before after above below up down out off am had having does did doing '
  // frequent Dutch / German / French / Spanish function words
  + 'de la le les et en der die das und een het van ist sie wir ein eine zu mit im fur auf des du pour avec dans y el los las '
  + 'con por para del je ons onze wij je jij bent zijn te om op met voor als dat bij'
).split(' '));

/** Lowercase, strip accents and punctuation (keeps + and # for c++ / c#). */
export function normText(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+#]+/g, ' ').trim();
}

const words = (s) => normText(s).split(' ').filter(Boolean);

/** Distinct keyword tokens of one job (title excluded), in first-seen order. */
export function jobKeywordTokens(job, descriptionText = job.description_text) {
  const title = new Set(words(job.title));
  const seen = new Set();
  const out = [];
  const src = [job.department, job.team, String(descriptionText || '').slice(0, KW_SOURCE_CHARS)].filter(Boolean).join(' ');
  for (const w of words(src)) {
    if (w.length < 2 || STOPWORDS.has(w) || title.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

function capJoin(tokens, max) {
  let s = '';
  for (const t of tokens) {
    if (s.length + t.length + (s ? 1 : 0) > max) break;
    s += (s ? ' ' : '') + t;
  }
  return s;
}

/**
 * Board-level factoring: words present in >= 60% of a board's postings (min 3 postings) go to the
 * board's shared kw; each job keeps its own remaining words (capped).
 * @returns { boardKw: string, jobKw: string[] } jobKw aligned with jobs
 */
export function factorBoardKeywords(jobs) {
  const toks = jobs.map((j) => jobKeywordTokens(j));
  let common = new Set();
  if (jobs.length >= 3) {
    const cnt = new Map();
    for (const t of toks) for (const w of t) cnt.set(w, (cnt.get(w) || 0) + 1);
    common = new Set([...cnt].filter(([, c]) => c >= jobs.length * 0.6).map(([w]) => w));
  }
  return {
    boardKw: capJoin([...common], BOARD_KW_MAX_CHARS),
    jobKw: toks.map((t) => capJoin(t.filter((w) => !common.has(w)), KW_MAX_CHARS)),
  };
}

/** A keyword phrase -> { phrase: normalized text, tokens: non-stopword words }. */
export function compileKeyword(k) {
  const phrase = normText(k);
  const tokens = phrase.split(' ').filter((w) => w && !STOPWORDS.has(w));
  return { phrase, tokens: tokens.length ? tokens : phrase.split(' ').filter(Boolean) };
}

/**
 * Keyword test for one job.
 *  - scope "title": the normalized phrase occurs in the title at a word start
 *    ("engineer" matches "Engineering Manager", "ai" does not match "Maintenance").
 *  - scope "title_and_description": that, or every (non-stopword) word of the keyword occurs as a
 *    whole word (or its plural) in the job's title/department/team/first-1,500-description-chars
 *    vocabulary.
 * `vocab` is a lazily built Set of the job's words (title + kw).
 */
export function keywordHit(kwc, titleNorm, vocab, scope) {
  if (!kwc.phrase) return false;
  if (` ${titleNorm}`.includes(` ${kwc.phrase}`)) return true;
  if (scope === 'title') return false;
  const v = vocab();
  return kwc.tokens.every((t) => v.has(t) || v.has(`${t}s`) || v.has(`${t}es`));
}
