"""Horizontal projection profile for staff line detection.

Standalone prototype — not wired into the app. Run directly:
    source .venv/bin/activate && python projection.py [image_path]

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
import fitz  # PyMuPDF
import matplotlib
import matplotlib.pyplot as plt
import numpy as np
from scipy.signal import find_peaks

matplotlib.use('TkAgg')

DEFAULT_IMG = "./backend/img/music.png"
PDF_DPI = 300  # Must match analyzer.py extraction DPI


# ---------------------------------------------------------------------------
# PDF page extraction
# ---------------------------------------------------------------------------

def load_pdf_page(pdf_path, page_num=0, dpi=PDF_DPI):
    """Extract a single page from a PDF as a grayscale numpy array.

    Uses PyMuPDF at the given DPI (default 300, matching analyzer.py).

    Args:
        pdf_path: path to the PDF file.
        page_num: 0-based page index.
        dpi: rendering resolution.

    Returns:
        img: BGR numpy array (3-channel, for consistency with cv.imread).
    """
    doc = fitz.open(pdf_path)
    if page_num < 0 or page_num >= len(doc):
        raise ValueError(
            f"Page {page_num} out of range (PDF has {len(doc)} pages)"
        )
    pix = doc[page_num].get_pixmap(dpi=dpi, alpha=False)
    # PyMuPDF pixmap → numpy array (RGB), then convert to BGR for OpenCV
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 1:
        img = cv.cvtColor(img, cv.COLOR_GRAY2BGR)
    elif pix.n == 3:
        img = cv.cvtColor(img, cv.COLOR_RGB2BGR)
    doc.close()
    return img


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

def cluster_into_systems(staves):
    """Group staves into systems based on vertical gaps.

    Within a system, staves are closely spaced. Between systems there is a
    larger gap (typically 2–3× the intra-system gap). We split at gaps
    exceeding 2× the median.
    """
    if len(staves) <= 1:
        return [staves] if staves else []

    stave_gaps = [staves[i + 1][0] - staves[i][-1] for i in range(len(staves) - 1)]
    if not stave_gaps:
        return [staves]

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


# ---------------------------------------------------------------------------
# Step 7 — Confidence scoring
# ---------------------------------------------------------------------------

def compute_confidence(systems, staves, orphans, total_peaks):
    """Score detection quality from 0–1 with human-readable explanations."""
    if not staves:
        return 0.0, ["No staves detected"]

    score = 1.0
    reasons = []

    # Orphan penalty (peaks that couldn't be grouped)
    if orphans:
        orphan_ratio = len(orphans) / total_peaks
        score -= min(0.3, orphan_ratio)
        reasons.append(f"{len(orphans)} orphan lines ({orphan_ratio:.0%} of detected)")

    # Inconsistent system sizes (e.g. [5, 5, 9] on a page with mixed layouts)
    if len(systems) > 1:
        system_sizes = [len(s) for s in systems]
        if len(set(system_sizes)) > 1:
            score -= 0.15
            reasons.append(f"Inconsistent system sizes: {system_sizes}")

    # Systems with fewer than 2 staves are suspicious
    if any(len(s) < 2 for s in systems):
        score -= 0.2
        reasons.append("System with fewer than 2 staves")

    return max(0.0, score), reasons


# ---------------------------------------------------------------------------
# Full pipeline
# ---------------------------------------------------------------------------

def detect_staves(source, page_num=0):
    """Run the full detection pipeline.

    Args:
        source: file path (PNG/JPG/PDF) or a numpy array (BGR image).
            If a PDF, ``page_num`` selects which page to analyze.
        page_num: 0-based page index (only used for PDFs).

    Returns a dict with all intermediate results (for visualization/debugging).
    """
    if isinstance(source, np.ndarray):
        img = source
        label = f"array ({img.shape[1]}x{img.shape[0]})"
    elif source.lower().endswith(".pdf"):
        img = load_pdf_page(source, page_num)
        label = f"{source} (page {page_num})"
    else:
        img = cv.imread(source)
        if img is None:
            raise FileNotFoundError(f"Could not load: {source}")
        label = source

    binary = binarize(img)
    projection = horizontal_projection(binary)

    # Pass 1: precise peak-based detection
    peaks, smoothed = find_staff_line_peaks(projection)
    staves, orphans = cluster_into_staves(peaks)

    # Pass 2: "squint" rescue for staves missed at low resolution
    staves, orphans = _squint_rescue(projection, staves, orphans)
    staves.sort(key=lambda s: s[0])

    systems = cluster_into_systems(staves)
    confidence, reasons = compute_confidence(systems, staves, orphans, len(peaks))

    print(f"\n{label}:")
    print(f"  Peaks: {len(peaks)}, Staves: {len(staves)}, "
          f"Systems: {len(systems)}, Orphans: {len(orphans)}")
    print(f"  Confidence: {confidence:.0%}")
    for r in reasons:
        print(f"    - {r}")

    return {
        "img": img,
        "binary": binary,
        "projection": projection,
        "smoothed": smoothed,
        "peaks": peaks,
        "staves": staves,
        "systems": systems,
        "orphans": orphans,
        "confidence": confidence,
        "reasons": reasons,
    }


# ---------------------------------------------------------------------------
# Visualization
# ---------------------------------------------------------------------------

def plot_results(result):
    """Three-panel plot: annotated image, projection profile, text summary."""
    img = result["img"]
    projection = result["projection"]
    smoothed = result["smoothed"]
    peaks = result["peaks"]
    staves = result["staves"]
    systems = result["systems"]
    orphans = result["orphans"]
    confidence = result["confidence"]
    reasons = result["reasons"]

    _, axes = plt.subplots(
        1, 3, figsize=(20, 10), gridspec_kw={'width_ratios': [3, 1, 3]}
    )

    # --- Left panel: score image with detected lines ---
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
    _, w = display.shape[:2]

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

    ax_img.imshow(cv.cvtColor(display, cv.COLOR_BGR2RGB))
    ax_img.set_title(f"Detected: {len(staves)} staves in {len(systems)} systems")
    ax_img.axis('off')

    # --- Middle panel: horizontal projection (Y-axis matches image) ---
    ax_proj = axes[1]
    y_axis = np.arange(len(projection))
    ax_proj.plot(smoothed, y_axis, 'b-', linewidth=0.5, label='smoothed')
    ax_proj.plot(projection, y_axis, 'b-', linewidth=0.3, alpha=0.3, label='raw')
    ax_proj.plot(smoothed[peaks], peaks, 'rv', markersize=4, label='peaks')
    ax_proj.set_ylim(len(projection), 0)
    ax_proj.set_title("H-Projection")
    ax_proj.legend(fontsize=8)

    # --- Right panel: text summary ---
    ax_text = axes[2]
    ax_text.axis('off')
    lines = [
        f"Total peaks: {len(peaks)}",
        f"Staves:      {len(staves)}",
        f"Systems:     {len(systems)}",
        f"Orphans:     {len(orphans)}",
        "",
        f"Confidence:  {confidence:.0%}",
    ]
    if reasons:
        lines += ["", "Issues:"]
        lines += [f"  - {r}" for r in reasons]
    lines.append("")
    for i, system in enumerate(systems):
        sizes = [len(s) for s in system]
        lines.append(f"System {i + 1}: {len(system)} staves ({sizes} lines each)")
        if system:
            lines.append(f"  Y range: {system[0][0]} – {system[-1][-1]}")

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

def main():
    """Usage: python projection.py [image_or_pdf] [page_num]

    Examples:
        python projection.py                          # default test image
        python projection.py score.png                # single image
        python projection.py score.pdf                # first page of PDF
        python projection.py score.pdf 3              # page 3 (0-based)
    """
    source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_IMG
    page_num = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    result = detect_staves(source, page_num=page_num)
    plot_results(result)


if __name__ == "__main__":
    main()
