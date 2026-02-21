"""Horizontal projection profile for staff line detection.

Can be used as a library or run directly for visual debugging:
    python projection.py [image_or_pdf] [page_num]

Pipeline:
    1. Binarize (grayscale + Otsu threshold)
    2. Horizontal projection (sum ink pixels per row → 1D signal)
    3. Peak detection (scipy.find_peaks on smoothed projection)
    4. Cluster peaks into staves (groups of 5 with regular spacing)
       - Repair groups of 3–4 by interpolating missing lines
       - Trim groups of 6 by dropping the worst-fitting line
       - Split oversized groups into stave-sized chunks
    5. "Squint" rescue pass: heavy blur merges each stave's 5 lines into
       one broad hill, then synthesize staves for uncovered hills
    6. Cluster staves into systems (large inter-stave gaps)
    7. Confidence scoring with explanations
"""

import sys

import cv2 as cv
import numpy as np
from scipy.signal import find_peaks

from .pdf import load_pdf_page


# ---------------------------------------------------------------------------
# Step 1 — Binarize
# ---------------------------------------------------------------------------

def binarize(img):
    """Convert to grayscale and binarize using Otsu's automatic threshold.

    Otsu analyzes the pixel intensity histogram and picks the threshold that
    best separates ink from paper. The result is inverted: ink pixels = 255.
    """
    gray = cv.cvtColor(img, cv.COLOR_BGR2GRAY) if len(img.shape) == 3 else img.copy()
    _, binary = cv.threshold(gray, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU)
    return binary


# ---------------------------------------------------------------------------
# Step 2 — Horizontal projection
# ---------------------------------------------------------------------------

def horizontal_projection(binary):
    """Count ink pixels in each row → 1D array of length = image height.

    Staff lines span nearly the full page width, so their rows have high counts.
    Notes, text, and whitespace produce much lower counts.
    """
    return np.sum(binary > 0, axis=1).astype(np.float64)


# ---------------------------------------------------------------------------
# Step 3 — Peak detection
# ---------------------------------------------------------------------------

def find_staff_line_peaks(projection, min_prominence_ratio=0.15):
    """Find local maxima in the projection that correspond to staff lines.

    Args:
        projection: 1D array from horizontal_projection().
        min_prominence_ratio: how much a peak must rise above its surroundings,
            as a fraction of the maximum projection value. Higher = stricter.

    Returns:
        peaks: Y positions (row indices) of detected staff lines.
        smoothed: the smoothed projection (for visualization).
    """
    # Light moving-average smoothing to suppress noise from noteheads / text.
    # Kernel size scales with image height (~1/500th), must be odd and >= 3.
    kernel_size = max(3, len(projection) // 500)
    if kernel_size % 2 == 0:
        kernel_size += 1
    smoothed = np.convolve(
        projection, np.ones(kernel_size) / kernel_size, mode='same'
    )

    # Staff lines within a stave are ~1–2% of image height apart.
    # min_distance prevents detecting the same line twice.
    min_distance = max(3, len(projection) // 300)
    min_prominence = np.max(projection) * min_prominence_ratio

    peaks, _ = find_peaks(smoothed, prominence=min_prominence, distance=min_distance)
    return peaks, smoothed


# ---------------------------------------------------------------------------
# Step 4 — Cluster peaks into staves
# ---------------------------------------------------------------------------

def cluster_into_staves(peaks, expected_lines=5, tolerance=0.4):
    """Group peaks into staves of ``expected_lines`` lines each.

    Approach:
      1. Estimate the typical spacing between adjacent staff lines (25th
         percentile of all inter-peak gaps — robust to outlier inter-stave gaps).
      2. Compute the maximum span of one stave: (lines - 1) * spacing * (1 + tol).
      3. Walk through peaks: start a new group whenever the next peak would
         exceed the max span.
      4. For each group, accept / repair / trim / split as needed.

    Returns:
        staves: list of arrays, each with ``expected_lines`` Y positions.
        orphans: peaks that couldn't be grouped into any stave.
    """
    if len(peaks) < expected_lines:
        return [], peaks.tolist()

    gaps = np.diff(peaks)
    sorted_gaps = np.sort(gaps)
    typical_spacing = sorted_gaps[max(0, len(sorted_gaps) // 4)]
    max_stave_span = typical_spacing * (expected_lines - 1) * (1 + tolerance)
    # Max gap between two adjacent lines in a stave. Anything larger means
    # the peaks aren't part of the same stave (e.g. slur/bracket artifact).
    # 2× is lenient enough for noisy low-res peaks (~6-7px at typical=4px)
    # but still rejects bracket/slur gaps (~42px at typical=11px = 3.8×).
    max_line_gap = typical_spacing * 2

    # --- Split peaks into candidate groups ---
    groups = []
    current_group = [peaks[0]]
    for i, gap in enumerate(gaps):
        span_with_next = peaks[i + 1] - current_group[0]
        if gap > max_line_gap or span_with_next > max_stave_span:
            groups.append(np.array(current_group))
            current_group = [peaks[i + 1]]
        else:
            current_group.append(peaks[i + 1])
    groups.append(np.array(current_group))

    # --- Validate / fix each group ---
    staves = []
    orphans = []
    for group in groups:
        n = len(group)
        if n == expected_lines:
            staves.append(group)
        elif expected_lines - 2 <= n < expected_lines:
            repaired = _repair_stave(group, expected_lines, typical_spacing, tolerance)
            if repaired is not None:
                staves.append(repaired)
            else:
                orphans.extend(group.tolist())
        elif n == expected_lines + 1:
            staves.append(_trim_stave(group))
        elif n > expected_lines:
            sub_staves, sub_orphans = _split_oversized_group(
                group, expected_lines, typical_spacing, tolerance
            )
            staves.extend(sub_staves)
            orphans.extend(sub_orphans)
        else:
            orphans.extend(group.tolist())

    return staves, orphans


def _repair_stave(group, expected_lines, typical_spacing, tolerance):
    """Fill in missing lines by evenly spacing ``expected_lines`` across the group span.

    Only succeeds if the implied spacing is close to ``typical_spacing``.
    """
    span = group[-1] - group[0]
    implied_spacing = span / (expected_lines - 1)
    if typical_spacing > 0 and abs(implied_spacing - typical_spacing) / typical_spacing > tolerance:
        return None
    return np.array([
        int(round(group[0] + i * implied_spacing)) for i in range(expected_lines)
    ])


def _trim_stave(group):
    """Drop the one line whose removal yields the most uniform spacing."""
    best = None
    best_var = float('inf')
    for i in range(len(group)):
        candidate = np.delete(group, i)
        var = np.var(np.diff(candidate))
        if var < best_var:
            best_var = var
            best = candidate
    return best


def _classify_sub_group(sub_group, expected_lines, typical_spacing, tolerance):
    """Try to turn a sub-group into a valid stave. Returns (stave, orphans)."""
    arr = np.array(sub_group)
    n = len(arr)
    if n == expected_lines:
        return arr, []
    if expected_lines - 2 <= n < expected_lines:
        repaired = _repair_stave(arr, expected_lines, typical_spacing, tolerance)
        if repaired is not None:
            return repaired, []
    return None, sub_group


def _split_oversized_group(group, expected_lines, typical_spacing, tolerance):
    """Split a group with more than ``expected_lines`` peaks into stave-sized chunks.

    Walks through peaks, accumulating into a sub-group. Flushes the sub-group
    when it reaches ``expected_lines`` or when a gap > 1.8× the local median
    indicates a stave boundary.
    """
    group_gaps = np.diff(group)
    local_median = np.median(group_gaps)

    staves = []
    orphans = []
    sub_group = [group[0]]

    for i, gap in enumerate(group_gaps):
        if len(sub_group) == expected_lines:
            # Sub-group is full — flush it
            staves.append(np.array(sub_group))
            sub_group = [group[i + 1]]
        elif gap > local_median * 1.8:
            # Unexpectedly large gap — flush whatever we have
            stave, leftover = _classify_sub_group(
                sub_group, expected_lines, typical_spacing, tolerance
            )
            if stave is not None:
                staves.append(stave)
            else:
                orphans.extend(leftover)
            sub_group = [group[i + 1]]
        else:
            sub_group.append(group[i + 1])

    # Flush the last sub-group
    stave, leftover = _classify_sub_group(
        sub_group, expected_lines, typical_spacing, tolerance
    )
    if stave is not None:
        staves.append(stave)
    else:
        orphans.extend(leftover)

    return staves, orphans


# ---------------------------------------------------------------------------
# Step 5 — "Squint" rescue pass
# ---------------------------------------------------------------------------

def _squint_rescue(projection, staves, orphans, expected_lines=5):
    """Rescue staves missed by the precise first pass using heavy blur.

    Like squinting at the page: a large moving-average kernel collapses each
    stave's 5 thin lines into one broad "hill" in the projection. We find
    hill centers with ``find_peaks``, then synthesize evenly-spaced 5-line
    staves for any hills not already covered by first-pass results.

    Filters to avoid false positives:
      - Only rescue within the vertical extent of known staves, expanding
        downward as new staves are found (so we can reach a whole system
        below the last first-pass stave).
      - Hill must be at least 60% as tall as the median known-stave hill
        (filters out footer text, page numbers, etc.).
    """
    if not orphans or not staves:
        return staves, orphans

    # --- Learn stave geometry from first-pass results ---
    stave_spans = [int(s[-1] - s[0]) for s in staves]
    typical_span = int(np.median(stave_spans))
    typical_spacing = typical_span / (expected_lines - 1)

    # --- Heavy blur: kernel ≈ stave span so 5 lines merge into one hill ---
    blur_kernel = typical_span if typical_span % 2 == 1 else typical_span + 1
    blurred = np.convolve(
        projection, np.ones(blur_kernel) / blur_kernel, mode='same'
    )

    # --- Find broad hills (one per stave) ---
    min_hill_distance = int(typical_span * 0.8)
    hill_prominence = np.max(blurred) * 0.08
    hills, _ = find_peaks(blurred, distance=min_hill_distance, prominence=hill_prominence)

    # --- Build exclusion zones around first-pass staves ---
    cover_margin = int(typical_span * 0.5)
    covered_ranges = [
        (int(s[0]) - cover_margin, int(s[-1]) + cover_margin) for s in staves
    ]

    def is_covered(y):
        return any(lo <= y <= hi for lo, hi in covered_ranges)

    # --- Compute vertical extent + margin for rescue reach ---
    first_stave_top = min(int(s[0]) for s in staves)
    last_stave_bottom = max(int(s[-1]) for s in staves)
    sorted_staves = sorted(staves, key=lambda s: s[0])
    inter_stave_gaps = [
        int(sorted_staves[i + 1][0] - sorted_staves[i][-1])
        for i in range(len(sorted_staves) - 1)
    ]
    # Margin = 2× the largest inter-stave gap, enough to reach the next system
    page_margin = max(inter_stave_gaps) * 2 if inter_stave_gaps else typical_span

    # --- Quality threshold: reject hills much shorter than known staves ---
    known_heights = [
        blurred[int(np.mean(s))] for s in staves
        if 0 <= int(np.mean(s)) < len(blurred)
    ]
    min_hill_height = np.median(known_heights) * 0.6 if known_heights else 0

    # --- Synthesize staves for uncovered hills ---
    # Process top-to-bottom; each rescued stave extends the reach downward
    # so we can chain-rescue a whole system below the last known stave.
    rescued = []
    current_bottom = last_stave_bottom
    for center in sorted(hills):
        c = int(center)
        if is_covered(c):
            continue
        if c < first_stave_top - page_margin or c > current_bottom + page_margin:
            continue
        if blurred[c] < min_hill_height:
            continue

        # Evenly space 5 lines centered on the hill
        top = int(round(center - typical_spacing * 2))
        stave = np.array([
            int(round(top + i * typical_spacing)) for i in range(expected_lines)
        ])
        rescued.append(stave)
        current_bottom = max(current_bottom, int(stave[-1]))

    # Orphans that now fall inside a rescued stave are no longer orphans
    rescued_ranges = [(int(s[0]) - 5, int(s[-1]) + 5) for s in rescued]
    remaining_orphans = [
        o for o in orphans
        if not any(lo <= o <= hi for lo, hi in rescued_ranges)
    ]
    return staves + rescued, remaining_orphans


# ---------------------------------------------------------------------------
# Step 6 — Cluster staves into systems
# ---------------------------------------------------------------------------

def _typical_stave_span(staves):
    """Median height (first to last line) across all staves."""
    spans = [int(s[-1] - s[0]) for s in staves if len(s) >= 2]
    return int(np.median(spans)) if spans else 40


def find_barline_x(binary, y_top, y_bottom, search_ratio=0.6, min_ink_ratio=0.15):
    """Rough barline x: leftmost cluster of inky columns, pick the peak.

    Identifies all columns exceeding ``min_ink_ratio`` in the Y band, finds
    the first cluster of adjacent candidates, and returns the one with the
    highest ink count. This lands on the bracket/barline complex.

    Args:
        binary: ink=255 image from binarize().
        y_top: top row of the band (inclusive).
        y_bottom: bottom row of the band (inclusive).
        search_ratio: only search the left fraction of the page width.
        min_ink_ratio: minimum ink fraction to qualify as a candidate.

    Returns:
        x coordinate (int) of the cluster peak, or None if not found.
    """
    h, w = binary.shape[:2]
    y_top = max(0, y_top)
    y_bottom = min(h - 1, y_bottom)
    band_h = y_bottom - y_top + 1
    search_w = int(w * search_ratio)
    min_ink = int(band_h * min_ink_ratio)

    band = binary[y_top:y_bottom + 1, :search_w]
    v_projection = np.sum(band > 0, axis=0)
    candidates = np.where(v_projection >= min_ink)[0]

    if len(candidates) == 0:
        return None

    # First cluster of nearby candidates (gap <= 5px)
    cluster = [candidates[0]]
    for i in range(1, len(candidates)):
        if candidates[i] - candidates[i - 1] <= 5:
            cluster.append(candidates[i])
        else:
            break

    return int(max(cluster, key=lambda x: v_projection[x]))


def _find_fine_barline_x(binary, rough_x, y_top, y_bottom, search_right=30):
    """Find the exact barline column by searching rightward from the rough x.

    The barline is always to the right of the bracket. Scans each column
    from ``rough_x`` rightward and picks the one with the longest unbroken
    vertical ink run. The barline is thin (1–2px) and continuous; brackets
    are wider but have gaps where they curve.

    Args:
        binary: ink=255 image from binarize().
        rough_x: cluster peak from find_barline_x().
        y_top: top row of the band.
        y_bottom: bottom row of the band.
        search_right: how many columns to search to the right of rough_x.

    Returns:
        (x, longest_run) for the best column, or (None, 0) if nothing found.
    """
    h, w = binary.shape[:2]
    x0 = rough_x
    x1 = min(w, rough_x + search_right + 1)
    band = binary[y_top:y_bottom + 1, x0:x1]

    best_x, best_run = None, 0
    for col_idx in range(band.shape[1]):
        col = band[:, col_idx] > 0
        run, max_run = 0, 0
        for v in col:
            if v:
                run += 1
                if run > max_run:
                    max_run = run
            else:
                run = 0
        if max_run > best_run:
            best_run = max_run
            best_x = x0 + col_idx

    return best_x, best_run


def detect_system_barlines(binary, x_center, y_top, y_bottom, jitter=3,
                           min_span_ratio=0.8):
    """Confirm a system barline span via two-phase detection.

    Phase 1 (fine x): find the exact barline column near ``x_center``.
    Phase 2 (jitter-tolerant opening): take a thin strip (±jitter px) around
    the fine x, dilate horizontally to bridge 1–2px wobble, then apply a
    vertical morphological opening with a kernel equal to the band height.

    Returns the refined (y_top, y_bottom) of the largest surviving component,
    or None if nothing survives or the span is too short.

    Args:
        binary: ink=255 image from binarize().
        x_center: rough barline column from find_barline_x().
        y_top: top row of the system band.
        y_bottom: bottom row of the system band.
        jitter: half-width of the thin strip around the fine barline x.
        min_span_ratio: minimum fraction of band height the barline must
            span to count as confirmed (default 80%).
    """
    h, w = binary.shape[:2]
    y_top = max(0, y_top)
    y_bottom = min(h - 1, y_bottom)
    band_h = y_bottom - y_top + 1

    # Phase 1: find exact barline column
    fine_x, _ = _find_fine_barline_x(binary, x_center, y_top, y_bottom)
    if fine_x is None:
        return None

    # Phase 2: thin strip with horizontal dilation to bridge jitter
    x0 = max(0, fine_x - jitter)
    x1 = min(w, fine_x + jitter + 1)
    strip = binary[y_top:y_bottom + 1, x0:x1].copy()

    # Horizontal dilation bridges 1-2px wobble in the barline
    h_kernel = cv.getStructuringElement(cv.MORPH_RECT, (jitter * 2 + 1, 1))
    strip = cv.dilate(strip, h_kernel, iterations=1)

    # Vertical opening: only strokes continuous for the full band survive
    v_kernel = cv.getStructuringElement(cv.MORPH_RECT, (1, band_h))
    opened = cv.morphologyEx(strip, cv.MORPH_OPEN, v_kernel)

    num_labels, _, stats, _ = cv.connectedComponentsWithStats(opened, connectivity=8)

    best = None
    best_h = 0
    for label in range(1, num_labels):
        lh = stats[label, cv.CC_STAT_HEIGHT]
        if lh > best_h:
            best_h = lh
            best = (
                y_top + stats[label, cv.CC_STAT_TOP],
                y_top + stats[label, cv.CC_STAT_TOP] + lh,
            )

    if best is not None and best_h < band_h * min_span_ratio:
        return None

    return best


def _cluster_by_gap(staves):
    """Split staves into systems at gaps exceeding 2× the median inter-stave gap."""
    if len(staves) <= 1:
        return [staves] if staves else []

    stave_gaps = [staves[i + 1][0] - staves[i][-1] for i in range(len(staves) - 1)]
    threshold = np.median(stave_gaps) * 2.0
    systems = []
    current_system = [staves[0]]
    for i, gap in enumerate(stave_gaps):
        if gap > threshold:
            systems.append(current_system)
            current_system = [staves[i + 1]]
        else:
            current_system.append(staves[i + 1])
    systems.append(current_system)
    return systems


def _cluster_by_barlines(staves, barline_spans):
    """Assign staves to systems by matching each stave's centre to a barline span.

    Returns None if any stave cannot be matched (caller should fall back).

    Args:
        staves: list of stave arrays, sorted top-to-bottom.
        barline_spans: list of (y_top, y_bottom) from detect_system_barlines().
    """
    tolerance = _typical_stave_span(staves) // 2
    groups = [[] for _ in barline_spans]
    for stave in staves:
        centre = int((stave[0] + stave[-1]) / 2)
        matched = False
        for bi, (y_top, y_bot) in enumerate(barline_spans):
            if y_top - tolerance <= centre <= y_bot + tolerance:
                groups[bi].append(stave)
                matched = True
                break
        if not matched:
            return None
    return [g for g in groups if g]


def find_barline_runs(binary, fine_x, jitter=3, min_run_length=50):
    """Find continuous vertical ink runs at the barline column (full page).

    Scans a thin strip (±jitter) around ``fine_x`` with horizontal dilation
    to bridge 1-2px wobble, then returns each contiguous ink run.

    Args:
        binary: ink=255 image from binarize().
        fine_x: exact barline column from _find_fine_barline_x().
        jitter: half-width of the strip.
        min_run_length: discard runs shorter than this (noise).

    Returns:
        list of (y_top, y_bottom) runs, sorted top-to-bottom.
    """
    h, w = binary.shape[:2]
    x0 = max(0, fine_x - jitter)
    x1 = min(w, fine_x + jitter + 1)
    strip = binary[:, x0:x1].copy()

    h_kernel = cv.getStructuringElement(cv.MORPH_RECT, (jitter * 2 + 1, 1))
    strip = cv.dilate(strip, h_kernel, iterations=1)

    col = np.any(strip > 0, axis=1)
    runs = []
    start = None
    for i, v in enumerate(col):
        if v and start is None:
            start = i
        elif not v and start is not None:
            if i - start >= min_run_length:
                runs.append((start, i - 1))
            start = None
    if start is not None and h - start >= min_run_length:
        runs.append((start, h - 1))

    return runs


def _split_runs_into_systems(runs, staves):
    """Group barline runs into system spans by gap size.

    Each run is a continuous ink segment of the barline. Gaps between runs
    are classified: large gaps (> 2× median) are system boundaries, small
    gaps are intra-system breaks (e.g. between instrument families). With
    only 2 runs, the single gap is always a system boundary.

    A typical stave span is used as a minimum gap threshold to avoid
    splitting on tiny noise gaps.

    Returns:
        list of (y_top, y_bottom) system spans, sorted top-to-bottom.
    """
    if len(runs) <= 1:
        return list(runs)

    gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]

    if len(gaps) == 1:
        # Two runs = two systems, always split
        return list(runs)

    # Multiple gaps: split at gaps > 2× median, but at least 1 stave span
    min_gap = _typical_stave_span(staves) if staves else 40
    threshold = max(np.median(gaps) * 2.0, min_gap)

    spans = []
    span_start = runs[0][0]
    for i, gap in enumerate(gaps):
        if gap > threshold:
            spans.append((span_start, runs[i][1]))
            span_start = runs[i + 1][0]
    spans.append((span_start, runs[-1][1]))

    return spans


def cluster_into_systems(staves, binary=None):
    """Group staves into systems.

    Primary: find the barline on the full page, find where it breaks, use
    breaks as system boundaries. Fallback: gap heuristic on stave positions.

    After grouping, each system is confirmed by checking that a continuous
    barline spans it (morphological opening).

    Args:
        staves: list of stave arrays, sorted top-to-bottom.
        binary: optional binarized image for barline detection.

    Returns:
        systems: list of lists of stave arrays.
        barline_info: list of {'x', 'span'} per system ('span' is None
            for unconfirmed systems).
    """
    if not staves:
        return [], []

    systems = None
    fine_x = None

    # Primary: barline-based grouping on full page
    if binary is not None:
        h, w = binary.shape[:2]
        rough_x = find_barline_x(binary, 0, h - 1)
        if rough_x is not None:
            fine_x, _ = _find_fine_barline_x(binary, rough_x, 0, h - 1)
        if fine_x is not None:
            runs = find_barline_runs(binary, fine_x)
            if len(runs) >= 2:
                system_spans = _split_runs_into_systems(runs, staves)
                systems = _cluster_by_barlines(staves, system_spans)

    # Fallback: gap heuristic
    if systems is None:
        systems = _cluster_by_gap(staves)

    # Confirm each system individually with per-system barline x
    barline_info = []
    if binary is not None:
        for system in systems:
            y_top = int(system[0][0])
            y_bottom = int(system[-1][-1])
            rough = find_barline_x(binary, y_top, y_bottom)
            if rough is None:
                barline_info.append({'x': None, 'span': None})
                continue
            x, _ = _find_fine_barline_x(binary, rough, y_top, y_bottom)
            if x is None:
                barline_info.append({'x': None, 'span': None})
                continue
            span = detect_system_barlines(binary, x, y_top, y_bottom)
            barline_info.append({'x': x, 'span': span})
    else:
        barline_info = [{'x': None, 'span': None}] * len(systems)

    return systems, barline_info


# ---------------------------------------------------------------------------
# Step 7 — Confidence scoring
# ---------------------------------------------------------------------------

def _score_gaps(systems):
    """Score the gap-heuristic grouping quality (0.0–1.0).

    Checks for clean separation: consistent system sizes and no singleton
    systems. A single system on a page is not penalized.
    """
    score = 1.0
    reasons = []

    if len(systems) > 1:
        system_sizes = [len(s) for s in systems]
        if len(set(system_sizes)) > 1:
            score -= 0.3
            reasons.append(f"Inconsistent system sizes: {system_sizes}")

    if any(len(s) < 2 for s in systems):
        score -= 0.4
        reasons.append("System with fewer than 2 staves")

    return max(0.0, score), reasons


def _score_barlines(barline_info):
    """Score the barline confirmation (0.0–1.0).

    Each confirmed system adds equally; no confirmed systems → 0.0.
    """
    if not barline_info:
        return 0.0, ["No barline analysis performed"]

    confirmed = sum(1 for info in barline_info if info.get('span') is not None)
    total = len(barline_info)
    score = confirmed / total

    if confirmed == total:
        reasons = [f"All {total} systems confirmed by barlines"]
    elif confirmed == 0:
        reasons = [f"No barlines found (0/{total} systems)"]
    else:
        reasons = [f"Barlines found for {confirmed}/{total} systems"]

    return score, reasons


def _score_stave_quality(staves, orphans, total_peaks):
    """Score individual stave integrity (0.0–1.0).

    Penalizes orphan peaks (lines that didn't fit into a 5-line stave).
    """
    if not staves:
        return 0.0, ["No staves detected"]

    score = 1.0
    reasons = []

    if orphans:
        orphan_ratio = len(orphans) / total_peaks if total_peaks > 0 else 0
        score -= min(0.5, orphan_ratio * 2)
        reasons.append(f"{len(orphans)} orphan lines ({orphan_ratio:.0%} of detected)")

    return max(0.0, score), reasons


def compute_confidence(systems, staves, orphans, total_peaks, barline_info):
    """Combine three independent quality signals into an overall confidence.

    Step 1 (gap grouping) and step 2 (barline confirmation) each contribute
    to system-level confidence; step 3 (stave quality) contributes to
    stave-level confidence. When steps 1 and 2 agree, confidence is high.

    Weights:
        - Gap + barline agreement: 50% (system identity)
        - Barline confirmation:    25% (structural validation)
        - Stave quality:           25% (individual stave integrity)
    """
    if not staves:
        return 0.0, {"gap": (0, []), "barlines": (0, []), "staves": (0, [])}

    gap_score, gap_reasons = _score_gaps(systems)
    bar_score, bar_reasons = _score_barlines(barline_info)
    stave_score, stave_reasons = _score_stave_quality(staves, orphans, total_peaks)

    confidence = gap_score * 0.25 + bar_score * 0.50 + stave_score * 0.25

    # Agreement bonus: if both gap and barline are strong, boost confidence
    if gap_score >= 0.7 and bar_score >= 1.0:
        confidence = min(1.0, confidence + 0.1)

    detail = {
        "gap": (gap_score, gap_reasons),
        "barlines": (bar_score, bar_reasons),
        "staves": (stave_score, stave_reasons),
    }
    return min(1.0, confidence), detail


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------

def detect_staves(source, page_num=0):
    """Run the full detection pipeline.

    Args:
        source: file path (PNG/JPG/PDF) or a numpy array (BGR image).
            If a PDF, ``page_num`` selects which page to analyze.
        page_num: 0-based page index (only used for PDFs).

    Returns a dict with all intermediate results:
        img, binary, projection, smoothed, peaks, staves, systems,
        orphans, confidence, reasons.
    """
    if isinstance(source, np.ndarray):
        img = source
    elif source.lower().endswith(".pdf"):
        img = load_pdf_page(source, page_num)
    else:
        img = cv.imread(source)
        if img is None:
            raise FileNotFoundError(f"Could not load: {source}")

    binary = binarize(img)
    projection = horizontal_projection(binary)

    # Pass 1: precise peak-based detection
    peaks, smoothed = find_staff_line_peaks(projection)
    staves, orphans = cluster_into_staves(peaks)

    # Pass 2: "squint" rescue for staves missed at low resolution
    staves, orphans = _squint_rescue(projection, staves, orphans)
    staves.sort(key=lambda s: s[0])

    systems, barline_info = cluster_into_systems(staves, binary)
    confidence, confidence_detail = compute_confidence(
        systems, staves, orphans, len(peaks), barline_info
    )

    # Flatten detail into a reasons list for API backward compat
    reasons = []
    for key in ("gap", "barlines", "staves"):
        if key in confidence_detail:
            _, detail_reasons = confidence_detail[key]
            reasons.extend(detail_reasons)

    return {
        "img": img,
        "binary": binary,
        "projection": projection,
        "smoothed": smoothed,
        "peaks": peaks,
        "staves": staves,
        "systems": systems,
        "barline_info": barline_info,
        "orphans": orphans,
        "confidence": confidence,
        "confidence_detail": confidence_detail,
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Visualization (only imported when running directly)
# ---------------------------------------------------------------------------

def plot_results(result):
    """Four-panel plot: annotated image, H-projection, V-projection, text summary."""
    import matplotlib
    matplotlib.use('TkAgg')
    import matplotlib.pyplot as plt

    img = result["img"]
    projection = result["projection"]
    smoothed = result["smoothed"]
    peaks = result["peaks"]
    staves = result["staves"]
    systems = result["systems"]
    orphans = result["orphans"]
    confidence = result["confidence"]
    confidence_detail = result.get("confidence_detail", {})
    barline_info = result.get("barline_info", [])
    binary = result["binary"]

    _, axes = plt.subplots(
        1, 4, figsize=(26, 10), gridspec_kw={'width_ratios': [3, 1, 1, 3]}
    )

    # --- Panel 1: score image with detected lines and barline spans ---
    ax_img = axes[0]
    display = img.copy()
    if len(display.shape) == 2:
        display = cv.cvtColor(display, cv.COLOR_GRAY2BGR)

    system_colors = [
        (255, 0, 0),    # red
        (0, 180, 0),    # green
        (0, 100, 255),  # orange
        (255, 0, 255),  # magenta
        (0, 200, 200),  # cyan
    ]
    h, w = display.shape[:2]

    for sys_idx, system in enumerate(systems):
        color = system_colors[sys_idx % len(system_colors)]
        for stave in system:
            for y in stave:
                cv.line(display, (0, y), (w, y), color, 2)
            cv.rectangle(display, (5, stave[0] - 5), (15, stave[-1] + 5), color, 2)

    # Orphans as gray dashed lines
    for y in orphans:
        for x in range(0, w, 20):
            cv.line(display, (x, y), (min(x + 10, w), y), (128, 128, 128), 1)

    # Per-system barline: yellow vertical tick at detected x, magenta bracket for span
    for info in barline_info:
        bx = info.get('x')
        span = info.get('span')
        if bx is not None and span is not None:
            y_top, y_bot = span
            cv.line(display, (bx, y_top), (bx, y_bot), (0, 255, 255), 2)
            rx = w - 10
            cv.line(display, (rx - 10, y_top), (rx, y_top), (255, 0, 255), 3)
            cv.line(display, (rx, y_top), (rx, y_bot), (255, 0, 255), 3)
            cv.line(display, (rx - 10, y_bot), (rx, y_bot), (255, 0, 255), 3)

    ax_img.imshow(cv.cvtColor(display, cv.COLOR_BGR2RGB))
    n_confirmed = sum(1 for info in barline_info if info.get('span'))
    ax_img.set_title(
        f"Detected: {len(staves)} staves in {len(systems)} systems "
        f"({n_confirmed}/{len(systems)} barline-confirmed)"
    )
    ax_img.axis('off')

    # --- Panel 2: horizontal projection ---
    ax_hproj = axes[1]
    y_axis = np.arange(len(projection))
    ax_hproj.plot(smoothed, y_axis, 'b-', linewidth=0.5, label='smoothed')
    ax_hproj.plot(projection, y_axis, 'b-', linewidth=0.3, alpha=0.3, label='raw')
    ax_hproj.plot(smoothed[peaks], peaks, 'rv', markersize=4, label='peaks')
    ax_hproj.set_ylim(len(projection), 0)
    ax_hproj.set_title("H-Projection")
    ax_hproj.legend(fontsize=8)

    # --- Panel 3: vertical projection with per-system barline x marked ---
    ax_vproj = axes[2]
    v_projection = np.sum(binary > 0, axis=0).astype(np.float64)
    x_axis = np.arange(len(v_projection))
    ax_vproj.plot(x_axis, v_projection, 'g-', linewidth=0.5)
    for i, info in enumerate(barline_info):
        bx = info.get('x')
        if bx is not None:
            ax_vproj.axvline(bx, color='orange', linewidth=1.5,
                             label=f'sys {i + 1} x={bx}')
    if barline_info:
        ax_vproj.legend(fontsize=8)
    ax_vproj.set_title("V-Projection")
    ax_vproj.set_xlabel("x (column)")
    ax_vproj.set_ylabel("ink rows")

    # --- Panel 4: text summary ---
    ax_text = axes[3]
    ax_text.axis('off')
    lines = [
        f"Total peaks: {len(peaks)}",
        f"Staves:      {len(staves)}",
        f"Systems:     {len(systems)}",
        f"Orphans:     {len(orphans)}",
        "",
        f"Confidence:  {confidence:.0%}",
    ]
    for key in ("gap", "barlines", "staves"):
        if key in confidence_detail:
            score, reasons = confidence_detail[key]
            lines.append(f"  {key}: {score:.0%}")
            for r in reasons:
                lines.append(f"    - {r}")
    lines.append("")
    for i, system in enumerate(systems):
        sizes = [len(s) for s in system]
        confirmed = (i < len(barline_info) and barline_info[i].get('span'))
        tag = " [barline]" if confirmed else ""
        lines.append(f"System {i + 1}: {len(system)} staves{tag}")
        if system:
            lines.append(f"  Y range: {system[0][0]} – {system[-1][-1]}")
        if confirmed:
            y_top, y_bot = barline_info[i]['span']
            lines.append(f"  Barline x={barline_info[i]['x']}  span {y_top}–{y_bot}")

    ax_text.text(
        0.05, 0.95, "\n".join(lines),
        transform=ax_text.transAxes, fontsize=11,
        verticalalignment='top', fontfamily='monospace',
    )

    plt.tight_layout()
    plt.show()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def _print_summary(result, label):
    """Print detection summary to stdout."""
    print(f"\n{label}:")
    print(f"  Peaks: {len(result['peaks'])}, Staves: {len(result['staves'])}, "
          f"Systems: {len(result['systems'])}, Orphans: {len(result['orphans'])}")
    print(f"  Confidence: {result['confidence']:.0%}")
    detail = result.get("confidence_detail", {})
    for key in ("gap", "barlines", "staves"):
        if key in detail:
            score, reasons = detail[key]
            print(f"    {key}: {score:.0%}")
            for r in reasons:
                print(f"      - {r}")


def main():
    """Usage: python projection.py [image_or_pdf] [page_num] [--no-plot]

    Examples:
        python projection.py                               # default test image
        python projection.py score.png                     # single image
        python projection.py score.pdf                     # first page of PDF
        python projection.py score.pdf 3                   # page 3 (0-based)
        python projection.py score.pdf 0 --no-plot         # summary only
    """
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    no_plot = '--no-plot' in sys.argv

    default_img = str(
        __import__("pathlib").Path(__file__).resolve().parent.parent / "img" / "music.png"
    )
    source = args[0] if args else default_img
    page_num = int(args[1]) if len(args) > 1 else 0
    result = detect_staves(source, page_num=page_num)
    _print_summary(result, source)
    if not no_plot:
        plot_results(result)


if __name__ == "__main__":
    main()
