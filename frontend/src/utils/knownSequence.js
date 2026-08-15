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
 * Fill empty strip names from a sequence, restarting it at each system start.
 *
 * A system with more staves than the sequence has names leaves the surplus
 * blank rather than wrapping. Wrapping produced plausible-looking names — a
 * second "Vl1" after "Continuo" — that silently hid an over-detected staff.
 * A blank shows exactly where detection and the ensemble disagree.
 *
 * Names already present are preserved, and the sequence position resyncs to
 * them so later fills stay aligned with what the user actually typed.
 *
 * @param {string[]} names - existing names; empty slots get filled.
 * @param {{isSystemStart: boolean}[]} strips - strips for one page, in order.
 * @param {string[]} sequence - the instrument order to apply.
 * @returns {string[]} names, filled.
 */
export function fillNames(names, strips, sequence) {
  if (!sequence.length || !strips.length) return names;

  const result = [...names];
  let seqIdx = 0;

  for (let i = 0; i < strips.length; i++) {
    if (strips[i].isSystemStart) seqIdx = 0;

    if (!result[i]) {
      result[i] = seqIdx < sequence.length ? sequence[seqIdx] : '';
      seqIdx++;
    } else {
      const pos = sequence.indexOf(result[i]);
      seqIdx = pos !== -1 ? pos + 1 : seqIdx + 1;
    }
  }
  return result;
}
