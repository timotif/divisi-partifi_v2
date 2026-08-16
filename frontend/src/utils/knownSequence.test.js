import {
  pickMostCommonSequence,
  fillNames,
  resolveGhostName,
  pickSuggestionSequence,
  buildKnownSequence,
  autoFillNames,
  propagationStartIndex,
} from './knownSequence';

const strips = (...starts) => starts.map(isSystemStart => ({ isSystemStart }));

const FULL = ['Vl1', 'Vl2', 'Vla1', 'Vla2', 'Fl', 'S', 'C', 'T', 'B', 'Violone', 'Continuo'];
const REDUCED = ['Vl1', 'Vl2', 'Vla1', 'Vla2', 'Fl', 'Violone', 'Continuo'];

describe('narrowing against the whole sequence', () => {
  // Erasing a prefilled field is how the user rejects a name, so the ghost has
  // to be reachable from there -- and typing must be able to steer away from
  // the name that slot already had.
  const page = strips(true, false, false, false);
  const seq = ['Vl1', 'Vl2', 'Vla', 'Bc'];
  const erased = ['Vl1', 'Vl2', '', 'Bc'];

  test('an emptied field is re-offered its own name', () => {
    expect(resolveGhostName(erased, page, seq, 2, '')).toBe('Vla');
  });

  test('typing reaches a name elsewhere in the sequence', () => {
    expect(resolveGhostName(erased, page, seq, 2, 'b')).toBe('Bc');
  });

  test('the slot\'s own name wins when it also matches', () => {
    expect(resolveGhostName(erased, page, seq, 2, 'v')).toBe('Vla');
  });

  test('a complete name has nothing left to complete', () => {
    expect(resolveGhostName(erased, page, seq, 2, 'Vla')).toBe('');
  });

  test('no match anywhere in the sequence', () => {
    expect(resolveGhostName(erased, page, seq, 2, 'x')).toBe('');
  });
});

describe('the expanding list', () => {
  // Main's prefill cycles the sequence, which is what makes the list expand as
  // it is typed: name strip 0 "vl1" and every strip reads vl1; add "vl2" at
  // strip 1 and the page becomes vl1/vl2/vl1/vl2. The ghost must propose the
  // same name prefill would write, so it cycles too.
  const page = strips(true, false, false, false);

  test('a one-name sequence paints every strip', () => {
    expect(resolveGhostName(['vl1'], page, ['vl1'], 1, '')).toBe('vl1');
    expect(resolveGhostName(['vl1'], page, ['vl1'], 3, '')).toBe('vl1');
  });

  test('a two-name sequence alternates', () => {
    const seq = ['vl1', 'vl2'];
    expect(resolveGhostName(['vl1', 'vl2'], page, seq, 2, '')).toBe('vl1');
    expect(resolveGhostName(['vl1', 'vl2'], page, seq, 3, '')).toBe('vl2');
  });
});

describe('pickSuggestionSequence', () => {
  // The instrument order belongs to the score, not to the page on screen, so
  // the vote wins whenever there is one and turning a page never restarts the
  // cycle (issue #5).
  test('a one-name page sequence loses to the score-wide vote', () => {
    expect(pickSuggestionSequence(['Vl1'], FULL)).toEqual(FULL);
  });

  test('the vote beats even a full page sequence', () => {
    // A page with its own ensemble is kept correct by the position resync in
    // fillNames/resolveGhostName, not by suggesting from the page itself.
    expect(pickSuggestionSequence(REDUCED, FULL)).toEqual(FULL);
  });

  test('a one-name page sequence still beats an empty vote', () => {
    // Fresh score: no other page has names, so the vote has nothing to offer.
    expect(pickSuggestionSequence(['Vl1'], [])).toEqual(['Vl1']);
  });

  test('an empty page sequence falls back to the vote', () => {
    expect(pickSuggestionSequence([], FULL)).toEqual(FULL);
  });

  test('nothing anywhere yields nothing', () => {
    expect(pickSuggestionSequence([], [])).toEqual([]);
  });
});

// This is the path the UI actually runs on blur. It lived as a closure inside
// MusicPartitioner and so was never covered, which is how the "fills from the
// top of the list" bug survived a green suite.
describe('autoFillNames: filling the page being typed on', () => {
  const SEQ = ['fl', 'ob', 'cl', 'fg'];
  const page = strips(true, false, false, false);

  test('continues from the name typed, not the top of the sequence', () => {
    expect(autoFillNames(['ob', '', '', ''], page, 0, SEQ))
      .toEqual(['ob', 'cl', 'fg', 'fl']);
  });

  test('starting mid-sequence wraps around', () => {
    expect(autoFillNames(['cl', '', '', ''], page, 0, SEQ))
      .toEqual(['cl', 'fg', 'fl', 'ob']);
  });

  test('the unreduced page is unchanged by the anchor', () => {
    expect(autoFillNames(['fl', '', '', ''], page, 0, SEQ))
      .toEqual(['fl', 'ob', 'cl', 'fg']);
  });

  test('editing a strip mid-page refills only below it', () => {
    expect(autoFillNames(['fl', 'cl', '', ''], page, 1, SEQ))
      .toEqual(['fl', 'cl', 'fg', 'fl']);
  });

  test('each system repeats the same reduced run', () => {
    expect(autoFillNames(['ob', '', '', ''], strips(true, false, true, false), 0, SEQ))
      .toEqual(['ob', 'cl', 'ob', 'cl']);
  });

  test('a name outside the sequence leaves the page alone', () => {
    expect(autoFillNames(['tuba', '', '', ''], page, 0, SEQ))
      .toEqual(['tuba', '', '', '']);
  });

  // The expanding list, which has no score-wide sequence to lean on yet. These
  // pin the behaviour docs/design records as having won over blanking.
  describe('with no score-wide sequence yet', () => {
    test('one name paints the whole page', () => {
      expect(autoFillNames(['vl1', '', '', ''], page, 0))
        .toEqual(['vl1', 'vl1', 'vl1', 'vl1']);
    });

    test('two names alternate', () => {
      expect(autoFillNames(['vl1', 'vl2', '', ''], page, 1))
        .toEqual(['vl1', 'vl2', 'vl1', 'vl2']);
    });

    test('a new system restarts at the top, not at the typed name', () => {
      expect(autoFillNames(['vl1', 'vl2', '', ''], strips(true, false, true, false), 1))
        .toEqual(['vl1', 'vl2', 'vl1', 'vl2']);
    });
  });
});

describe('buildKnownSequence', () => {
  test('reads the first system in order', () => {
    expect(buildKnownSequence(['fl', 'ob', 'cl'], strips(true, false, false)))
      .toEqual(['fl', 'ob', 'cl']);
  });

  test('stops at the second system', () => {
    expect(buildKnownSequence(['fl', 'ob', 'cl'], strips(true, false, true)))
      .toEqual(['fl', 'ob']);
  });

  test('stops at the first empty strip', () => {
    expect(buildKnownSequence(['fl', '', 'cl'], strips(true, false, false)))
      .toEqual(['fl']);
  });

  // Prefill's own output must not read back as a sequence -- see the trap in
  // docs/design/2026-08-16-strip-name-implementation-notes.md.
  test('stops at a repeat, so cycled prefill yields one name', () => {
    expect(buildKnownSequence(['vl1', 'vl1', 'vl1'], strips(true, false, false)))
      .toEqual(['vl1']);
  });
});

describe('a page that omits the opening instruments (issue #4)', () => {
  const SEQ = ['fl', 'ob', 'cl', 'fg'];

  // The reported expectation: "if the list is fl, ob, cl, fg and in the next
  // page there's no fl, I type ob and I expect cl, fg to be autofilled."
  test('typing "ob" first resyncs the rest of the page to cl, fg', () => {
    expect(fillNames(['ob'], strips(true, false, false), SEQ))
      .toEqual(['ob', 'cl', 'fg']);
  });

  test('the ghost agrees with the fill', () => {
    expect(resolveGhostName(['ob'], strips(true, false, false), SEQ, 1, ''))
      .toBe('cl');
    expect(resolveGhostName(['ob', 'cl'], strips(true, false, false), SEQ, 2, ''))
      .toBe('fg');
  });

  // Propagated pages are wiped before filling, so they have no name to resync
  // against and need the anchor passed in explicitly.
  test('startIdx anchors a page with no names of its own', () => {
    expect(fillNames([], strips(true, false, false), SEQ, 1))
      .toEqual(['ob', 'cl', 'fg']);
  });

  test('startIdx restarts each system at the anchor, not at the top', () => {
    expect(fillNames([], strips(true, false, true, false), SEQ, 1))
      .toEqual(['ob', 'cl', 'ob', 'cl']);
  });

  test('startIdx defaults to the top of the sequence', () => {
    expect(fillNames([], strips(true, false), SEQ))
      .toEqual(['fl', 'ob']);
  });
});

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

  test('wraps a short sequence over a long system', () => {
    // A 5-staff system against a 3-name sequence. Cycling is what lets a
    // partly-typed sequence name a whole page, so it wraps here rather than
    // blanking the surplus.
    const s = strips(true, false, false, false, false);
    expect(fillNames([], s, SEQ)).toEqual(['Vl1', 'Vl2', 'Vla', 'Vl1', 'Vl2']);
  });

  test('a short system does not consume the whole sequence', () => {
    const s = strips(true, false, true, false, false);
    expect(fillNames([], s, SEQ)).toEqual(['Vl1', 'Vl2', 'Vl1', 'Vl2', 'Vla']);
  });

  test('preserves existing names and resyncs position to them', () => {
    // "Vla" is last in the sequence, so the strip after it wraps to the front.
    const s = strips(true, false, false);
    expect(fillNames(['', 'Vla', ''], s, SEQ)).toEqual(['Vl1', 'Vla', 'Vl1']);
  });

  test('an unknown existing name advances by one', () => {
    const s = strips(true, false, false);
    expect(fillNames(['Ob', '', ''], s, SEQ)).toEqual(['Ob', 'Vl2', 'Vla']);
  });

  test('returns input untouched when there is nothing to apply', () => {
    expect(fillNames(['a'], strips(true), [])).toEqual(['a']);
    expect(fillNames([], [], SEQ)).toEqual([]);
  });
});

describe('resolveGhostName', () => {
  const SEQ = ['Vl1', 'Vl2', 'Vla'];

  test('empty prefix returns the sequence name for this strip', () => {
    const s = strips(true, false, false);
    expect(resolveGhostName([], s, SEQ, 0, '')).toBe('Vl1');
    expect(resolveGhostName([], s, SEQ, 1, '')).toBe('Vl2');
  });

  test('prefix narrows instead of hiding: "v" -> "Vl1"', () => {
    const s = strips(true, false, false);
    expect(resolveGhostName([], s, SEQ, 0, 'v')).toBe('Vl1');
  });

  test('non-matching prefix returns nothing', () => {
    const s = strips(true, false, false);
    expect(resolveGhostName([], s, SEQ, 0, 'x')).toBe('');
  });

  test('match is case-insensitive but returns canonical casing', () => {
    const s = strips(true, false, false);
    expect(resolveGhostName([], s, SEQ, 0, 'VL')).toBe('Vl1');
    expect(resolveGhostName([], s, SEQ, 1, 'vl')).toBe('Vl2');
  });

  test('full name typed returns nothing (exact match, nothing left to narrow)', () => {
    const s = strips(true, false, false);
    expect(resolveGhostName([], s, SEQ, 0, 'Vl1')).toBe('');
  });

  test('trailing space with no match returns nothing', () => {
    const s = strips(true, false, false);
    expect(resolveGhostName([], s, SEQ, 1, 'vl2 ')).toBe('');
  });

  test('restarts the sequence at each system start', () => {
    const s = strips(true, false, false, true, false, false);
    expect(resolveGhostName([], s, SEQ, 3, '')).toBe('Vl1');
    expect(resolveGhostName([], s, SEQ, 4, 'v')).toBe('Vl2');
  });

  test('strips beyond the sequence cycle it, as prefill does', () => {
    // The ghost proposes exactly what autoFillStripNames would write, and that
    // cycles (see "the expanding list"). fillNames blanks its surplus instead,
    // but that runs when seeding a page from a settled sequence -- a different
    // job from suggesting the next name to someone typing.
    const s = strips(true, false, false, false, false);
    expect(resolveGhostName([], s, SEQ, 3, '')).toBe('Vl1');
    expect(resolveGhostName([], s, SEQ, 4, '')).toBe('Vl2');
  });

  test('resync to preceding typed names before resolving this strip', () => {
    // Strip 0 typed as "Vla" (out of order) -- strip 1 resolves from where
    // "Vla" sits in the sequence, the same walk fillNames performs. "Vla" is
    // last, so the next name wraps to the front.
    const s = strips(true, false, false);
    expect(resolveGhostName(['Vla', '', ''], s, SEQ, 1, '')).toBe('Vl1');
  });
});

describe('where propagated pages start in the sequence', () => {
  const SEQ = ['fl', 'ob', 'cl', 'fg'];
  const page = strips(true, false, false, false);

  test('naming a strip below the first starts other pages at the top', () => {
    // The reported bug: typing "ob" into strip 1 anchored propagation on "ob",
    // so every other page began at the sequence's second entry.
    expect(propagationStartIndex('ob', 1, page, SEQ)).toBe(0);
    expect(fillNames(['', '', '', ''], page, SEQ, 0)).toEqual(SEQ);
  });

  test('naming the first strip with the sequence head also starts at the top', () => {
    expect(propagationStartIndex('fl', 0, page, SEQ)).toBe(0);
  });

  test('naming the first strip mid-sequence anchors there', () => {
    // A reduced ensemble that has no "fl" and opens on "ob".
    expect(propagationStartIndex('ob', 0, page, SEQ)).toBe(1);
    expect(fillNames(['', '', '', ''], page, SEQ, 1))
      .toEqual(['ob', 'cl', 'fg', 'fl']);
  });

  test('a name absent from the sequence starts at the top', () => {
    expect(propagationStartIndex('tuba', 0, page, SEQ)).toBe(0);
  });

  test('the first strip of a later system anchors too', () => {
    const twoSystems = strips(true, false, true, false);
    expect(propagationStartIndex('cl', 2, twoSystems, SEQ)).toBe(2);
  });
});
