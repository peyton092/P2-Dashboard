// Address-matching helpers for the CompanyCam photo sync. Given a P2 job's
// street address and a CompanyCam project's address, decide whether they
// refer to the same property — without leaking photos across tenants.
//
// Pure module. The Cloud Function wrapper in functions/index.js (see
// syncCompanyCamPhotos) is the only consumer.
//
// Audit S-12 (cross-tenant photo leakage):
//   The earlier matcher had a "<number> + first street word" fallback that
//   was too loose — "100 Main St" and "100 Main Ave" (potentially different
//   tenants) collided and shared photos. The current matcher is strict:
//   exact normalized equality OR full-prefix containment of one inside the
//   other (so "123 Maple St" matches "123 Maple St Apt 4" without colliding
//   on "100 Main *"). Photos carry CompanyCam's stable project_id upstream
//   anyway, so a stricter match trades a few false negatives for zero
//   cross-tenant leaks. Pinning that contract here protects it from drift.

// Street-suffix abbreviations → canonical short form, so "Drive" and "Dr"
// (etc.) compare equal during normalization.
export const STREET_SUFFIX = {
  street: 'st', st: 'st', avenue: 'ave', ave: 'ave', road: 'rd', rd: 'rd',
  drive: 'dr', dr: 'dr', lane: 'ln', ln: 'ln', boulevard: 'blvd', blvd: 'blvd',
  court: 'ct', ct: 'ct', circle: 'cir', cir: 'cir', way: 'way', place: 'pl', pl: 'pl',
  terrace: 'ter', ter: 'ter', parkway: 'pkwy', pkwy: 'pkwy', cove: 'cv', cv: 'cv',
  trail: 'trl', trl: 'trl', highway: 'hwy', hwy: 'hwy', crossing: 'xing', xing: 'xing',
}

// Lowercases, strips `.`, `,`, `#`, collapses whitespace, then folds known
// street-suffix words to their canonical abbreviation. Null/undefined inputs
// normalize to ''.
export function normAddr(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .map(w => STREET_SUFFIX[w] || w)
    .filter(Boolean)
    .join(' ')
    .trim()
}

// Strict address match — exact normalized equality OR full-prefix containment
// of one fully inside the other (e.g. "123 Maple St" vs "123 Maple St Apt 4").
// Empty-string normalized inputs never match (prevents two unparseable
// addresses from collapsing into the same "" bucket and matching each other).
export function addrMatches(jobAddr, ccAddr) {
  const a = normAddr(jobAddr)
  const b = normAddr(ccAddr)
  if (!a || !b) return false
  return a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ')
}
