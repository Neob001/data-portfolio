// Keyword relevance ranking (owner approval "J1 ranking", 2026-09-25) and a bounded top-K collector.
//
// Every keyword is matched at the best of three levels:
//   title       - the phrase occurs in the job title at a word start ("engineer" ~ "Engineering Manager")
//   department  - the phrase, or every word of it, occurs in the department / team
//   description - every word of it occurs in the job's vocabulary (title + department/team + the first
//                 ~1,500 description characters, i.e. the index `kw` field)
// match_score (0-100) = tier base + up to 10 points for the share of keywords matched anywhere:
//   every keyword in the title  base 90 -> always 100
//   some keyword in the title   base 60 -> 60..70
//   department / team match     base 40 -> 40..50
//   description-only match      base 20 -> 20..30
// Ties are broken by the newest posted_at, then job_id (a total order, so paging by rank is exact).
import { compileKeyword, normText, jobKeywordTokens } from './keywords.js';

export const KEYWORD_SCOPES = ['title', 'title_and_department', 'title_and_description'];
export const MATCHED_IN = ['title', 'department', 'description', null];

const NO_KEYWORDS = Object.freeze({ score: null, matched_in: null });

const hasWord = (set, t) => set.has(t) || set.has(`${t}s`) || set.has(`${t}es`);

/**
 * keywords -> rank(job) returning { score, matched_in } when the job passes the keyword filter, or
 * null when it does not. Without keywords every job passes with { score: null, matched_in: null }.
 * @param keywords string[]  @param match 'any'|'all'  @param scope one of KEYWORD_SCOPES
 */
export function compileRanker(keywords, match = 'any', scope = 'title_and_description') {
  const kws = (keywords || []).map(compileKeyword).filter((k) => k.phrase);
  if (!kws.length) return () => NO_KEYWORDS;
  const useDept = scope !== 'title';
  const useDesc = scope === 'title_and_description';
  const n = kws.length;
  return (job) => {
    const titleNorm = normText(job.title);
    const titlePad = ` ${titleNorm}`;
    let dept = null;
    let vocab = null;
    let t = 0;
    let d = 0;
    let s = 0;
    for (const k of kws) {
      if (titlePad.includes(` ${k.phrase}`)) { t += 1; continue; }
      if (useDept) {
        if (!dept) {
          const text = normText([job.department, job.team].filter(Boolean).join(' '));
          dept = { pad: ` ${text}`, words: new Set(text.split(' ').filter(Boolean)) };
        }
        if (dept.pad.includes(` ${k.phrase}`) || k.tokens.every((w) => hasWord(dept.words, w))) { d += 1; continue; }
      }
      if (useDesc) {
        // Index rows carry `kw` (job words + the board's shared words); live rows are tokenized here.
        if (!vocab) {
          vocab = new Set([...titleNorm.split(' '),
            ...(typeof job.kw === 'string' ? job.kw.split(' ') : jobKeywordTokens(job))]);
        }
        if (k.tokens.every((w) => hasWord(vocab, w))) { s += 1; continue; }
      }
      if (match === 'all') return null;
    }
    const hits = t + d + s;
    if (!hits) return null;
    const base = t === n ? 90 : t ? 60 : d ? 40 : 20;
    return {
      score: base + Math.round((10 * hits) / n),
      matched_in: t ? 'title' : d ? 'department' : 'description',
    };
  };
}

/** Rank order: higher match_score first, then newest posted_at, then job_id. <0 when a ranks before b. */
export function rankCmp(a, b) {
  const sa = a.match_score ?? -1;
  const sb = b.match_score ?? -1;
  if (sa !== sb) return sb - sa;
  const pa = a.posted_at || '';
  const pb = b.posted_at || '';
  if (pa !== pb) return pa < pb ? 1 : -1;
  return a.job_id < b.job_id ? -1 : a.job_id > b.job_id ? 1 : 0;
}

/** Newest-first order used when no keywords are given. */
export function newestCmp(a, b) {
  return (b.posted_at || '').localeCompare(a.posted_at || '') || a.job_id.localeCompare(b.job_id);
}

/** Keeps the best `k` items under `cmp` in a binary heap whose root is the worst kept item. */
export class TopK {
  constructor(k, cmp = rankCmp) {
    this.k = Math.max(1, k);
    this.cmp = cmp;
    this.heap = [];
    this.dropped = 0; // candidates rejected or evicted: > 0 means there is more below the kept set
  }

  get size() { return this.heap.length; }

  // "worse(a, b)": a ranks after b.
  worse(a, b) { return this.cmp(a, b) > 0; }

  push(item) {
    const h = this.heap;
    if (h.length < this.k) {
      h.push(item);
      let i = h.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (!this.worse(h[i], h[p])) break;
        [h[i], h[p]] = [h[p], h[i]];
        i = p;
      }
      return true;
    }
    this.dropped += 1;
    if (!this.worse(h[0], item)) return false; // not better than the worst kept item
    h[0] = item;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && this.worse(h[l], h[m])) m = l;
      if (r < h.length && this.worse(h[r], h[m])) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m], h[i]];
      i = m;
    }
    return true;
  }

  /** Kept items, best first. */
  sorted() { return [...this.heap].sort(this.cmp); }
}
