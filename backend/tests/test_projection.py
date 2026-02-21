"""Regression tests for the staff/system detection pipeline.

Each case encodes the ground truth for a specific page:
  - n_systems: how many systems the page contains
  - staves_per_system: stave count per system (order: top → bottom)

Run with:
    cd backend && pytest tests/ -v
"""

import pytest

from detection.projection import detect_staves

# ---------------------------------------------------------------------------
# Ground truth
# ---------------------------------------------------------------------------
# (source, page_num, expected_systems, expected_staves_per_system)
#   source: path relative to backend/
#   page_num: 0-based (pass 0 for PNGs)
#   expected_staves_per_system: None = skip per-system stave count check

CASES = [
    # fantasia.pdf — 8 pages, 4 systems × 4 staves each (p3/p4: 5 systems)
    ("img/fantasia.pdf", 0, 4, [4, 4, 4, 4]),
    ("img/fantasia.pdf", 1, 4, [4, 4, 4, 4]),
    ("img/fantasia.pdf", 2, 4, [4, 4, 4, 4]),
    ("img/fantasia.pdf", 3, 5, [4, 4, 4, 4, 4]),
    ("img/fantasia.pdf", 4, 5, [4, 4, 4, 4, 4]),
    ("img/fantasia.pdf", 5, 4, [4, 4, 4, 4]),
    ("img/fantasia.pdf", 6, 4, [4, 4, 4, 4]),
    ("img/fantasia.pdf", 7, 4, [4, 4, 4, 4]),
    # schauspieldirektor — 2 systems × 12 staves
    ("img/schauspieldirektor_p4.png",  0, 2, [12, 12]),
    ("img/schauspieldirektor_p9.png",  0, 2, [12, 12]),
    ("img/schauspieldirektor_p11.png", 0, 2, [12, 12]),
    # score.pdf — 4 pages; p0 is a label page (barline displaced by instrument names)
    ("img/score.pdf", 0, 3, [5, 5, 5]),
    ("img/score.pdf", 1, 3, [5, 5, 5]),
    ("img/score.pdf", 2, 3, [5, 5, 5]),
    # p3: last page — 3 systems; system 3 has 9 staves (more staves than earlier pages)
    ("img/score.pdf", 3, 3, [5, 5, 9]),
    # music.png — single system, no bracket
    ("img/music.png", 0, 1, None),
]


def _case_id(case):
    source, page, _, _ = case
    name = source.split("/")[-1].rsplit(".", 1)[0]
    return f"{name}_p{page}"


@pytest.mark.parametrize(
    "source, page_num, expected_systems, expected_staves",
    CASES,
    ids=list(map(_case_id, CASES)),
)
def test_detection(source, page_num, expected_systems, expected_staves):
    result = detect_staves(source, page_num)
    systems = result["systems"]
    actual_staves = [len(s) for s in systems]

    assert len(systems) == expected_systems, (
        f"Expected {expected_systems} systems, got {len(systems)} "
        f"(staves per system: {actual_staves})"
    )

    if expected_staves is not None:
        assert actual_staves == expected_staves, (
            f"Expected staves per system {expected_staves}, got {actual_staves}"
        )
