// Pure logic: Lighthouse result (LHR) -> flat audit record. No browser here.

// Core Web Vitals thresholds (good / poor). TBT is the lab proxy for INP.
export const THRESHOLDS = {
  lcp_ms: [2500, 4000],
  cls: [0.1, 0.25],
  tbt_ms: [200, 600],
  fcp_ms: [1800, 3000],
};

export function rate(metric, value) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const [good, poor] = THRESHOLDS[metric];
  return value <= good ? 'good' : value <= poor ? 'needs_improvement' : 'poor';
}

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

const num = (lhr, id) => {
  const v = lhr.audits?.[id]?.numericValue;
  return typeof v === 'number' ? v : null;
};
const ms = (v) => (v === null ? null : Math.round(v));
const pct = (c) => (c && typeof c.score === 'number' ? Math.round(c.score * 100) : null);

/** Failing audits that carry weight in a category, most important first. */
function failingAudits(lhr, categoryId) {
  const refs = lhr.categories?.[categoryId]?.auditRefs || [];
  return refs
    .filter((r) => r.weight > 0)
    .map((r) => lhr.audits?.[r.id])
    .filter((a) => a && typeof a.score === 'number' && a.score < 0.9)
    .map((a) => a.id);
}

export function lhrToRecord(lhr, strategy) {
  if (!lhr || typeof lhr !== 'object' || !lhr.audits || !lhr.categories) {
    const e = new Error('Unexpected Lighthouse result shape');
    e.failureClass = 'schema_change';
    throw e;
  }
  if (lhr.runtimeError?.code) {
    return { ok: false, error_code: lhr.runtimeError.code, error_message: lhr.runtimeError.message || null };
  }
  const lcp = num(lhr, 'largest-contentful-paint');
  const cls = num(lhr, 'cumulative-layout-shift');
  const tbt = num(lhr, 'total-blocking-time');
  const fcp = num(lhr, 'first-contentful-paint');
  const ratings = { lcp: rate('lcp_ms', lcp), cls: rate('cls', cls), tbt: rate('tbt_ms', tbt) };
  const vitals = Object.values(ratings);
  const opportunities = Object.values(lhr.audits)
    .filter((a) => a.details?.type === 'opportunity' && typeof a.score === 'number' && a.score < 0.9)
    .sort((a, b) => (b.numericValue || 0) - (a.numericValue || 0))
    .slice(0, 8)
    .map((a) => ({ id: a.id, title: a.title, estimated_savings_ms: ms(a.numericValue), display: a.displayValue || null }));
  const insights = Object.values(lhr.audits)
    .filter((a) => a.id.endsWith('-insight') && typeof a.score === 'number' && a.score < 0.9)
    .map((a) => a.id);
  return {
    ok: true,
    requested_url: lhr.requestedUrl || null,
    final_url: lhr.finalDisplayedUrl || null,
    strategy,
    performance_score: pct(lhr.categories.performance),
    accessibility_score: pct(lhr.categories.accessibility),
    best_practices_score: pct(lhr.categories['best-practices']),
    seo_score: pct(lhr.categories.seo),
    lcp_ms: ms(lcp),
    cls: cls === null ? null : Math.round(cls * 1000) / 1000,
    tbt_ms: ms(tbt),
    fcp_ms: ms(fcp),
    speed_index_ms: ms(num(lhr, 'speed-index')),
    time_to_interactive_ms: ms(num(lhr, 'interactive')),
    server_response_ms: ms(num(lhr, 'server-response-time')),
    total_byte_weight_kb: num(lhr, 'total-byte-weight') === null ? null : Math.round(num(lhr, 'total-byte-weight') / 1024),
    lcp_rating: ratings.lcp,
    cls_rating: ratings.cls,
    tbt_rating: ratings.tbt,
    core_web_vitals_lab: vitals.includes(null) ? null : vitals.every((v) => v === 'good') ? 'pass' : 'fail',
    top_opportunities: opportunities,
    failing_insights: insights,
    failing_seo_audits: failingAudits(lhr, 'seo'),
    failing_accessibility_audits: failingAudits(lhr, 'accessibility'),
    lighthouse_version: lhr.lighthouseVersion || null,
    audited_at: lhr.fetchTime || null,
  };
}
