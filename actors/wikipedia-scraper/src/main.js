import { Actor } from 'apify';
import { fetchJson, rateLimiter } from './lib/http.js';
import { stamp } from './lib/records.js';
import { writeRunSummary } from './lib/run_summary.js';
import {
  isValidLanguage, parseArticleRef, chunk, parseSearch, mergeQueryResponse, resolvePage,
  isHumanClaims, toArticleRecord, parseFullText,
} from './transform.js';

// Wikimedia User-Agent policy: identify the tool and a contact URL.
const HEADERS = { 'User-Agent': 'factpipe-wikipedia-scraper/0.1 (https://apify.com/factpipe/wikipedia-scraper)' };
const PAGE_PROPS = {
  action: 'query', format: 'json', formatversion: '2', redirects: '1',
  prop: 'extracts|pageprops|coordinates|info|pageimages|description|categories|revisions',
  exintro: '1', explaintext: '1', exlimit: 'max', inprop: 'url', ppprop: 'wikibase_item|disambiguation',
  piprop: 'thumbnail', pithumbsize: '640', coprimary: 'primary', clshow: '!hidden', cllimit: 'max',
  rvprop: 'timestamp|ids',
};

await Actor.init();
const started = Date.now();
const input = (await Actor.getInput()) ?? {};
const {
  articles = [], searchQueries = [], language = 'en', maxArticlesPerSearch = 10, fullText = false,
} = input;

if ((!Array.isArray(articles) || articles.length === 0) && (!Array.isArray(searchQueries) || searchQueries.length === 0)) {
  throw new Error('Provide "articles" (titles or Wikipedia URLs) and/or "searchQueries".');
}
if (!isValidLanguage(language)) throw new Error(`Invalid "language" code: ${language}. Use e.g. en, de, fr, es.`);

const limit = rateLimiter(200);
const api = async (lang, params) => {
  await limit();
  const qs = new URLSearchParams(params).toString();
  const url = `https://${lang}.wikipedia.org/w/api.php?${qs}`;
  return { url, body: await fetchJson(url, { headers: HEADERS }) };
};

let pushed = 0;
let charged = 0;
const seen = new Set();

async function finish(extra = {}) {
  await writeRunSummary(Actor, { rows: pushed, charged_events: charged, duration_ms: Date.now() - started, ...extra });
}

try {
  // 1. Collect article refs (explicit + search hits), preserving the user's query per ref.
  const refs = [];
  for (const raw of articles) {
    const ref = parseArticleRef(raw, language);
    if (!ref) {
      await Actor.pushData(stamp({ query: String(raw), found: false, error: 'invalid_article_reference' }, 'https://wikipedia.org'));
      continue; // not charged
    }
    refs.push({ query: String(raw), ...ref });
  }
  const perSearch = Math.max(1, Math.min(500, Number(maxArticlesPerSearch) || 10));
  for (const q of searchQueries) {
    if (!String(q || '').trim()) continue;
    const { url, body } = await api(language, {
      action: 'query', format: 'json', formatversion: '2', list: 'search', srsearch: String(q), srnamespace: '0',
      srlimit: String(perSearch), srprop: '',
    });
    const titles = parseSearch(body);
    if (titles.length === 0) {
      await Actor.pushData(stamp({ query: String(q), found: false, error: 'no_search_results' }, url));
    }
    for (const title of titles) refs.push({ query: String(q), lang: language, title });
  }

  // 2. Fetch page metadata in batches of 20 per language, following continuations.
  const byLang = new Map();
  for (const r of refs) byLang.set(r.lang, [...(byLang.get(r.lang) || []), r]);

  for (const [lang, langRefs] of byLang) {
    for (const batch of chunk(langRefs, 20)) {
      const acc = { pages: new Map(), aliases: new Map() };
      const titles = [...new Set(batch.map((r) => r.title))];
      let cont = {};
      let sourceUrl = null;
      for (let i = 0; i < 20; i++) {
        const { url, body } = await api(lang, { ...PAGE_PROPS, titles: titles.join('|'), ...cont });
        sourceUrl = sourceUrl || url;
        mergeQueryResponse(acc, body);
        if (!body.continue) break;
        cont = body.continue;
      }

      // 3. Emit one record per ref: not-found and person articles are never charged.
      for (const ref of batch) {
        const page = resolvePage(acc, ref.title);
        if (!page || page.missing || page.invalid || page.ns !== 0) {
          await Actor.pushData(stamp({ query: ref.query, language: lang, title: ref.title, found: false, error: 'article_not_found' }, sourceUrl));
          continue;
        }
        const key = `${lang}:${page.pageid}`;
        if (seen.has(key)) continue; // same article reached twice in one run: delivered and charged once
        seen.add(key);

        const qid = page.pageprops?.wikibase_item;
        if (qid) {
          await limit();
          const claims = await fetchJson(
            `https://www.wikidata.org/w/api.php?action=wbgetclaims&format=json&entity=${encodeURIComponent(qid)}&property=P31`,
            { headers: HEADERS },
          );
          if (isHumanClaims(claims)) {
            // Policy: no person profiles. Biographies are skipped and never charged.
            await Actor.pushData(stamp({ query: ref.query, language: lang, title: page.title, found: false, error: 'excluded_person_article' }, page.canonicalurl || sourceUrl));
            continue;
          }
        }

        let text = null;
        if (fullText) {
          const { body } = await api(lang, {
            action: 'query', format: 'json', formatversion: '2', prop: 'extracts', explaintext: '1', pageids: String(page.pageid),
          });
          text = parseFullText(body);
        }
        await Actor.pushData(stamp({ query: ref.query, ...toArticleRecord(page, lang, text) }, sourceUrl));
        pushed += 1;
        const { eventChargeLimitReached } = await Actor.charge({ eventName: 'article-result' });
        charged += 1;
        if (eventChargeLimitReached) {
          await finish();
          await Actor.exit('Charge limit reached', { statusMessage: 'Charge limit reached' });
        }
      }
    }
  }
} catch (e) {
  await finish({ errors: 1, failure_class: e.failureClass || 'unknown' });
  throw e;
}

await finish();
await Actor.exit();
