import { buildNameCandidates, pickGhostCompletion } from './stripNameSuggest';

describe('buildNameCandidates', () => {
  test('flattens, trims, dedupes case-insensitively, keeps first spelling', () => {
    const byPage = {
      0: ['Vl1', ' Vl2 ', ''],
      1: ['vl1', 'Vla', null],
    };
    expect(buildNameCandidates(byPage)).toEqual(['Vl1', 'Vl2', 'Vla']);
  });

  test('empty input yields empty list', () => {
    expect(buildNameCandidates({})).toEqual([]);
    expect(buildNameCandidates(undefined)).toEqual([]);
  });
});

describe('pickGhostCompletion', () => {
  const candidates = ['Violin I', 'Violin II', 'Viola'];

  test('finds a prefix match', () => {
    expect(pickGhostCompletion('Vio', candidates)).toBe('Violin I');
  });

  test('is case-insensitive', () => {
    expect(pickGhostCompletion('vio', candidates)).toBe('Violin I');
  });

  test('no match returns null', () => {
    expect(pickGhostCompletion('Cello', candidates)).toBeNull();
  });

  test('exact match (candidate not longer) does not ghost', () => {
    expect(pickGhostCompletion('Viola', candidates)).toBeNull();
  });

  test('empty input yields no ghost', () => {
    expect(pickGhostCompletion('', candidates)).toBeNull();
  });
});
