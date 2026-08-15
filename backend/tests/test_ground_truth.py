"""Accuracy regression against a human-placed ground truth.

The other test modules assert *properties* (a cut lands on minimal ink, stays
in bounds).  This one asserts *accuracy*: how close automatic detection gets
to where a human actually put the dividers, on a real 27-page score.

Ground truth is `buxtehude_ground_truth.json`, exported from a setup the user
placed by hand over pages 2-16 (1-indexed score range 3-17).  Coordinates are
display pixels at `display_width`; they are scaled to backend pixels here.

Baseline: median error 0.17 mm, 90th percentile 0.66 mm.  The thresholds
below sit above those with headroom, so this fails on regression rather than
on noise.

Every page in the score range now matches the human divider count, so both
accuracy and count are asserted over the whole range.  The pages that used
to be excluded each exposed a distinct defect:

  - p2, p3: all staves collapsed into one system.  Grouping relied on a
    single page-global barline column, but a first system labelled
    ``VIOLIN I`` carries its barline ~160 px right of later systems labelled
    ``V. I``, so whole systems went unseen.  Systems are now grouped by
    testing whether *any* column bridges the gap between two staves.
  - p5, p11, p12: spurious staves synthesized over lyric lines, some
    overlapping their neighbour.  Rescued candidates are now checked for a
    staff-width ink row and merged when they abut.
  - p16: a colophon paragraph accepted as a 210 px stave among 60 px ones.
"""

import json
import pathlib

import numpy as np
import pymupdf as fitz
import pytest

from detection.dividers import staves_to_dividers
from detection.projection import detect_staves

IMG_DIR = pathlib.Path(__file__).parent / "img"
PDF = IMG_DIR / "buxtehude.pdf"
GROUND_TRUTH = IMG_DIR / "buxtehude_ground_truth.json"

# The whole score range (0-based). Front matter and the pre-extracted parts
# that follow p16 are outside the range a user would select.
CLEAN_PAGES = list(range(2, 17))

# Count now matches the human on every page in the range.
EXACT_COUNT_PAGES = CLEAN_PAGES

MEDIAN_ERROR_MM = 0.35
# Per-page 90th percentile. p2 reaches 2.25 mm: its three systems are packed
# tightly enough that a handful of cuts land visibly off the human's line
# while the median stays at 0.16 mm.
P90_ERROR_MM = 1.0
PAGE_P90_ERROR_MM = 2.5
DPI = 300


@pytest.fixture(scope="module")
def ground_truth():
    return json.loads(GROUND_TRUTH.read_text())


def _backend_scale(page_num: int, img_height: int, display_width: int) -> float:
    """Ratio converting stored display pixels to backend (300 DPI) pixels."""
    with fitz.open(PDF) as doc:
        rect = doc[page_num].rect
    backend_width = round(rect.width / rect.height * img_height)
    return backend_width / display_width


def _errors_mm(page_num: int, ground_truth: dict) -> list[float]:
    """Distance from each human divider to the nearest detected one, in mm."""
    result = detect_staves(str(PDF), page_num)
    projection = result["projection"]
    img_height = projection.shape[0]

    detected, _, _ = staves_to_dividers(result["systems"], img_height, projection)
    if not detected:
        pytest.fail(f"page {page_num}: detection returned no dividers")

    scale = _backend_scale(page_num, img_height, ground_truth["display_width"])
    human = [y * scale for y in ground_truth["dividersByPage"][str(page_num)]]

    return [min(abs(y - d) for d in detected) / DPI * 25.4 for y in human]


@pytest.mark.parametrize("page_num", CLEAN_PAGES)
def test_divider_accuracy_against_human(page_num, ground_truth):
    """Detected cuts stay close to where a human put them."""
    errors = _errors_mm(page_num, ground_truth)
    median = float(np.median(errors))

    assert median <= MEDIAN_ERROR_MM, (
        f"page {page_num}: median error {median:.2f} mm exceeds {MEDIAN_ERROR_MM} mm"
    )


def test_overall_accuracy(ground_truth):
    """Aggregate accuracy across all clean pages."""
    errors: list[float] = []
    for page_num in CLEAN_PAGES:
        errors.extend(_errors_mm(page_num, ground_truth))

    median = float(np.median(errors))
    p90 = float(np.percentile(errors, 90))

    assert median <= MEDIAN_ERROR_MM, f"median {median:.2f} mm"
    assert p90 <= P90_ERROR_MM, f"90th percentile {p90:.2f} mm"


@pytest.mark.parametrize("page_num", EXACT_COUNT_PAGES)
def test_divider_count_matches_human(page_num, ground_truth):
    """Detection finds the same number of dividers the human placed.

    Count errors -- not position errors -- are the live failure mode, so this
    guards the pages that currently get it right.
    """
    result = detect_staves(str(PDF), page_num)
    detected, _, _ = staves_to_dividers(
        result["systems"], result["projection"].shape[0], result["projection"]
    )
    expected = len(ground_truth["dividersByPage"][str(page_num)])

    assert len(detected) == expected
