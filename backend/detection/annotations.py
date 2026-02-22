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

import re
import logging

import numpy as np
import cv2 as cv

logger = logging.getLogger(__name__)

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
_LABEL_SCAN_FRACTION  = 0.12   # leftmost fraction of page to scan for labels
_LABEL_MIN_ALPHA      = 2      # min alpha chars for a valid label
_LABEL_MAX_ALPHA      = 40     # max alpha chars (cap at reasonable instrument name)

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

def _ocr_text(img_gray: np.ndarray, x: int, y: int, w: int, h: int) -> str:
    """OCR a candidate crop. Returns the cleaned text string (may be empty)."""
    if not _TESSERACT_AVAILABLE:
        return ''

    crop = img_gray[y:y + h, x:x + w]
    if crop.size == 0:
        return ''

    try:
        # PSM 6: uniform block of text — better than PSM 7 for multi-word clusters
        raw = pytesseract.image_to_string(crop, config='--psm 6 --oem 1').strip()
    except Exception:
        logger.debug("Tesseract failed on crop (%d,%d,%d,%d)", x, y, w, h)
        return ''

    # Strip non-printable / control characters
    return re.sub(r'[^\x20-\x7E\xC0-\xFF]', '', raw).strip()


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
            xs = [x         for x, y, w, h in validated]
            ys = [y         for x, y, w, h in validated]
            xe = [x + w     for x, y, w, h in validated]
            ye = [y + h     for x, y, w, h in validated]
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
) -> list[list[dict]]:
    """Detect instrument name labels in the left margin beside each stave.

    Scans the leftmost ~12% of the page beside each stave's 5-line span.
    The scan strip ends before the initial barline to avoid barline fragments.

    A valid label must contain at least _LABEL_MIN_ALPHA alphabetic characters
    to reject clef symbols, accidentals, and time-signature digits that OCR
    sometimes misreads as characters.

    Args:
        img:       Grayscale page image.
        systems:   Detected systems from detect_staves().
        img_width: Image width in backend pixels.
        img_height:Image height in backend pixels.

    Returns:
        List of systems, each a list of dicts per stave:
            {'name': str, 'short_name': str, 'is_abbreviated': bool}
        Empty string if no valid label found.
    """
    if not _TESSERACT_AVAILABLE:
        return []

    _, binary = cv.threshold(img, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU)
    scan_width = max(50, int(img_width * _LABEL_SCAN_FRACTION))

    all_systems: list[list[dict]] = []
    for system in systems:
        system_labels: list[dict] = []
        for stave in system:
            # Scan row range: from slightly above top staff line to slightly
            # below bottom staff line (the 5-line span only).
            stave_top    = max(0,          int(stave[0])  - 8)
            stave_bottom = min(img_height, int(stave[-1]) + 8)

            # Crop to left-margin strip for this stave
            binary_crop = binary[stave_top:stave_bottom, 0:scan_width]
            n, _, stats, _ = cv.connectedComponentsWithStats(binary_crop, connectivity=8)

            blobs: list[tuple[int, int, int, int]] = []
            for i in range(1, n):
                x    = int(stats[i, cv.CC_STAT_LEFT])
                y    = int(stats[i, cv.CC_STAT_TOP]) + stave_top
                w    = int(stats[i, cv.CC_STAT_WIDTH])
                h    = int(stats[i, cv.CC_STAT_HEIGHT])
                area = int(stats[i, cv.CC_STAT_AREA])
                if area < _CC_MIN_AREA:
                    continue
                # Discard blobs that span the full scan width (likely staff/barline)
                if w >= scan_width * 0.85:
                    continue
                blobs.append((x, y, w, h))

            if not blobs:
                system_labels.append({'name': '', 'short_name': '', 'is_abbreviated': False})
                continue

            # Collect and OCR each blob; keep only those with enough alpha chars
            label_parts: list[str] = []
            for x, y, w, h in sorted(blobs, key=lambda b: b[0]):
                text = _ocr_text(img, x, y, w, h)
                alpha_count = sum(1 for c in text if c.isalpha())
                if _LABEL_MIN_ALPHA <= alpha_count <= _LABEL_MAX_ALPHA:
                    label_parts.append(text.strip())

            label = ' '.join(label_parts).strip()
            # Remove stray leading punctuation / digits from misread clefs
            label = re.sub(r'^[^A-Za-zÀ-ÿ]+', '', label).strip()

            is_abbrev = label.endswith('.') or (0 < len(label) <= 5)
            system_labels.append({
                'name':           label,
                'short_name':     label,
                'is_abbreviated': is_abbrev,
            })
        all_systems.append(system_labels)

    return all_systems
