// Pure transforms for Open Food Facts (product API v2 + search.openfoodfacts.org).

export const LICENSE = 'ODbL 1.0 (Open Food Facts contributors)';
export const LICENSE_URL = 'https://opendatacommons.org/licenses/odbl/1-0/';

// Only product facts: contributor/editor usernames are deliberately never requested.
export const FIELDS = [
  'code', 'product_name', 'generic_name', 'brands', 'quantity', 'serving_size', 'categories_tags',
  'countries_tags', 'labels_tags', 'packaging_tags', 'ingredients_text', 'allergens_tags', 'traces_tags',
  'nutriscore_grade', 'nova_group', 'ecoscore_grade', 'nutriments', 'image_url', 'last_modified_t', 'lang',
].join(',');

const NUTRIENTS = {
  energy_kcal_100g: 'energy-kcal_100g',
  fat_100g: 'fat_100g',
  saturated_fat_100g: 'saturated-fat_100g',
  carbohydrates_100g: 'carbohydrates_100g',
  sugars_100g: 'sugars_100g',
  fiber_100g: 'fiber_100g',
  proteins_100g: 'proteins_100g',
  salt_100g: 'salt_100g',
  sodium_100g: 'sodium_100g',
};

/** EAN-8 / UPC-A / EAN-13 / GTIN-14 digits only, or null. */
export function normalizeBarcode(raw) {
  const s = String(raw ?? '').replace(/[\s-]/g, '');
  return /^\d{8,14}$/.test(s) ? s : null;
}

/** "United States" / "united-states" / "en:united-states" -> "en:united-states"; null when empty/invalid. */
export function countryTag(raw) {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return null;
  const slug = s.replace(/^en:/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug ? `en:${slug}` : null;
}

/**
 * Search-a-licious query string. Lucene syntax is stripped from user terms; with a
 * country filter every word needs an explicit AND (grouping with parentheses returns 0 hits).
 */
export function buildSearchQuery(terms, country) {
  const words = String(terms ?? '')
    .replace(/[+\-!(){}[\]^"~*?:\\/&|]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(AND|OR|NOT)$/.test(w));
  if (words.length === 0) return null;
  const tag = countryTag(country);
  return tag ? [`countries_tags:"${tag}"`, ...words].join(' AND ') : words.join(' ');
}

/** "en:peanut-butters" -> "peanut-butters" (language prefix dropped). */
function untag(tags) {
  return Array.isArray(tags) ? [...new Set(tags.map((t) => String(t).replace(/^[a-z]{2,3}:/, '')))] : [];
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function grade(v) {
  const s = String(v ?? '').toLowerCase();
  return /^[a-e]$/.test(s) ? s : null;
}

/** v2 product response -> product object, or null when not found. */
export function parseProductResponse(response) {
  if (!response || typeof response !== 'object' || !('status' in response)) {
    const e = new Error('Unexpected Open Food Facts product response: status missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  return response.status === 1 && response.product ? response.product : null;
}

/** Search response -> { hits, pageCount }. */
export function parseSearchResponse(response) {
  if (!response || !Array.isArray(response.hits)) {
    const e = new Error('Unexpected Open Food Facts search response: hits missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  return { hits: response.hits, pageCount: Number(response.page_count) || 1 };
}

/** Product (from either endpoint) -> flat record (without query / stamp). */
export function toProductRecord(p) {
  const n = p.nutriments || {};
  const brands = Array.isArray(p.brands) ? p.brands : String(p.brands ?? '').split(',');
  const record = {
    found: true,
    barcode: String(p.code),
    product_name: p.product_name || p.generic_name || null,
    brands: brands.map((b) => b.trim()).filter(Boolean),
    quantity: p.quantity || null,
    serving_size: p.serving_size || null,
    categories: untag(p.categories_tags),
    countries: untag(p.countries_tags),
    labels: untag(p.labels_tags),
    packaging: untag(p.packaging_tags),
    ingredients_text: p.ingredients_text || null,
    allergens: untag(p.allergens_tags),
    traces: untag(p.traces_tags),
    nutriscore_grade: grade(p.nutriscore_grade),
    nova_group: num(p.nova_group),
    ecoscore_grade: grade(p.ecoscore_grade),
  };
  for (const [out, key] of Object.entries(NUTRIENTS)) record[out] = num(n[key]);
  record.image_url = p.image_url || null;
  record.last_modified_at = p.last_modified_t ? new Date(p.last_modified_t * 1000).toISOString() : null;
  record.product_url = `https://world.openfoodfacts.org/product/${encodeURIComponent(String(p.code))}`;
  record.license = LICENSE;
  record.license_url = LICENSE_URL;
  return record;
}

/** A product with neither a name nor any nutrition value is an empty shell: never charged. */
export function hasPayload(record) {
  return Boolean(record.product_name) || Object.keys(NUTRIENTS).some((k) => record[k] !== null);
}
