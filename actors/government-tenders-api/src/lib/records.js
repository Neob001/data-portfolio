// Shared record helpers. Every output record gets source_url + fetched_at (ISO).
// Synced into each actor's src/lib/ by scripts/sync_shared.py — edit ONLY in shared/js/.

export function stamp(record, sourceUrl) {
  return { ...record, source_url: sourceUrl, fetched_at: new Date().toISOString() };
}

/** Drop records with no meaningful payload so we never charge for empties. */
export function nonEmpty(records, requiredField) {
  return records.filter((r) => r && r[requiredField] !== undefined && r[requiredField] !== null && r[requiredField] !== '');
}

/** ISO date (YYYY-MM-DD) or null. Accepts Date, epoch, or parseable string. */
export function isoDate(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
