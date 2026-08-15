/**
 * Score page range helpers.
 *
 * The range is 1-indexed and inclusive (matching printed page numbers shown in
 * the UI), while page indices everywhere else in the app are 0-indexed.
 * Keeping the conversion in one place avoids off-by-one errors at call sites.
 */

/** Is a 0-indexed page inside the 1-indexed inclusive range? */
export function isPageInRange(pageIdx, range) {
  if (!range) return true;
  return pageIdx + 1 >= range.from && pageIdx + 1 <= range.to;
}

/** Number of pages covered by the range. */
export function rangeLength(range) {
  if (!range) return 0;
  return Math.max(0, range.to - range.from + 1);
}

/**
 * Apply a user edit to one end of the range, clamping to [1, pageCount] and
 * keeping from <= to. Returns the previous range unchanged for invalid input
 * (e.g. an empty text field mid-typing).
 */
export function updateRange(range, field, rawValue, pageCount) {
  const parsed = parseInt(rawValue, 10);
  if (Number.isNaN(parsed)) return range;
  const value = Math.min(Math.max(parsed, 1), Math.max(1, pageCount));
  return field === 'from'
    ? { from: value, to: Math.max(value, range.to) }
    : { from: Math.min(value, range.from), to: value };
}
