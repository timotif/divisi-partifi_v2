"""Annotation detection for music score pages.

Two-stage pipeline:
  Stage 1 — Visual candidate detection: connected components on band-restricted
             binary images. Only inter-system bands are scanned — inside-system
             rows (where notes, lyrics, and slurs live) are excluded entirely.
  Stage 2 — OCR validation: pytesseract on each candidate crop to read and
             classify the text, filtering false positives (barline fragments,
             clef blobs, ornaments).

Public API:
  detect_annotations(img, systems, img_width, img_height, is_first_page)
  detect_instrument_labels(img, systems, img_width, img_height)
"""

import os
import re
import logging

import numpy as np
import cv2 as cv

logger = logging.getLogger(__name__)

# Use best-quality tessdata when available (downloaded separately to ~/.tessdata).
# Falls back to the system default if the directory doesn't exist.
_BEST_TESSDATA = os.path.expanduser('~/.tessdata')
if os.path.isdir(_BEST_TESSDATA):
    os.environ.setdefault('TESSDATA_PREFIX', _BEST_TESSDATA)

try:
    import pytesseract
    _TESSERACT_AVAILABLE = True
except ImportError:
    _TESSERACT_AVAILABLE = False
    logger.warning("pytesseract not installed — annotation OCR disabled")


# ---------------------------------------------------------------------------
# Stage 1 — Visual candidate detection constants
# ---------------------------------------------------------------------------

_CC_MIN_AREA              = 30    # px² — discard noise specks
_CC_MAX_WIDTH_RATIO       = 0.80  # fraction of band_width — discard full-width artifacts
_CC_MAX_ASPECT_RATIO      = 15.0  # w/h — discard horizontal rules / barlines
_CC_MAX_HEIGHT_RATIO_BLOB = 3.0   # h/w — discard tall-thin barline fragments
_CC_CLUSTER_GAP_X         = 40    # px — merge blobs within this horizontal distance
_CC_CLUSTER_GAP_Y         = 20    # px — merge blobs within this vertical distance

# Stage 2 — OCR validation
_OCR_MIN_ALPHA_CHARS = 2   # candidate must yield at least this many alphabetic chars
                           # (rejects single-symbol clef/digit fragments)

# Padding added to all returned bounding boxes
_PADDING_PX = 6

# Instrument label scan
_LABEL_MIN_ALPHA = 2    # min alpha chars for a valid label
_LABEL_MAX_ALPHA = 40   # max alpha chars (cap at reasonable instrument name)

# Tempo words for classification
_TEMPO_WORDS = frozenset({
    "allegro", "allegretto", "andante", "andantino", "adagio", "adagietto",
    "largo", "larghetto", "lento", "vivace", "vivacissimo", "presto", "prestissimo",
    "moderato", "grave", "sostenuto", "mosso", "con", "molto", "poco", "assai",
    "non", "troppo", "meno", "più", "sempre", "subito", "tempo",
})


# ---------------------------------------------------------------------------
# Modular classification helpers (independently testable)
# ---------------------------------------------------------------------------

def is_tempo_marking(text: str) -> bool:
    """Return True if the text contains a recognised tempo word."""
    words = re.findall(r'[a-zA-ZÀ-ÿ]+', text.lower())
    return any(w in _TEMPO_WORDS for w in words)


def is_bar_number(text: str) -> bool:
    """Return True if the text looks like a bar or rehearsal number/letter.

    Matches: '42', '1', 'A', 'B', '12a', '3–5', '100.'
    """
    stripped = text.strip().rstrip('.')
    return bool(
        re.match(r'^\d+([ab]|[–\-]\d+)?$', stripped)
        or re.match(r'^[A-Z]$', stripped)
    )


def is_rehearsal_mark(text: str) -> bool:
    """Return True if the text is a rehearsal letter or small number."""
    stripped = text.strip()
    return bool(
        re.match(r'^[A-Z]$', stripped)
        or re.match(r'^\d{1,3}$', stripped)
    )


def classify_marking(text: str) -> str:
    """Return annotation type: 'tempo', 'bar_number', or 'marking'."""
    if is_tempo_marking(text):
        return 'tempo'
    if is_bar_number(text):
        return 'bar_number'
    return 'marking'


# ---------------------------------------------------------------------------
# Band geometry helpers
# ---------------------------------------------------------------------------

def _system_strip_bounds(systems: list, img_height: int) -> list[tuple[int, int]]:
    """Compute the full vertical strip for every system.

    Uses inter-stave midpoints for the first/last stave of each system,
    and the inter-system midpoint between consecutive systems. This gives
    each system a strip that fully covers its staves including notes and
    lyrics that extend slightly above/below the outermost staff line.

    Returns:
        List of (top_y, bottom_y) tuples, one per system, in page-pixel space.
    """
    bounds: list[tuple[int, int]] = []
    n = len(systems)
    for i, system in enumerate(systems):
        if not system:
            continue
        sys_top    = int(system[0][0])   # top of first staff line
        sys_bottom = int(system[-1][-1]) # bottom of last staff line

        # Typical half-gap within this system (used for boundary estimates)
        intra_gaps: list[int] = []
        for si in range(len(system) - 1):
            gap = int(system[si + 1][0]) - int(system[si][-1])
            intra_gaps.append(gap)
        half_gap = (int(np.median(intra_gaps)) // 2) if intra_gaps else 30

        # Top boundary
        if i == 0:
            top_y = max(0, sys_top - half_gap)
        else:
            prev_bottom = int(systems[i - 1][-1][-1])
            top_y = (prev_bottom + sys_top) // 2

        # Bottom boundary
        if i < n - 1:
            next_top  = int(systems[i + 1][0][0])
            bottom_y  = (sys_bottom + next_top) // 2
        else:
            bottom_y = min(img_height, sys_bottom + half_gap)

        bounds.append((top_y, bottom_y))
    return bounds


def _inter_system_bands(systems: list, img_height: int) -> list[tuple[int, int]]:
    """Return the Y bands where annotations legitimately appear.

    Three kinds of bands:
    1. Above the first system (header / tempo / composer zone).
    2. Between consecutive systems (tempo, bar numbers, rehearsal marks).
       This is the raw gap between the bottom staff line of system N and the
       top staff line of system N+1, trimmed by a small margin so we don't
       accidentally scan inside the stave itself.
    3. Below the last system (footnotes, publisher info).

    Everything *inside* a system — from its first top staff line to its last
    bottom staff line — is excluded to avoid lyrics, dynamics, and slurs.

    Returns:
        List of (band_top, band_bottom) tuples, ordered top-to-bottom.
    """
    if not systems:
        return []

    # Compute typical intra-system half-gap as a scan margin
    half_gaps: list[int] = []
    for system in systems:
        for si in range(len(system) - 1):
            gap = int(system[si + 1][0]) - int(system[si][-1])
            half_gaps.append(gap // 2)
    margin = int(np.median(half_gaps)) if half_gaps else 20

    bands: list[tuple[int, int]] = []
    n = len(systems)

    for i, system in enumerate(systems):
        if not system:
            continue
        sys_top    = int(system[0][0])
        sys_bottom = int(system[-1][-1])

        # --- Band above system i ---
        if i == 0:
            # Above the first system: from page top to just above first staff line
            above_top    = 0
            above_bottom = max(0, sys_top - margin)
            if above_bottom > above_top:
                bands.append((above_top, above_bottom))
        else:
            # Between system i-1 bottom and system i top
            prev_bottom = int(systems[i - 1][-1][-1])
            gap_top     = prev_bottom + margin
            gap_bottom  = sys_top    - margin
            if gap_bottom > gap_top:
                bands.append((gap_top, gap_bottom))

        # --- Band below the last system ---
        if i == n - 1:
            below_top    = sys_bottom + margin
            below_bottom = img_height
            if below_bottom > below_top:
                bands.append((below_top, below_bottom))

    return bands


# ---------------------------------------------------------------------------
# Stage 1 — connected-component candidate finder
# ---------------------------------------------------------------------------

def _find_candidates_in_band(
    binary: np.ndarray,
    band_top: int,
    band_bottom: int,
    img_width: int,
    img_height: int,
) -> list[tuple[int, int, int, int]]:
    """Find candidate text-box regions within a horizontal band.

    Args:
        binary:      Full-page binarized image (ink=255).
        band_top:    Inclusive top row of the band.
        band_bottom: Exclusive bottom row of the band.
        img_width:   Full page width (for ratio filters and clamping).
        img_height:  Full page height (for clamping).

    Returns:
        List of (x, y, w, h) in full-image backend-pixel space.
    """
    crop = binary[band_top:band_bottom, :]
    if crop.shape[0] == 0:
        return []

    band_h = crop.shape[0]
    n, _, stats, _ = cv.connectedComponentsWithStats(crop, connectivity=8)

    blobs: list[tuple[int, int, int, int]] = []
    for i in range(1, n):
        x    = int(stats[i, cv.CC_STAT_LEFT])
        y    = int(stats[i, cv.CC_STAT_TOP]) + band_top
        w    = int(stats[i, cv.CC_STAT_WIDTH])
        h    = int(stats[i, cv.CC_STAT_HEIGHT])
        area = int(stats[i, cv.CC_STAT_AREA])

        if area < _CC_MIN_AREA:
            continue
        if w > img_width * _CC_MAX_WIDTH_RATIO:
            continue
        if h > 0 and w / h > _CC_MAX_ASPECT_RATIO:
            continue
        if w > 0 and h / w > _CC_MAX_HEIGHT_RATIO_BLOB:
            continue

        blobs.append((x, y, w, h))

    if not blobs:
        return []

    # Cluster nearby blobs into phrase groups (sort top-to-bottom, left-to-right)
    blobs.sort(key=lambda b: (b[1], b[0]))
    cx, cy, cw, ch = blobs[0]
    clusters: list[tuple[int, int, int, int]] = []

    for x, y, w, h in blobs[1:]:
        x_gap = x - (cx + cw)
        y_gap = y - (cy + ch)
        # Merge if close horizontally OR close vertically (multi-line phrase)
        if x_gap <= _CC_CLUSTER_GAP_X and y_gap <= _CC_CLUSTER_GAP_Y:
            new_right  = max(cx + cw, x + w)
            new_bottom = max(cy + ch, y + h)
            cx = min(cx, x)
            cy = min(cy, y)
            cw = new_right  - cx
            ch = new_bottom - cy
        else:
            clusters.append((cx, cy, cw, ch))
            cx, cy, cw, ch = x, y, w, h
    clusters.append((cx, cy, cw, ch))

    # Add padding and clamp to image bounds
    pad = _PADDING_PX
    result: list[tuple[int, int, int, int]] = []
    for x, y, w, h in clusters:
        rx = max(0, x - pad)
        ry = max(0, y - pad)
        rr = min(img_width,  x + w + pad)
        rb = min(img_height, y + h + pad)
        result.append((rx, ry, rr - rx, rb - ry))

    return result


# ---------------------------------------------------------------------------
# Stage 2 — OCR validation
# ---------------------------------------------------------------------------

def _ocr_text_crop(crop: np.ndarray) -> str:
    """OCR a pre-cropped grayscale image. Returns cleaned text (may be empty).

    Upscales 2× (cubic) before passing to Tesseract. Uses:
    - PSM 6 (uniform block) — handles single- and multi-line labels equally,
      and correctly distinguishes 'I' from 'II' in italic serif score fonts
      when used with the best-quality tessdata.
    - OEM 1 (LSTM only) with Italian+English language model.
    - Newlines are collapsed to a single space so multi-line labels like
      "Violoncello\\ne Basso" become "Violoncello e Basso".
    """
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
    # Strip non-printable chars, then collapse all whitespace (including
    # newlines from multi-line labels) to a single space.
    text = re.sub(r'[^\x20-\x7E\xC0-\xFF\n]', '', raw).strip()
    return re.sub(r'\s+', ' ', text).strip()


def _ocr_text(img_gray: np.ndarray, x: int, y: int, w: int, h: int) -> str:
    """OCR a region of a full-page image given bounding box coords."""
    return _ocr_text_crop(img_gray[y:y + h, x:x + w])


def _ocr_validate(
    img_gray: np.ndarray,
    x: int,
    y: int,
    w: int,
    h: int,
) -> dict | None:
    """OCR a candidate crop and return classification, or None if no text."""
    text = _ocr_text(img_gray, x, y, w, h)
    alpha_count = sum(1 for c in text if c.isalpha())
    if alpha_count < _OCR_MIN_ALPHA_CHARS:
        return None
    return {'text': text, 'type': classify_marking(text)}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_annotations(
    img: np.ndarray,
    systems: list,
    img_width: int,
    img_height: int,
    is_first_page: bool = False,
) -> dict:
    """Detect header and marking regions in inter-system bands using OCR.

    Scanning strategy: only processes inter-system horizontal bands (above
    the first system, between systems, below the last system). Inside-system
    rows — where notes, lyrics, slurs, and dynamics live — are excluded
    entirely. This drastically reduces false positives.

    Args:
        img:           Grayscale page image (numpy uint8 array).
        systems:       Detected systems from detect_staves(). Each system is a
                       list of staves; each stave is an ndarray of 5 Y positions.
        img_width:     Image width in backend pixels.
        img_height:    Image height in backend pixels.
        is_first_page: If True, treat the band above system 0 as a header zone
                       and merge all text blocks there into a single header rect.

    Returns:
        {
            "header":   (x, y, w, h) or None,    # backend-pixel space
            "markings": [(x, y, w, h), ...],      # backend-pixel space
        }
    """
    if not _TESSERACT_AVAILABLE:
        return {"header": None, "markings": []}

    if not systems:
        return {"header": None, "markings": []}

    _, binary = cv.threshold(img, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU)

    bands   = _inter_system_bands(systems, img_height)
    header  = None
    markings: list[tuple[int, int, int, int]] = []

    for band_idx, (band_top, band_bottom) in enumerate(bands):
        candidates = _find_candidates_in_band(
            binary, band_top, band_bottom, img_width, img_height
        )

        # The very first band (above system 0) is the header zone on page 0
        is_header_band = is_first_page and band_idx == 0

        validated: list[tuple[int, int, int, int]] = []
        for x, y, w, h in candidates:
            result = _ocr_validate(img, x, y, w, h)
            if result is not None:
                validated.append((x, y, w, h))

        if not validated:
            continue

        if is_header_band:
            # Merge ALL validated blocks in the header zone into one rectangle
            xs = [x         for x, _y, _w, _h in validated]
            ys = [y         for _x, y, _w, _h in validated]
            xe = [x + w     for x, _y, w, _h  in validated]
            ye = [y + h     for _x, y, _w, h  in validated]
            hx = min(xs);  hy = min(ys)
            hw = max(xe) - hx;  hh = max(ye) - hy
            # Sanity cap: header can't be taller than 40% of the page
            if hh <= img_height * 0.40:
                header = (hx, hy, hw, hh)
            # Any leftover validated blocks BELOW the merged header rect
            # that are still inside the header band become markings
            for x, y, w, h in validated:
                if y >= hy + hh:
                    markings.append((x, y, w, h))
        else:
            markings.extend(validated)

    return {"header": header, "markings": markings}


def detect_instrument_labels(
    img: np.ndarray,
    systems: list,
    img_width: int,
    img_height: int,
    barline_info: list[dict] | None = None,
) -> list[list[dict]]:
    """Detect instrument name labels in the left margin of labeled systems.

    A system is "labeled" when it has a detected initial barline (i.e.
    ``barline_info[i]['x']`` is not None). Labels appear in the horizontal
    strip ``[0, barline_x)`` beside each stave's 5-line span. Systems
    without a barline x are skipped (they have no label column).

    Using the exact barline_x from the detection pipeline (rather than a
    fixed fraction) avoids scanning into clef/accidental territory for
    non-labeled systems and gives a precise right boundary for the scan.

    Args:
        img:          Grayscale page image.
        systems:      Detected systems from detect_staves().
        img_width:    Image width in backend pixels.
        img_height:   Image height in backend pixels.
        barline_info: Per-system barline metadata from detect_staves()
                      (list of {'x': int|None, 'span': ...}).  If None or
                      shorter than systems, falls back to _LABEL_SCAN_FRACTION.

    Returns:
        List of systems, each a list of dicts per stave:
            {'name': str, 'short_name': str, 'is_abbreviated': bool}
        Systems without a barline x return empty-string entries for each stave.
    """
    if not _TESSERACT_AVAILABLE:
        return []

    all_systems: list[list[dict]] = []
    for sys_idx, system in enumerate(systems):
        # Determine scan width for this system from barline_x
        barline_x: int | None = None
        if barline_info and sys_idx < len(barline_info):
            barline_x = barline_info[sys_idx].get('x')

        if barline_x is None:
            # No barline detected → not a labeled system; return empty entries
            all_systems.append([
                {'name': '', 'short_name': '', 'is_abbreviated': False}
                for _ in system
            ])
            continue

        # Use bracket_x (left edge of bracket/barline complex) as the right
        # bound so the bracket itself is excluded from the crop. Falls back to
        # barline_x if bracket_x was not recorded (older barline_info dicts).
        bracket_x: int | None = None
        if barline_info and sys_idx < len(barline_info):
            bracket_x = barline_info[sys_idx].get('bracket_x')
        scan_width = max(10, bracket_x if bracket_x is not None else barline_x)

        system_labels: list[dict] = []
        for stave in system:
            # Row range: slightly above/below the 5 staff lines
            stave_top    = max(0,          int(stave[0])  - 8)
            stave_bottom = min(img_height, int(stave[-1]) + 8)

            # Trim bracket ink from the right edge of the crop.
            # The vertical ink profile (sum of ink pixels per column) has a
            # clear blank gap between the text and the bracket complex.
            # Find the rightmost all-zero column and use col+1 as the actual
            # right boundary — this recovers trailing characters (e.g. the
            # second "I" in "Violino II") that sit close to the bracket.
            _, binary_strip = cv.threshold(
                img[stave_top:stave_bottom, 0:scan_width],
                0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU,
            )
            col_ink = binary_strip.sum(axis=0)
            blank_cols = np.where(col_ink == 0)[0]
            if blank_cols.size > 0:
                actual_right = int(blank_cols[-1]) + 1
            else:
                actual_right = scan_width

            # OCR the whole stave strip at once — one call per stave is more
            # accurate than per-blob calls because Tesseract uses word context.
            strip_crop = img[stave_top:stave_bottom, 0:actual_right]
            label = _ocr_text_crop(strip_crop)
            # Strip leading non-alpha chars (misread clefs, brackets)
            label = re.sub(r'^[^A-Za-zÀ-ÿ]+', '', label).strip()

            is_abbrev = label.endswith('.') or (0 < len(label) <= 5)
            system_labels.append({
                'name':           label,
                'short_name':     label,
                'is_abbreviated': is_abbrev,
            })
        all_systems.append(system_labels)

    return all_systems
