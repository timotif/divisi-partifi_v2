"""OCR-based instrument-label detection for the left margin of labeled systems.

Geometry ported from wip/annotation-detection:backend/detection/annotations.py
(detect_instrument_labels, ~line 442) — scanning/trimming logic unchanged.

A wrong suggestion is expensive (misroutes a page to the wrong part); silence
is cheap. The acceptance filter in _clean_label() is deliberately strict and
has NO dictionary / fuzzy matching / roman-numeral disambiguation — those are
out of scope on purpose.
"""

import os
import re
import logging

import cv2 as cv
import numpy as np

logger = logging.getLogger(__name__)

# Use best-quality tessdata when available (downloaded separately to ~/.tessdata).
_BEST_TESSDATA = os.path.expanduser('~/.tessdata')
if os.path.isdir(_BEST_TESSDATA):
    os.environ.setdefault('TESSDATA_PREFIX', _BEST_TESSDATA)

try:
    import pytesseract
    _TESSERACT_AVAILABLE = True
except ImportError:
    _TESSERACT_AVAILABLE = False
    logger.warning("pytesseract not installed — instrument label OCR disabled")


def _ocr_text_crop(crop: np.ndarray) -> str:
    """OCR a pre-cropped grayscale image. Returns cleaned text (may be empty)."""
    if not _TESSERACT_AVAILABLE or crop.size == 0:
        return ''

    big = cv.resize(crop, None, fx=2, fy=2, interpolation=cv.INTER_CUBIC)
    try:
        raw = pytesseract.image_to_string(
            big, config='--psm 6 --oem 1 -l ita+eng'
        ).strip()
    except Exception:
        logger.debug("Tesseract failed on crop shape %s", crop.shape)
        return ''
    text = re.sub(r'[^\x20-\x7E\xC0-\xFF\n]', '', raw).strip()
    return re.sub(r'\s+', ' ', text).strip()


# ---------------------------------------------------------------------------
# Acceptance filter — bias hard toward silence (blank string) over a guess.
#
# Threshold measured against real OCR output (not guessed): 5 is the only
# value that rejects every garbage read ("vil","wall","val", stray symbols)
# while still accepting every real instrument name in the sample ("FLUTE"=5
# is the shortest). This also means short abbreviations ("cont", "VNE.") are
# deliberately rejected — a wrong 4-letter guess is expensive, silence is
# cheap. No case rule: uppercase-vs-lowercase is an artifact of one
# engraving's typography and won't generalize across publishers.
# ---------------------------------------------------------------------------

_MIN_ALPHA_CHARS = 5


def _clean_label(raw: str) -> str:
    """Clean an OCR string and return it, or '' if it doesn't clear the bar.

    Order: strip leading junk -> strip trailing junk (keep a trailing period)
    -> require >= 5 alphabetic chars -> title-case.
    """
    text = re.sub(r'^[^A-Za-zÀ-ÿ]+', '', raw).strip()
    # Strip trailing non-alphabetic junk, but keep one legitimate trailing
    # period (abbreviation punctuation, e.g. "Vne.").
    keep_period = text.endswith('.')
    text = text.rstrip()
    text = re.sub(r'[^A-Za-zÀ-ÿ.]+$', '', text)
    if keep_period and not text.endswith('.'):
        text += '.'
    text = text.strip()

    alpha_count = sum(1 for c in text if c.isalpha())
    if alpha_count < _MIN_ALPHA_CHARS:
        return ''

    return text.title()


def detect_instrument_labels(
    img: np.ndarray,
    systems: list,
    img_width: int,
    img_height: int,
    barline_info: list[dict] | None = None,
) -> list[list[str]]:
    """Detect instrument name labels in the left margin of labeled systems.

    A system is "labeled" when it has a detected initial barline (i.e.
    ``barline_info[i]['x']`` is not None). Labels appear in the horizontal
    strip ``[0, barline_x)`` beside each stave's 5-line span. Systems
    without a barline x are skipped (they have no label column).

    Args:
        img:          Grayscale page image.
        systems:      Detected systems from detect_staves().
        img_width:    Image width in backend pixels.
        img_height:   Image height in backend pixels.
        barline_info: Per-system barline metadata from detect_staves()
                      (list of {'x': int|None, 'span': ...}). Current
                      detect_staves() does NOT provide 'bracket_x' — this
                      always falls back to barline_x.

    Returns:
        List of systems, each a list of cleaned label strings (one per
        stave). Empty string where OCR found nothing or the result failed
        the acceptance filter.
    """
    if not _TESSERACT_AVAILABLE:
        return []

    all_systems: list[list[str]] = []
    for sys_idx, system in enumerate(systems):
        barline_x: int | None = None
        if barline_info and sys_idx < len(barline_info):
            barline_x = barline_info[sys_idx].get('x')

        if barline_x is None:
            all_systems.append(['' for _ in system])
            continue

        # bracket_x isn't produced by the current detect_staves() — this is
        # always the fallback-to-barline_x path (see docstring above).
        bracket_x: int | None = None
        if barline_info and sys_idx < len(barline_info):
            bracket_x = barline_info[sys_idx].get('bracket_x')
        scan_width = max(10, bracket_x if bracket_x is not None else barline_x)

        system_labels: list[str] = []
        for stave in system:
            stave_top    = max(0,          int(stave[0])  - 8)
            stave_bottom = min(img_height, int(stave[-1]) + 8)

            _TRIM_MIN_BLANK = 3
            _, binary_strip = cv.threshold(
                img[stave_top:stave_bottom, 0:scan_width],
                0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU,
            )
            col_ink = binary_strip.sum(axis=0)
            ncols = len(col_ink)
            blank_runs: list[tuple[int, int]] = []
            i = 0
            while i < ncols:
                if col_ink[i] == 0:
                    j = i
                    while j < ncols and col_ink[j] == 0:
                        j += 1
                    run_len = j - i
                    if run_len >= _TRIM_MIN_BLANK:
                        blank_runs.append((i, run_len))
                    i = j
                else:
                    i += 1
            if blank_runs:
                mid = ncols // 2
                right_half_runs = [(s, l) for s, l in blank_runs if s >= mid]
                if right_half_runs:
                    best_start, _ = max(right_half_runs, key=lambda r: r[1])
                    actual_right = best_start
                else:
                    actual_right = scan_width
            else:
                actual_right = scan_width

            strip_crop = img[stave_top:stave_bottom, 0:actual_right]
            raw_label = _ocr_text_crop(strip_crop)
            system_labels.append(_clean_label(raw_label))
        all_systems.append(system_labels)

    return all_systems
