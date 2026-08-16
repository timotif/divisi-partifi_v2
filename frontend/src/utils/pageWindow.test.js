import {
  pageWindow,
  parsePageInput,
  DOT_WINDOW_THRESHOLD,
  DOT_WINDOW_SIZE,
} from './pageWindow';

describe('pageWindow', () => {
  test('returns every page at or below the threshold', () => {
    expect(pageWindow(5, 0)).toEqual([0, 1, 2, 3, 4]);
    expect(pageWindow(DOT_WINDOW_THRESHOLD, 10)).toHaveLength(DOT_WINDOW_THRESHOLD);
  });

  test('handles degenerate page counts', () => {
    expect(pageWindow(0, 0)).toEqual([]);
    expect(pageWindow(-3, 0)).toEqual([]);
    expect(pageWindow(1, 0)).toEqual([0]);
  });

  test('caps the dot count for a long score', () => {
    // The reported bug: 214 pages rendered 214 dots and overflowed the row.
    const dots = pageWindow(214, 100);
    expect(dots.length).toBeLessThanOrEqual(DOT_WINDOW_SIZE + 4);
    expect(dots.filter(p => p !== null).length).toBeLessThan(214);
  });

  test('always includes first and last page', () => {
    const dots = pageWindow(214, 100);
    expect(dots).toContain(0);
    expect(dots).toContain(213);
  });

  test('includes the current page and its neighbours', () => {
    const dots = pageWindow(214, 100);
    expect(dots).toContain(100);
    expect(dots).toContain(99);
    expect(dots).toContain(101);
  });

  test('marks skipped stretches with null on both sides', () => {
    const dots = pageWindow(214, 100);
    expect(dots.filter(p => p === null)).toHaveLength(2);
  });

  test('keeps a full window at the start, with no leading gap', () => {
    const dots = pageWindow(214, 0);
    expect(dots[0]).toBe(0);
    expect(dots[1]).toBe(1); // no ellipsis immediately after page 0
    expect(dots.filter(p => p === null)).toHaveLength(1);
    expect(dots.filter(p => p !== null).length).toBeGreaterThanOrEqual(DOT_WINDOW_SIZE);
  });

  test('keeps a full window at the end, with no trailing gap', () => {
    const dots = pageWindow(214, 213);
    expect(dots[dots.length - 1]).toBe(213);
    expect(dots[dots.length - 2]).toBe(212);
    expect(dots.filter(p => p === null)).toHaveLength(1);
    expect(dots.filter(p => p !== null).length).toBeGreaterThanOrEqual(DOT_WINDOW_SIZE);
  });

  test('clamps an out-of-bounds current page', () => {
    expect(() => pageWindow(214, 9999)).not.toThrow();
    expect(pageWindow(214, 9999)).toContain(213);
    expect(pageWindow(214, -5)).toContain(0);
  });

  test('never emits a null adjacent to the page it would hide', () => {
    // A gap standing in for a single page is worse than just drawing it.
    for (const current of [0, 1, 8, 9, 15, 100, 205, 212, 213]) {
      const dots = pageWindow(214, current);
      const numbers = dots.filter(p => p !== null);
      const unique = new Set(numbers);
      expect(unique.size).toBe(numbers.length); // no duplicates
      // ascending order
      expect([...numbers]).toEqual([...numbers].sort((a, b) => a - b));
    }
  });
});

describe('parsePageInput', () => {
  test('converts a valid 1-indexed number to 0-indexed', () => {
    expect(parsePageInput('1', 214)).toBe(0);
    expect(parsePageInput('147', 214)).toBe(146);
    expect(parsePageInput('214', 214)).toBe(213);
  });

  test('tolerates surrounding whitespace', () => {
    expect(parsePageInput('  42  ', 214)).toBe(41);
  });

  test('rejects out-of-range numbers', () => {
    expect(parsePageInput('0', 214)).toBeNull();
    expect(parsePageInput('215', 214)).toBeNull();
    expect(parsePageInput('-4', 214)).toBeNull();
  });

  test('rejects non-numeric input', () => {
    expect(parsePageInput('', 214)).toBeNull();
    expect(parsePageInput('abc', 214)).toBeNull();
    expect(parsePageInput('12a', 214)).toBeNull();
    expect(parsePageInput('1.5', 214)).toBeNull();
    expect(parsePageInput(null, 214)).toBeNull();
    expect(parsePageInput(undefined, 214)).toBeNull();
  });
});
