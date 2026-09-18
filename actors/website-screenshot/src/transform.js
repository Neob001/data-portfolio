// Pure logic: URL validation/normalization, dataset key naming, error
// classification, cookie-banner CSS and device presets. No browser here.

import { createHash } from 'node:crypto';

/** "example.com" -> "https://example.com/"; rejects non-http(s) and junk. */
export function normalizeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Normalize + dedupe a raw URL list, preserving first-seen order. Returns
 * { valid: string[], invalid: string[] } where invalid holds the raw inputs
 * that failed normalization (each reported once, even if repeated). */
export function dedupeUrls(rawUrls) {
  const valid = [];
  const invalid = [];
  const seenValid = new Set();
  const seenInvalid = new Set();
  for (const raw of rawUrls || []) {
    const normalized = normalizeUrl(raw);
    if (normalized) {
      if (!seenValid.has(normalized)) {
        seenValid.add(normalized);
        valid.push(normalized);
      }
    } else {
      const key = String(raw);
      if (!seenInvalid.has(key)) {
        seenInvalid.add(key);
        invalid.push(key);
      }
    }
  }
  return { valid, invalid };
}

/** Dataset/key-value-store key for a screenshot: sha1(url + format), plus a
 * matching file extension. Stable across runs so retries overwrite in place. */
export function screenshotKey(url, format) {
  const ext = format === 'jpeg' ? 'jpg' : 'png';
  const hash = createHash('sha1').update(`${url}|${format}`).digest('hex');
  return `${hash}.${ext}`;
}

export function contentTypeFor(format) {
  return format === 'jpeg' ? 'image/jpeg' : 'image/png';
}

/** Public URL of a default-key-value-store record. */
export function screenshotUrlFor(storeId, key) {
  return `https://api.apify.com/v2/key-value-stores/${storeId}/records/${key}`;
}

export const ERROR_CODES = ['invalid_url', 'navigation_timeout', 'dns_error', 'http_error', 'blocked'];

const DNS_MARKERS = ['ERR_NAME_NOT_RESOLVED', 'ENOTFOUND', 'ERR_ADDRESS_UNREACHABLE'];
const TIMEOUT_MARKERS = ['TimeoutError', 'Navigation timeout', 'ERR_TIMED_OUT', 'timeout'];
const BLOCKED_MARKERS = ['ERR_BLOCKED_BY_CLIENT', 'ERR_BLOCKED_BY_RESPONSE', 'ERR_BLOCKED_BY_ORB'];

/**
 * Classify a navigation failure into one of ERROR_CODES (never null; call
 * sites only invoke this once a failure has actually happened).
 * `statusCode` is the final HTTP status if a response was received at all.
 */
export function classifyNavigationError(error, statusCode) {
  if (statusCode) {
    if (statusCode === 403 || statusCode === 429) return 'blocked';
    if (statusCode >= 400) return 'http_error';
  }
  const message = `${error?.name || ''} ${error?.message || error || ''}`;
  if (BLOCKED_MARKERS.some((m) => message.includes(m))) return 'blocked';
  if (DNS_MARKERS.some((m) => message.includes(m))) return 'dns_error';
  if (TIMEOUT_MARKERS.some((m) => message.includes(m))) return 'navigation_timeout';
  return 'http_error';
}

/** Common consent/cookie-banner selectors, hidden (never auto-clicked). */
export const COOKIE_BANNER_SELECTORS = [
  '#onetrust-banner-sdk',
  '#onetrust-consent-sdk',
  '.cc-window',
  '.cc-banner',
  '#cookie-banner',
  '#cookieConsent',
  '.cookie-consent',
  '.cookie-banner',
  '.cookie-notice',
  '#CybotCookiebotDialog',
  '.qc-cmp2-container',
  '#qc-cmp2-container',
  '#sp_message_container',
  '.osano-cm-window',
  '#gdpr-banner',
  '.gdpr-banner',
  '#didomi-host',
  '[id*="cookie"][class*="banner"]',
  '[class*="cookie"][class*="banner"]',
  '[id*="cookie"][id*="consent"]',
  '[aria-label*="cookie" i]',
];

/** CSS that hides (not clicks) common cookie/consent banners. */
export function cookieBannerCss() {
  return `${COOKIE_BANNER_SELECTORS.join(',\n')} { display: none !important; visibility: hidden !important; }`;
}

const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/125.0.0.0 Mobile Safari/537.36';

/** Puppeteer viewport (+ optional userAgent) for the requested device/size. */
export function deviceViewport(input) {
  const { device, viewportWidth = 1280, viewportHeight = 800 } = input || {};
  if (device === 'mobile') {
    return {
      viewport: { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
      userAgent: MOBILE_USER_AGENT,
    };
  }
  return {
    viewport: { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    userAgent: null,
  };
}

/** Assemble one dataset row. `capture` is null for a failure with no attempt made yet. */
export function buildRow({ url, format, ok, statusCode = null, error = null, finalUrl = null, capture = null }) {
  return {
    url,
    final_url: finalUrl,
    status_code: statusCode,
    ok,
    error,
    screenshot_key: capture?.key ?? null,
    screenshot_url: capture?.screenshotUrl ?? null,
    width: capture?.width ?? null,
    height: capture?.height ?? null,
    bytes: capture?.bytes ?? null,
    format,
    page_title: capture?.pageTitle ?? null,
    taken_at: capture ? capture.takenAt : null,
  };
}
