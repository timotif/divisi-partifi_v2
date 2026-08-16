"""Tests for divider placement (backend/detection/dividers.py).

The fixture test encodes the property that motivated min-ink snapping: the
row a divider lands on should never carry more ink than the plain midpoint
would have.  The unit tests pin the tie-breaking and flag semantics.

Run with:
    cd backend && pytest tests/test_dividers.py -v
"""

import pathlib

import numpy as np
import pytest

from detection.dividers import (
    _SNAP_INK_THRESHOLD,
    _snap_to_clear_row,
    find_divider_y,
    staves_to_dividers,
)
from detection.projection import detect_staves

IMG_DIR = pathlib.Path(__file__).parent / "img"

FIXTURES = [
    ("fantasia.pdf", 0),
    ("schauspieldirektor.pdf", 4),
    ("score.pdf", 0),
]


# ---------------------------------------------------------------------------
# Fixture property: a snapped cut is never worse than the midpoint
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("filename, page_num", FIXTURES)
def test_divider_lands_on_least_ink_row(filename, page_num):
    """Every inter-stave divider sits on a row of minimal ink for its gap.

    This is the defect the old threshold scan had: when no row met
    _SNAP_INK_THRESHOLD it returned the midpoint untouched, leaving lower-ink
    rows nearby unused.  Measured against the pre-change implementation,
    36 of 46 fixture gaps failed this assertion.

    Note it is deliberately stricter than "no worse than the midpoint" --
    the old code passed that one, since falling back to the midpoint is never
    worse than the midpoint.
    """
    result = detect_staves(str(IMG_DIR / filename), page_num)
    projection = result["projection"]

    checked = 0
    for system in result["systems"]:
        for i in range(len(system) - 1):
            bottom = int(system[i][-1])
            top = int(system[i + 1][0])
            if top <= bottom + 1:
                continue

            y, _ = find_divider_y(system[i], system[i + 1], projection)
            gap_min = int(projection[bottom + 1:top].min())

            assert bottom < y < top, f"divider {y} escaped gap ({bottom}, {top})"
            assert int(projection[y]) == gap_min, (
                f"{filename} p{page_num} gap ({bottom}, {top}): "
                f"chose row {y} with ink {int(projection[y])}, "
                f"but the gap minimum is {gap_min}"
            )
            checked += 1

    assert checked > 0, "no gaps exercised -- fixture or detection changed"


@pytest.mark.parametrize("filename, page_num", FIXTURES)
def test_all_dividers_land_in_bounds(filename, page_num):
    """staves_to_dividers returns sane, sorted, in-page positions."""
    result = detect_staves(str(IMG_DIR / filename), page_num)
    img_height = result["projection"].shape[0]

    dividers, system_flags, snap_flags = staves_to_dividers(
        result["systems"], img_height, result["projection"]
    )

    assert len(dividers) == len(system_flags) == len(snap_flags)
    assert dividers == sorted(dividers), "dividers must be sorted by Y"
    assert all(0 <= y < img_height for y in dividers)


# ---------------------------------------------------------------------------
# Unit tests: _snap_to_clear_row
# ---------------------------------------------------------------------------


def test_picks_row_of_least_ink():
    """A single low-ink row wins even when it is far from ideal_y."""
    projection = np.full(100, 50, dtype=int)
    projection[20] = 3
    y, clean = _snap_to_clear_row(10, 90, 50, projection)
    assert y == 20
    assert clean is True


def test_dense_gap_picks_minimum_not_midpoint():
    """With no row under the threshold, still take the least-ink row."""
    projection = np.full(100, 80, dtype=int)
    projection[30] = 40  # best available, but well above the threshold
    y, clean = _snap_to_clear_row(10, 90, 50, projection)
    assert y == 30
    assert clean is False, "flag reports cut cleanliness, not whether a row was found"


def test_ties_break_toward_ideal():
    """Equal-ink candidates resolve to the one nearest ideal_y."""
    projection = np.full(100, 50, dtype=int)
    projection[[20, 60, 80]] = 5
    assert _snap_to_clear_row(10, 90, 62, projection)[0] == 60
    assert _snap_to_clear_row(10, 90, 22, projection)[0] == 20
    assert _snap_to_clear_row(10, 90, 79, projection)[0] == 80


def test_result_stays_strictly_inside_bounds():
    """The boundary rows themselves are staff lines and must never be chosen."""
    projection = np.full(100, 50, dtype=int)
    projection[10] = 0  # row_start -- excluded
    projection[90] = 0  # row_end -- excluded
    projection[55] = 8
    y, _ = _snap_to_clear_row(10, 90, 50, projection)
    assert y == 55


def test_threshold_boundary_is_inclusive():
    projection = np.full(100, 50, dtype=int)
    projection[50] = _SNAP_INK_THRESHOLD
    assert _snap_to_clear_row(10, 90, 50, projection)[1] is True

    projection[50] = _SNAP_INK_THRESHOLD + 1
    assert _snap_to_clear_row(10, 90, 50, projection)[1] is False


def test_degenerate_gap_returns_ideal():
    """Adjacent or inverted bounds leave no rows to choose from."""
    projection = np.full(100, 50, dtype=int)
    assert _snap_to_clear_row(50, 51, 50, projection) == (50, False)
    assert _snap_to_clear_row(60, 50, 55, projection) == (55, False)


# ---------------------------------------------------------------------------
# Unit tests: find_divider_y
# ---------------------------------------------------------------------------


def test_find_divider_y_without_projection_uses_midpoint():
    above = np.array([10, 12, 14, 16, 18])
    below = np.array([80, 82, 84, 86, 88])
    assert find_divider_y(above, below, None) == (49, False)


def test_find_divider_y_snaps_within_gap():
    above = np.array([10, 12, 14, 16, 18])
    below = np.array([80, 82, 84, 86, 88])
    projection = np.full(100, 50, dtype=int)
    projection[40] = 2
    y, clean = find_divider_y(above, below, projection)
    assert y == 40
    assert clean is True


def test_find_divider_y_handles_overlapping_staves():
    """Detection can emit overlapping spans; fall back rather than crash."""
    above = np.array([10, 12, 14, 16, 90])
    below = np.array([80, 82, 84, 86, 88])
    projection = np.full(100, 50, dtype=int)
    y, clean = find_divider_y(above, below, projection)
    assert clean is False
    assert y == 85
