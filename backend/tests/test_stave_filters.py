"""Unit tests for the stave validation filters and bridge-based grouping.

These guard the three defects found against the Buxtehude ground truth:
phantom staves synthesized over lyrics, a colophon paragraph accepted as a
stave, and whole systems lost because grouping assumed one barline column
for the entire page.
"""

import numpy as np
import pytest

from detection.projection import (
    _cluster_by_bridges,
    _has_staff_lines,
    _merge_abutting_staves,
    _reject_misshapen_staves,
    _row_coverage,
)

WIDTH = 400


def _stave(top, spacing=15):
    """Five evenly spaced line positions, like a real stave array."""
    return np.array([top + i * spacing for i in range(5)])


def _blank(height=1000, width=WIDTH):
    return np.zeros((height, width), dtype=np.uint8)


def _draw_stave(img, stave, x0=0, x1=None):
    """Paint five horizontal ink lines at the stave's line positions."""
    x1 = img.shape[1] if x1 is None else x1
    for y in stave:
        img[int(y), x0:x1] = 255


# ---------------------------------------------------------------------------
# _row_coverage / _has_staff_lines
# ---------------------------------------------------------------------------

def test_row_coverage_measures_widest_row():
    img = _blank()
    stave = _stave(100)
    _draw_stave(img, stave, x1=WIDTH // 2)
    assert _row_coverage(img, stave) == pytest.approx(0.5, abs=0.01)


def test_full_width_stave_passes_line_check():
    img = _blank()
    stave = _stave(100)
    _draw_stave(img, stave)
    assert _has_staff_lines(img, stave, reference=1.0)


def test_short_text_row_fails_line_check():
    """A line of lyrics: ink present, but nowhere near a staff line's width."""
    img = _blank()
    stave = _stave(100)
    # Scattered words, each a fraction of the width, with white between.
    for x in range(0, WIDTH, 80):
        img[130:140, x:x + 20] = 255
    assert not _has_staff_lines(img, stave, reference=1.0)


def test_line_check_is_relative_to_reference():
    """A page whose staves span half the width must not reject its own staves.

    The absolute width of a staff line varies by score; only the ratio to
    this page's other staves is meaningful.
    """
    img = _blank()
    stave = _stave(100)
    _draw_stave(img, stave, x1=WIDTH // 2)
    assert _has_staff_lines(img, stave, reference=0.5)
    assert not _has_staff_lines(img, stave, reference=1.0)


def test_line_check_passes_when_no_image():
    assert _has_staff_lines(None, _stave(100))


# ---------------------------------------------------------------------------
# _merge_abutting_staves
# ---------------------------------------------------------------------------

def test_merges_overlapping_candidates():
    """Two windows over one staff cannot both survive."""
    staves = [_stave(100), _stave(108), _stave(400)]
    merged = _merge_abutting_staves(staves)
    assert len(merged) == 2


def test_keeps_properly_separated_staves():
    staves = [_stave(100), _stave(300), _stave(500)]
    assert len(_merge_abutting_staves(staves)) == 3


def test_merge_is_noop_for_single_stave():
    staves = [_stave(100)]
    assert _merge_abutting_staves(staves) == staves


# ---------------------------------------------------------------------------
# _reject_misshapen_staves
# ---------------------------------------------------------------------------

def test_rejects_oversized_block_without_staff_lines():
    """A text paragraph spanning several stave heights is not a stave."""
    img = _blank()
    normal = [_stave(100), _stave(300), _stave(500)]
    for s in normal:
        _draw_stave(img, s)
    # A tall block of short text rows — no full-width line anywhere.
    blob = np.array([700, 760, 820, 880, 940])
    for y in blob:
        img[y:y + 5, 0:60] = 255

    kept = _reject_misshapen_staves(normal + [blob], img)
    assert len(kept) == 3


def test_keeps_oversized_candidate_that_has_staff_lines():
    """Height alone must not condemn a candidate."""
    img = _blank()
    normal = [_stave(100), _stave(300), _stave(500)]
    for s in normal:
        _draw_stave(img, s)
    tall = _stave(700, spacing=40)
    _draw_stave(img, tall)

    kept = _reject_misshapen_staves(normal + [tall], img)
    assert len(kept) == 4


def test_reject_needs_enough_staves_to_judge():
    """With too few candidates there is no reliable median to compare against."""
    staves = [_stave(100), _stave(300)]
    assert _reject_misshapen_staves(staves, _blank()) == staves


# ---------------------------------------------------------------------------
# _cluster_by_bridges
# ---------------------------------------------------------------------------

def test_bridge_groups_staves_joined_by_a_barline():
    img = _blank()
    staves = [_stave(100), _stave(300), _stave(600), _stave(800)]
    for s in staves:
        _draw_stave(img, s)
    # Barline joining staves 0-1 and, at a different x, staves 2-3.
    img[100:361, 10] = 255
    img[600:861, 90] = 255

    systems = _cluster_by_bridges(staves, img)
    assert [len(s) for s in systems] == [2, 2]


def test_bridge_tolerates_systems_with_different_barline_columns():
    """The first system's barline sits right of the others' (labels)."""
    img = _blank()
    staves = [_stave(100), _stave(300), _stave(600), _stave(800)]
    for s in staves:
        _draw_stave(img, s)
    img[100:361, 150] = 255   # first system, indented barline
    img[600:861, 10] = 255    # later system, normal barline

    systems = _cluster_by_bridges(staves, img)
    assert [len(s) for s in systems] == [2, 2]


def test_bridge_returns_single_system_when_all_connected():
    img = _blank()
    staves = [_stave(100), _stave(300), _stave(500)]
    for s in staves:
        _draw_stave(img, s)
    img[100:561, 10] = 255

    systems = _cluster_by_bridges(staves, img)
    assert [len(s) for s in systems] == [3]


def test_bridge_ignores_columns_right_of_the_search_window():
    """An inner barline between measures must not merge two systems."""
    img = _blank()
    staves = [_stave(100), _stave(600)]
    for s in staves:
        _draw_stave(img, s)
    img[100:661, WIDTH - 5] = 255  # far right: outside the search ratio

    systems = _cluster_by_bridges(staves, img)
    assert [len(s) for s in systems] == [1, 1]


def test_bridge_returns_none_without_image():
    assert _cluster_by_bridges([_stave(100), _stave(300)], None) is None
