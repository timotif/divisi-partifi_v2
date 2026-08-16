// Client-side filtering for the library lists.
//
// Both lists are already fully loaded in memory, so filtering happens here
// rather than round-tripping to the server. (`/api/scores/search` exists for
// the upload-time duplicate-title check, which is a different job.)

// Composers arrive either as structured records on `score.composers` or as a
// free-text `score.composer`; a score can match on either.
function composerText(score) {
  if (score.composers?.length) {
    return score.composers.map(c => `${c.surname || ''} ${c.name || ''}`).join(' ');
  }
  return score.composer || '';
}

// Case- and accent-insensitive substring test, so "dvorak" matches "Dvořák".
function matches(haystack, needle) {
  const norm = (s) =>
    s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return norm(haystack).includes(norm(needle));
}

export function filterScores(scores, query) {
  const q = query.trim();
  if (!q) return scores;
  return scores.filter(
    (s) => matches(s.title || '', q) || matches(composerText(s), q)
  );
}

export function filterComposers(composers, query) {
  const q = query.trim();
  if (!q) return composers;
  return composers.filter(
    (c) => matches(`${c.surname || ''} ${c.name || ''}`, q)
  );
}
