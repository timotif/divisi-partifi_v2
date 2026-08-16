// Page-dot windowing for the page navigator.
//
// A score can run to several hundred pages, and one dot per page overflows
// the navigator row -- pushing the prev/next chevrons off-screen. This
// computes a bounded set of dots around the current page instead.

export const DOT_WINDOW_THRESHOLD = 30; // show every page at or below this
export const DOT_WINDOW_SIZE = 15;      // dots around current page above it

// Returns the page indices to render as dots, with nulls marking gaps where
// an ellipsis belongs. Always includes page 0, the last page, and a window
// centred on `currentPage`, clamped to the ends so the window never shrinks
// when the current page is near a boundary.
export function pageWindow(
  pageCount,
  currentPage,
  { threshold = DOT_WINDOW_THRESHOLD, windowSize = DOT_WINDOW_SIZE } = {}
) {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return [];
  if (pageCount <= threshold) {
    return Array.from({ length: pageCount }, (_, i) => i);
  }

  const current = Math.min(Math.max(currentPage, 0), pageCount - 1);
  const half = Math.floor(windowSize / 2);

  // Clamp the window to the ends so it keeps its full width at the edges.
  let start = current - half;
  let end = current + half;
  if (start < 0) {
    end += -start;
    start = 0;
  }
  if (end > pageCount - 1) {
    start -= end - (pageCount - 1);
    end = pageCount - 1;
  }
  start = Math.max(start, 0);

  const pages = [];
  // Leading page + gap. Only emit a gap when a page is actually skipped;
  // if start is 1 the page is adjacent, so render it rather than an ellipsis.
  if (start > 0) {
    pages.push(0);
    if (start > 2) pages.push(null);
    else if (start === 2) pages.push(1);
  }

  for (let i = start; i <= end; i++) pages.push(i);

  const last = pageCount - 1;
  if (end < last) {
    if (end < last - 2) pages.push(null);
    else if (end === last - 2) pages.push(last - 1);
    pages.push(last);
  }

  return pages;
}

// Parses a 1-indexed page number typed by the user into a 0-indexed page,
// or null when it is not a valid page. Keeps the 1-indexed UI / 0-indexed
// internals boundary in one tested place.
export function parsePageInput(raw, pageCount) {
  const trimmed = String(raw ?? '').trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const oneIndexed = Number(trimmed);
  if (oneIndexed < 1 || oneIndexed > pageCount) return null;
  return oneIndexed - 1;
}
