/**
 * Choosing the score-wide instrument sequence.
 *
 * Each page shows an instrument order in its first system. Pages mostly agree,
 * but not always: a score can open with a reduced ensemble, or a page can be
 * half-named while the user is still working. Picking the wrong page as the
 * reference miscycles names across every other page.
 *
 * The rule is a vote — the sequence the most pages agree on wins.
 */

/**
 * Pick the sequence the most pages agree on.
 *
 * Ties break toward the longer sequence, then the earlier page: a longer
 * sequence names more strips, and a shorter one usually reflects a page where
 * fewer instruments happen to play rather than a different ensemble.
 *
 * @param {string[][]} sequences - per-page sequences; empty ones are ignored.
 * @returns {string[]} the winning sequence, or [] when there are no candidates.
 */
export function pickMostCommonSequence(sequences) {
  const votes = new Map(); // serialized sequence -> { seq, count, firstIndex }

  sequences.forEach((seq, index) => {
    if (!seq || seq.length === 0) return;
    const key = JSON.stringify(seq);
    const existing = votes.get(key);
    if (existing) existing.count++;
    else votes.set(key, { seq, count: 1, firstIndex: index });
  });

  let best = null;
  for (const cand of votes.values()) {
    if (best === null || isBetterCandidate(cand, best)) best = cand;
  }
  return best ? best.seq : [];
}

function isBetterCandidate(cand, best) {
  if (cand.count !== best.count) return cand.count > best.count;
  if (cand.seq.length !== best.seq.length) return cand.seq.length > best.seq.length;
  return cand.firstIndex < best.firstIndex;
}

/**
 * Fill empty strip names from a sequence, cycling it and restarting at each
 * system start.
 *
 * Cycling is what lets a short sequence name a long page: two names give
 * Vl1/Vl2/Vl1/Vl2, and the list grows as the user types more of them.
 *
 * Names already present are preserved, and the sequence position resyncs to
 * them so later fills stay aligned with what the user actually typed.
 *
 * `startIdx` sets where each system begins in the sequence. It exists for
 * cross-page propagation: a page that omits the opening instruments has no
 * names of its own to resync against, so the caller passes the position of the
 * name the user just typed and the page fills on from there. Defaults to 0,
 * which starts each system at the top of the sequence.
 *
 * @param {string[]} names - existing names; empty slots get filled.
 * @param {{isSystemStart: boolean}[]} strips - strips for one page, in order.
 * @param {string[]} sequence - the instrument order to apply.
 * @param {number} [startIdx=0] - sequence position each system starts at.
 * @returns {string[]} names, filled.
 */
export function fillNames(names, strips, sequence, startIdx = 0) {
  if (!sequence.length || !strips.length) return names;

  const result = [...names];
  let seqIdx = startIdx;

  for (let i = 0; i < strips.length; i++) {
    if (strips[i].isSystemStart) seqIdx = startIdx;

    if (!result[i]) {
      result[i] = sequence[seqIdx % sequence.length];
      seqIdx++;
    } else {
      const pos = sequence.indexOf(result[i]);
      seqIdx = pos !== -1 ? pos + 1 : seqIdx + 1;
    }
  }
  return result;
}

/**
 * Choose which sequence the ghost narrows against on the page being edited.
 *
 * The score-wide vote wins whenever there is one. The instrument order is a
 * property of the score, not of the page being looked at, so turning a page
 * must not restart the cycle.
 *
 * The page's own sequence is only a fallback for a fresh score, where no page
 * has been confirmed yet and the vote is empty.
 *
 * This used to prefer the page's own sequence once it held more than one name,
 * to stop a half-typed page (`buildKnownSequence` stops at the first empty
 * strip) from blanking every strip but the first. That guard was aimed at the
 * wrong mechanism: what keeps a page with a different ensemble correct is the
 * position resync in `fillNames`/`resolveGhostName`, which walks the sequence
 * to match the names actually present. A reduced page whose first strip reads
 * "ob" resolves the rest to cl, fg... straight out of the score-wide sequence.
 *
 * @param {string[]} pageSeq - the current page's own sequence.
 * @param {string[]} globalSeq - the score-wide vote.
 * @returns {string[]} the sequence to suggest from.
 */
export function pickSuggestionSequence(pageSeq, globalSeq) {
  return globalSeq.length > 0 ? globalSeq : pageSeq;
}

/**
 * Read a page's own instrument order out of its first system.
 *
 * Stops at the first empty strip, the first repeat, or the second system --
 * whichever comes first. Stopping at a repeat is what keeps prefill's own
 * output from being read back as a sequence: once one name is cycled across
 * the page, the second strip repeats it and the walk ends after one name.
 *
 * @param {string[]} names - the page's strip names, in order.
 * @param {{isSystemStart: boolean}[]} pageStrips - the page's strips, in order.
 * @returns {string[]} the names of the first system, deduplicated.
 */
export function buildKnownSequence(names, pageStrips) {
  const known = [];
  const seen = new Set();
  for (let i = 0; i < names.length && i < pageStrips.length; i++) {
    if (i > 0 && pageStrips[i].isSystemStart) break;
    const name = names[i];
    if (name === undefined || name === '') break;
    if (seen.has(name)) break;
    seen.add(name);
    known.push(name);
  }
  return known;
}

/**
 * Fill the strips below the one just edited, continuing from the name typed
 * there.
 *
 * The sequence is the score-wide one when there is one, and the page's own
 * otherwise — the same precedence the ghost uses, so hint and fill never
 * disagree. Using only the page's own sequence was the bug behind #4/#5: on a
 * page whose first strip is "ob", `buildKnownSequence` returns just ["ob"] and
 * every strip below fills "ob", never reaching cl or fg.
 *
 * The page's own sequence is still what makes the list expand while a score is
 * being named for the first time: "vl1" paints the page, adding "vl2" makes it
 * alternate.
 *
 * @param {string[]} names - the page's strip names; the edited one is read.
 * @param {{isSystemStart: boolean}[]} currentStrips - the page's strips.
 * @param {number} editedIndex - the strip just typed into.
 * @param {string[]} [globalSeq=[]] - the score-wide vote, if any.
 * @returns {string[]} names, with everything below `editedIndex` refilled.
 */
export function autoFillNames(names, currentStrips, editedIndex, globalSeq = []) {
  const pageSeq = buildKnownSequence(names, currentStrips);
  const knownNames = pickSuggestionSequence(pageSeq, globalSeq);
  if (knownNames.length === 0) return names;

  const editedName = names[editedIndex];
  const anchor = knownNames.indexOf(editedName);
  if (anchor === -1) return names;

  // Where a new system restarts. Against the score-wide sequence it resumes at
  // the name typed, because a page that omits the opening instruments repeats
  // the same reduced run in each of its systems. Against the page's own
  // sequence it restarts at the top — that sequence *is* the page's order, so
  // vl1/vl2 must stay vl1/vl2 in the second system rather than running on to
  // vl2/vl1.
  const systemStart = globalSeq.length > 0 ? anchor : 0;

  let seqIndex = anchor;
  const result = [...names];
  for (let i = editedIndex + 1; i < currentStrips.length; i++) {
    if (currentStrips[i].isSystemStart) seqIndex = systemStart - 1;
    seqIndex++;
    // Cycle. This is what makes the list expand as it is typed: one name paints
    // the page, two alternate, and each new name extends the pattern.
    result[i] = knownNames[seqIndex % knownNames.length];
  }
  return result;
}

/**
 * Where propagated pages should start in the sequence after a name is typed.
 *
 * The default is the top: with fl/ob/cl/fg, other pages fill fl, ob, cl, fg.
 *
 * The exception is a page whose ensemble genuinely begins mid-sequence. The
 * only evidence for that is the user naming the *first* strip of a system as
 * something other than the sequence's first entry: on a page with no "fl",
 * typing "ob" into strip 0 says this ensemble opens at ob, so the other pages
 * should read ob, cl, fg too.
 *
 * Typing "ob" into a lower strip says nothing of the kind — the strip above it
 * already anchors the page at the top. Anchoring on it there was the bug that
 * made every propagated page start from the sequence's second entry.
 *
 * @param {string} typedName - the name just confirmed.
 * @param {number} editedIndex - the strip it was typed into.
 * @param {{isSystemStart: boolean}[]} strips - the edited page's strips.
 * @param {string[]} sequence - the score-wide sequence being propagated.
 * @returns {number} the sequence position propagated pages start each system at.
 */
export function propagationStartIndex(typedName, editedIndex, strips, sequence) {
  const pos = sequence.indexOf(typedName);
  const startsSystem = strips[editedIndex]?.isSystemStart;
  return (startsSystem && pos > 0) ? pos : 0;
}

/**
 * What does the sequence call strip `index` on this page, given what's typed
 * there so far?
 *
 * Walks the same position-tracking as `fillNames` up to `index` (restarting
 * at each system start, resyncing to any preceding typed names), then matches
 * `prefix` against the resulting candidate case-insensitively. An empty
 * prefix returns the candidate outright; a prefix that doesn't match, or that
 * already equals the candidate, returns ''.
 *
 * @param {string[]} names - existing names for strips before `index`.
 * @param {{isSystemStart: boolean}[]} strips - strips for one page, in order.
 * @param {string[]} sequence - the instrument order to apply.
 * @param {number} index - the strip being resolved.
 * @param {string} prefix - text typed so far in that strip's field.
 * @returns {string} the suggested name in canonical casing, or ''.
 */
export function resolveGhostName(names, strips, sequence, index, prefix) {
  if (!sequence.length || index >= strips.length) return '';

  let seqIdx = 0;
  for (let i = 0; i < index; i++) {
    if (strips[i].isSystemStart) seqIdx = 0;
    const existing = names[i];
    if (existing) {
      const pos = sequence.indexOf(existing);
      seqIdx = pos !== -1 ? pos + 1 : seqIdx + 1;
    } else {
      seqIdx++;
    }
  }
  if (strips[index].isSystemStart) seqIdx = 0;

  // Cycle, matching autoFillStripNames: with nothing typed the hint must be
  // what prefill would write. Cycling is also what makes the list expand --
  // one name paints the page, two alternate, and so on.
  const positional = sequence[seqIdx % sequence.length];
  const typed = prefix || '';

  if (!typed) return positional || '';

  // Once the user types, the prefix decides. The positional guess is tried
  // first so an unchanged field keeps its own name, then the rest of the
  // sequence in order -- typing "v" against Vl1/Vl2/Vla must reach Vl1, not
  // stay on whatever this slot happened to be.
  const lower = typed.toLowerCase();
  const matches = (name) => name && name.toLowerCase().startsWith(lower)
    && name.length > typed.length;

  if (matches(positional)) return positional;
  for (let i = 0; i < sequence.length; i++) {
    const candidate = sequence[(seqIdx + 1 + i) % sequence.length];
    if (matches(candidate)) return candidate;
  }
  return '';
}
