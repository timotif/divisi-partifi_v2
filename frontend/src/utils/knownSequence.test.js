import { pickMostCommonSequence } from './knownSequence';

const FULL = ['Vl1', 'Vl2', 'Vla1', 'Vla2', 'Fl', 'S', 'C', 'T', 'B', 'Violone', 'Continuo'];
const REDUCED = ['Vl1', 'Vl2', 'Vla1', 'Vla2', 'Fl', 'Violone', 'Continuo'];

describe('pickMostCommonSequence', () => {
  test('returns [] when there are no candidates', () => {
    expect(pickMostCommonSequence([])).toEqual([]);
    expect(pickMostCommonSequence([[], null, undefined])).toEqual([]);
  });

  test('returns the only candidate', () => {
    expect(pickMostCommonSequence([[], FULL, []])).toEqual(FULL);
  });

  test('majority wins over an earlier minority page', () => {
    // The real Buxtehude case: page 0 shows a reduced ensemble, the following
    // pages the full one. Page order alone used to hand it to the reduced page.
    const pages = [REDUCED, ...Array(14).fill(FULL)];
    expect(pickMostCommonSequence(pages)).toEqual(FULL);
  });

  test('a lone early page still wins when nothing outvotes it', () => {
    expect(pickMostCommonSequence([REDUCED, [], []])).toEqual(REDUCED);
  });

  test('ties break toward the longer sequence', () => {
    expect(pickMostCommonSequence([REDUCED, FULL])).toEqual(FULL);
    expect(pickMostCommonSequence([FULL, REDUCED])).toEqual(FULL);
  });

  test('equal length and count break toward the earlier page', () => {
    const a = ['Ob', 'Fg'];
    const b = ['Cl', 'Cor'];
    expect(pickMostCommonSequence([a, b])).toEqual(a);
    expect(pickMostCommonSequence([b, a])).toEqual(b);
  });

  test('order within a sequence is significant', () => {
    const swapped = ['Vl2', 'Vl1'];
    const normal = ['Vl1', 'Vl2'];
    expect(pickMostCommonSequence([swapped, normal, normal])).toEqual(normal);
  });
});
