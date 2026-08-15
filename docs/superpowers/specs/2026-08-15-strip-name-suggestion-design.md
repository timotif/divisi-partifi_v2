# Strip name suggestions: prefill, ghost, and OCR

## Problem

Three mechanisms propose instrument names for strips, and they disagree about
what a name means.

`fillNames` (`utils/knownSequence.js`) blanks past the end of a sequence and
resyncs to typed names. `autoFillStripNames` (`MusicPartitioner.js:316`) fills
only forward from an edited index and bails when the edited name is not in the
sequence. The `sequenceSuggestions` memo (`:352`) runs `fillPageNames` against
an all-empty array to produce ghost text. All three answer one question — what
does the sequence call strip *i*? — with different edge-case rules.

Their divergence is what the last five commits patched: "Fill name gaps on
every path", "Seed partly-named pages instead of skipping them", "Fall back to
the score-wide sequence when a page names one strip".

The user-visible failure is narrower. `ghostFor` (`StripNamesColumn.js:47`)
clears the ghost as soon as the field is non-empty:

```js
if (stripNames[index]) return null;
```

So typing `v` in an empty field hides the hint instead of narrowing it to
`vl1`. The comment above that line argues the behaviour is deliberate — "typing
hides the ghost rather than narrowing it" — and that decision is the defect.
The user erases a field to be re-offered a name, which the comment at `:349`
documents as the expected workflow.

## Model

Three sources, one resolver, one question per strip.

```
                    ┌─ user typed / Tab-accepted ──────────┐
                    │  (highest: never overwritten)         │
strip name ◄────────┼─ prefill: cycling sequence ──────────┤
                    │  (writes into stripNamesByPage)       │
                    └─ OCR (/detect, not built) ────────────┘
                       (lowest: only where nothing else)
```

### The sequence

Built from the names in a page's first system, cycling at each system
boundary. It expands as the user types: naming strip 0 `vl1` makes the
sequence `[vl1]` and every strip becomes `vl1`; naming strip 1 `vl2` makes it
`[vl1, vl2]` and the page becomes `vl1 vl2 vl1 vl2 …`.

This is current production behaviour and it stays unchanged.

### Prefill

Writes into `stripNamesByPage`. A prefilled name is validated — it is a name
like any other — until the user erases it.

Erasing holds. `autoFillStripNames` fills forward from the edited index only,
and returns unchanged when the edited name is not in the sequence
(`indexOf('') === -1`, `:322-323`). An erased field therefore stays erased
without any opt-out flag. This was verified against the running app: a strip
cleared on page 2 keeps its `Part N` placeholder across blurs.

### Ghost

The narrowing layer, and the only behavioural change. It fires on a focused
field and matches the typed prefix against the sequence.

| Field state | Today | Proposed |
|---|---|---|
| empty, focused | sequence's name for this strip | unchanged |
| empty, not focused | nothing | nothing (placeholder `Part N`) |
| `v` typed | **nothing** | `vl1` — prefix match |
| `vl2 ` typed, no match | nothing | nothing |
| full name typed | nothing | nothing |

Matching is case-insensitive, but Tab inserts the sequence's casing: typing
`v` and receiving canonical `Vl1` is the useful direction.

Matching is against the sequence only, not against every name used anywhere in
the score. The sequence is what prefill cycles, so the two layers propose from
one list.

### OCR

`/api/scores/<id>/pages/<num>/detect` returns `dividers`, `system_flags`, and
`snap_flags`. It returns no names. `suggestedNames` in `StripNamesColumn.js:49`
and `data.suggested_names` in `MusicPartitioner.js:826` read fields the backend
never sends, and are inert today.

The design keeps that slot and does not build it. OCR enters as the
lowest-priority source in the same resolver, filling only strips the sequence
cannot reach, and is accepted with the same Tab gesture — so it needs no new UI
when it ships. Until then the flow degrades exactly as intended: the user types
the first system, and suggestions begin at the second strip.

An earlier attempt at instrument-label OCR is parked on
`wip/annotation-detection` as unreliable. Nothing in this design depends on it.

## Consolidation

The three fill functions collapse into one resolver answering "what does the
sequence call strip *i* on this page?". Call sites:

- `sequenceSuggestions` (`:352`) — ghost text for the current page
- `handleStripNameBlur` (`:1145`) — fill forward after an edit, then seed
  other pages
- the `/detect` handler (`:802-825`) — fill gaps on a newly detected page

`buildKnownSequence` (`:228`) and `buildGlobalKnownSequence` (`:285`) stay as
they are; they build the sequence rather than apply it. The score-wide vote is
retained: it resolves the case where a page cannot supply a sequence of its
own.

## Testing

`utils/knownSequence.test.js` covers sequence construction. New cases:

- prefix narrowing: `v` → `vl1`; `x` → nothing; case-insensitive match
  returning canonical casing
- erase holds: clearing a prefilled strip leaves it empty across a blur
- expanding list: typing `vl1` at strip 0 fills the page with `vl1`; typing
  `vl2` at strip 1 yields `vl1 vl2 vl1 vl2 …`
- system boundary: the cycle restarts at each `isSystemStart`
- surplus strips: a system longer than the sequence leaves the extra strips
  blank rather than wrapping

`components/StripNamesColumn.test.js` is currently untracked; it is folded into
this work and covers ghost rendering and Tab acceptance.

## Out of scope

- Building the OCR leg
- Bulk accept ("accept all on this page")
- Provenance display (grey vs. white text for suggested vs. typed names) —
  rejected: prefilled names are validated, so there is nothing to distinguish
- Changes to the backend `_resolve_strip_names_globally` fallback
