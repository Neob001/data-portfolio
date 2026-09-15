// Pure logic for EU VIES VAT number validation (official REST API).

export const VIES_URL = 'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

// VIES member-state codes (Greece uses EL; XI = Northern Ireland).
export const MEMBER_STATES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'EL', 'ES', 'FI', 'FR', 'HR', 'HU', 'IE',
  'IT', 'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI',
]);

// Errors that mean "try again later", never "invalid": must not be charged or reported as invalid.
export const TRANSIENT_ERRORS = new Set([
  'MS_MAX_CONCURRENT_REQ', 'MS_UNAVAILABLE', 'SERVICE_UNAVAILABLE', 'TIMEOUT',
  'GLOBAL_MAX_CONCURRENT_REQ', 'GLOBAL_MAX_CONCURRENT_REQ_TIME', 'MS_MAX_CONCURRENT_REQ_TIME',
]);

/** "DE 811 569 869", "de811569869", "GR094...", -> {countryCode, vatNumber} or null. */
export function parseVatInput(raw, defaultCountry = null) {
  let s = String(raw || '').toUpperCase().replace(/[\s.\-_/]/g, '');
  if (!s) return null;
  let cc = s.slice(0, 2);
  if (cc === 'GR') cc = 'EL';
  if (/^[A-Z]{2}$/.test(cc) && MEMBER_STATES.has(cc)) {
    s = s.slice(2);
  } else if (defaultCountry && MEMBER_STATES.has(defaultCountry.toUpperCase())) {
    cc = defaultCountry.toUpperCase() === 'GR' ? 'EL' : defaultCountry.toUpperCase();
  } else {
    return null;
  }
  if (!/^[0-9A-Z+*]{2,12}$/.test(s)) return null;
  return { countryCode: cc, vatNumber: s };
}

const clean = (v) => (v === undefined || v === null || String(v).trim() === '' || String(v).trim() === '---' ? null : String(v).trim());

/**
 * VIES JSON -> { status: 'valid'|'invalid'|'transient'|'error', record|error }.
 * Only valid/invalid are definitive answers.
 */
export function parseViesResponse(json) {
  if (json && Array.isArray(json.errorWrappers)) {
    const code = json.errorWrappers[0]?.error || 'UNKNOWN_ERROR';
    return { status: TRANSIENT_ERRORS.has(code) ? 'transient' : 'error', error: code };
  }
  if (!json || typeof json.valid !== 'boolean' || !json.countryCode) {
    const e = new Error('Unexpected VIES response shape: valid/countryCode missing');
    e.failureClass = 'schema_change';
    throw e;
  }
  return {
    status: json.valid ? 'valid' : 'invalid',
    record: {
      country_code: json.countryCode,
      vat_number: json.vatNumber,
      full_vat_number: `${json.countryCode}${json.vatNumber}`,
      valid: json.valid,
      name: json.valid ? clean(json.name) : null,
      address: json.valid ? clean(json.address)?.replace(/\n+/g, ', ') ?? null : null,
      checked_at: json.requestDate || null,
      consultation_number: clean(json.requestIdentifier),
    },
  };
}
