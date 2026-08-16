import { filterScores, filterComposers } from './libraryFilter';

const scores = [
  { title: 'Symphony No. 9', composers: [{ surname: 'Dvořák', name: 'Antonín' }] },
  { title: 'Requiem', composers: [{ surname: 'Fauré', name: 'Gabriel' }] },
  { title: 'Membra Jesu Nostri', composer: 'Buxtehude, Dieterich' },
  { title: 'Untitled sketch' },
];

describe('filterScores', () => {
  test('empty query returns everything', () => {
    expect(filterScores(scores, '')).toHaveLength(4);
    expect(filterScores(scores, '   ')).toHaveLength(4);
  });

  test('matches on title, case-insensitively', () => {
    expect(filterScores(scores, 'requiem')).toEqual([scores[1]]);
  });

  test('matches on structured composer surname', () => {
    expect(filterScores(scores, 'Fauré')).toEqual([scores[1]]);
  });

  test('matches on composer first name', () => {
    expect(filterScores(scores, 'Antonín')).toEqual([scores[0]]);
  });

  test('matches accented names typed without accents', () => {
    expect(filterScores(scores, 'dvorak')).toEqual([scores[0]]);
    expect(filterScores(scores, 'faure')).toEqual([scores[1]]);
  });

  test('matches free-text composer when there is no structured record', () => {
    expect(filterScores(scores, 'buxtehude')).toEqual([scores[2]]);
  });

  test('survives a score with no composer at all', () => {
    expect(filterScores(scores, 'sketch')).toEqual([scores[3]]);
  });

  test('returns nothing when there is no match', () => {
    expect(filterScores(scores, 'zzz')).toEqual([]);
  });
});

describe('filterComposers', () => {
  const composers = [
    { surname: 'Dvořák', name: 'Antonín' },
    { surname: 'Bach', name: 'Johann Sebastian' },
    { surname: 'Anonymous' },
  ];

  test('empty query returns everything', () => {
    expect(filterComposers(composers, '')).toHaveLength(3);
  });

  test('matches surname and first name', () => {
    expect(filterComposers(composers, 'bach')).toEqual([composers[1]]);
    expect(filterComposers(composers, 'sebastian')).toEqual([composers[1]]);
  });

  test('matches accented surnames typed plainly', () => {
    expect(filterComposers(composers, 'dvorak')).toEqual([composers[0]]);
  });

  test('survives a composer with no first name', () => {
    expect(filterComposers(composers, 'anonymous')).toEqual([composers[2]]);
  });
});
