import { isPageInRange, rangeLength, updateRange } from './scoreRange';

describe('isPageInRange', () => {
  // Buxtehude fixture: score is printed pages 5..17 => indices 4..16
  const range = { from: 5, to: 17 };

  test('excludes front matter before the range', () => {
    expect(isPageInRange(0, range)).toBe(false);  // page 1, title
    expect(isPageInRange(3, range)).toBe(false);  // page 4
  });

  test('includes both boundaries', () => {
    expect(isPageInRange(4, range)).toBe(true);   // page 5, first
    expect(isPageInRange(16, range)).toBe(true);  // page 17, last
  });

  test('excludes pages after the range', () => {
    expect(isPageInRange(17, range)).toBe(false); // page 18, instruction
    expect(isPageInRange(26, range)).toBe(false); // page 27, part
  });

  test('treats a missing range as all-inclusive', () => {
    expect(isPageInRange(0, null)).toBe(true);
    expect(isPageInRange(99, undefined)).toBe(true);
  });
});

describe('rangeLength', () => {
  test('counts inclusively', () => {
    expect(rangeLength({ from: 5, to: 17 })).toBe(13);
    expect(rangeLength({ from: 1, to: 1 })).toBe(1);
  });
});

describe('updateRange', () => {
  const pageCount = 27;

  test('clamps below 1 and above pageCount', () => {
    expect(updateRange({ from: 5, to: 17 }, 'from', '0', pageCount).from).toBe(1);
    expect(updateRange({ from: 5, to: 17 }, 'to', '99', pageCount).to).toBe(pageCount);
  });

  test('pushes "to" when "from" moves past it', () => {
    expect(updateRange({ from: 5, to: 17 }, 'from', '20', pageCount))
      .toEqual({ from: 20, to: 20 });
  });

  test('pulls "from" when "to" moves below it', () => {
    expect(updateRange({ from: 5, to: 17 }, 'to', '3', pageCount))
      .toEqual({ from: 3, to: 3 });
  });

  test('ignores non-numeric input mid-typing', () => {
    const r = { from: 5, to: 17 };
    expect(updateRange(r, 'from', '', pageCount)).toEqual(r);
  });

  test('normal edit leaves the other end alone', () => {
    expect(updateRange({ from: 5, to: 17 }, 'from', '4', pageCount))
      .toEqual({ from: 4, to: 17 });
  });
});
