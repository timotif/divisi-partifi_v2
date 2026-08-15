"""Tests for the instrument-label OCR acceptance filter (detection/labels.py).

Filter-only, no fixtures — fast. Cases are measured real OCR outputs, not
guesses: the >=5 alpha-char threshold is the only value (see labels.py) that
rejects every garbage read here while accepting every real instrument name.

Run with:
    cd backend && pytest tests/test_labels.py -v
"""

import pytest

from detection import labels


# Garbage OCR reads (misread clefs, barline fragments, stray symbols).
@pytest.mark.parametrize("raw", ["vil", "wall", "val", "|", "s", "3", "4]", "v"])
def test_rejects_garbage(raw):
    assert labels._clean_label(raw) == ''


# Real instrument names, all title-cased on accept.
@pytest.mark.parametrize("raw,expected", [
    ("FLUTE", "Flute"),
    ("CANTUS", "Cantus"),
    ("TENORE", "Tenore"),
    ("BASSO", "Basso"),
    ("VIOLONE", "Violone"),
    ("CONTINUO", "Continuo"),
])
def test_accepts_real_names(raw, expected):
    assert labels._clean_label(raw) == expected


# Trailing junk (brackets/pipes) is stripped; tested on names long enough to
# survive the length filter on their own.
@pytest.mark.parametrize("raw,expected", [
    ("CONTINUO}", "Continuo"),
    ("VIOLONE |", "Violone"),
])
def test_strips_trailing_junk(raw, expected):
    assert labels._clean_label(raw) == expected


# Deliberately rejected: legitimate abbreviations, but too short to trust
# from OCR alone. A wrong suggestion misroutes a page to the wrong part
# (expensive); silence is cheap, so short abbreviations are sacrificed.
@pytest.mark.parametrize("raw", ["cont}", "VNE. |"])
def test_rejects_short_abbreviations(raw):
    assert labels._clean_label(raw) == ''


def test_all_blank_when_tesseract_unavailable(monkeypatch):
    monkeypatch.setattr(labels, "_TESSERACT_AVAILABLE", False)
    result = labels.detect_instrument_labels(
        img=None, systems=[[1, 2]], img_width=100, img_height=100,
        barline_info=[{"x": 10}],
    )
    assert result == []


def test_ocr_exception_propagates_for_caller_to_catch(monkeypatch):
    """detect_instrument_labels() itself does not swallow OCR errors — the
    /detect endpoint in app.py wraps this call in try/except and falls back
    to an all-blank suggested_names array on any exception (verified there,
    not here, since this file is filter-only/no-Flask per its docstring)."""
    import numpy as np

    monkeypatch.setattr(labels, "_TESSERACT_AVAILABLE", True)

    def _boom(crop):
        raise RuntimeError("tesseract not found")

    monkeypatch.setattr(labels, "_ocr_text_crop", _boom)

    img = np.zeros((200, 200), dtype="uint8")
    systems = [[np.array([10, 20, 30, 40, 50])]]
    barline_info = [{"x": 60, "span": (5, 55)}]

    with pytest.raises(RuntimeError):
        labels.detect_instrument_labels(img, systems, 200, 200, barline_info)
