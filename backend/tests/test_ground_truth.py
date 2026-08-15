"""Accuracy regression against a human-placed ground truth.

The other test modules assert *properties* (a cut lands on minimal ink, stays
in bounds).  This one asserts *accuracy*: how close automatic detection gets
to where a human actually put the dividers, on a real 27-page score.

Ground truth is `buxtehude_ground_truth.json`, exported from a setup the user
placed by hand over pages 2-16 (1-indexed score range 3-17).  Coordinates are
display pixels at `display_width`; they are scaled to backend pixels here.

Baseline at the time of writing: median error 0.16 mm, 90th percentile
0.54 mm.  The thresholds below sit above those with headroom, so this fails
on regression rather than on noise.

Known open failures, deliberately not asserted (see handoff items 7-8):
  - p2, p3: system dividers under-detected (1 found where 2-3 expected)
  - p5, p11, p12, p16: spurious extra dividers (25/26/28/13 found where
    24/24/24/12).  Positions on these pages are still accurate, so p5 is
    exercised for accuracy but excluded from the count check.
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

# Pages where detection currently matches the human closely. Excludes the
# known-broken pages listed in the module docstring.
CLEAN_PAGES = [4, 5, 6, 7, 8, 9, 10, 13, 14, 15]

# Subset whose divider *count* also matches; p5 is accurate but finds one extra.
EXACT_COUNT_PAGES = [p for p in CLEAN_PAGES if p != 5]

MEDIAN_ERROR_MM = 0.35
P90_ERROR_MM = 1.0
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
