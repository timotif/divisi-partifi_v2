// Ghost-text autocomplete helpers for strip name inputs. Pure functions so
// they're testable without rendering the component.

// Flattens every name typed anywhere in the score into a sorted,
// de-duplicated (case-insensitive) candidate list. First-seen spelling wins.
export function buildNameCandidates(stripNamesByPage) {
  const seen = new Map(); // lowercase -> canonical spelling
  for (const names of Object.values(stripNamesByPage || {})) {
    for (const raw of names || []) {
      const name = (raw || '').trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

// First candidate that starts with `input` (case-insensitive) and is longer
// than it. Returns null when input is empty or nothing qualifies.
export function pickGhostCompletion(input, candidates) {
  if (!input) return null;
  const lower = input.toLowerCase();
  return (candidates || []).find(
    c => c.length > input.length && c.toLowerCase().startsWith(lower)
  ) || null;
}
