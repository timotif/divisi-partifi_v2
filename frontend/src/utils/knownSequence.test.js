import { pickMostCommonSequence, fillNames } from './knownSequence';

const strips = (...starts) => starts.map(isSystemStart => ({ isSystemStart }));

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

describe('fillNames', () => {
  const SEQ = ['Vl1', 'Vl2', 'Vla'];

  test('fills a single system in order', () => {
    const s = strips(true, false, false);
    expect(fillNames([], s, SEQ)).toEqual(['Vl1', 'Vl2', 'Vla']);
  });

  test('restarts the sequence at each system start', () => {
    const s = strips(true, false, false, true, false, false);
    expect(fillNames([], s, SEQ)).toEqual([
      'Vl1', 'Vl2', 'Vla',
      'Vl1', 'Vl2', 'Vla',
    ]);
  });

  test('leaves surplus staves blank instead of wrapping', () => {
    // A 5-staff system against a 3-name sequence: detection found two more
    // staves than the ensemble has. Wrapping used to emit Vl1/Vl2 again here,
    // which looked correct and hid the disagreement.
    const s = strips(true, false, false, false, false);
    expect(fillNames([], s, SEQ)).toEqual(['Vl1', 'Vl2', 'Vla', '', '']);
  });

  test('a short system does not consume the whole sequence', () => {
    const s = strips(true, false, true, false, false);
    expect(fillNames([], s, SEQ)).toEqual(['Vl1', 'Vl2', 'Vl1', 'Vl2', 'Vla']);
  });

  test('preserves existing names and resyncs position to them', () => {
    const s = strips(true, false, false);
    expect(fillNames(['', 'Vla', ''], s, SEQ)).toEqual(['Vl1', 'Vla', '']);
  });

  test('an unknown existing name advances by one', () => {
    const s = strips(true, false, false);
    expect(fillNames(['Ob', '', ''], s, SEQ)).toEqual(['Ob', 'Vl2', 'Vla']);
  });

  test('returns input untouched when there is nothing to apply', () => {
    expect(fillNames(['a'], strips(true), [])).toEqual(['a']);
    expect(fillNames([], [], SEQ)).toEqual([]);
  });

  // A page seeded from another page can arrive with a single name already on
  // it (auto-fill or an accepted ghost). Seeding used to skip any page with a
  // name, leaving the other strips blank forever.
  test('completes a page that only has its first strip named', () => {
    const s = strips(true, false, false, true, false, false);
    expect(fillNames(['Vl1'], s, SEQ)).toEqual(['Vl1', 'Vl2', 'Vla', 'Vl1', 'Vl2', 'Vla']);
  });
});
