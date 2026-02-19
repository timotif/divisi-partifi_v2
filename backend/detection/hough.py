"""Hough transform line detection for music scores.

Experimental / less mature than projection.py. Can be used as a library
or run directly for visual debugging:
    python hough.py [image_path]

Pipeline:
    1. Grayscale conversion
    2. Canny edge detection (adaptive thresholds)
    3. Horizontal dilation to bridge broken staff lines
    4. HoughLines transform
    5. Filter by angle + deduplicate
"""

import sys

import cv2 as cv
import numpy as np

from .pdf import load_pdf_page

ANGLE_THRESHOLD = np.pi / 180 * 2  # 2 degrees tolerance

# Reference image: music.png (732x980) — tuned parameters for this resolution
REF_WIDTH = 732
REF_HEIGHT = 980
REF_CANNY_LOW = 20
REF_CANNY_HIGH = 80
REF_HOUGH_THRESHOLD = 450
DILATE_KERNEL_W = 5  # Fixed — gap bridging doesn't depend on resolution
REF_DEDUP_RHO = 20


def estimate_params(img):
    """Estimate Canny/Hough/dilation parameters based on image size relative to reference.

    The reference image (music.png, 732x980) has known-good parameters.
    We scale linearly with the geometric mean of width/height ratios,
    since a 2x larger image has ~2x longer staff lines and ~2x more edge pixels.
    """
    h, w = img.shape[:2]
    scale = np.sqrt((w / REF_WIDTH) * (h / REF_HEIGHT))

    return {
        "canny_low": int(round(REF_CANNY_LOW * scale)),
        "canny_high": int(round(REF_CANNY_HIGH * scale)),
        # Sub-linear: longer lines get more votes but not proportionally.
        # Calibrated: 450 @ 1.0x, ~900 @ 2.67x (exponent 0.7).
        "hough_threshold": int(round(REF_HOUGH_THRESHOLD * (scale ** 0.7))),
        "dilate_kernel_w": DILATE_KERNEL_W,
        "dedup_rho": max(5, int(round(REF_DEDUP_RHO * scale))),
        "scale": scale,
    }


def _to_grayscale(img):
    """Convert BGR image to grayscale."""
    if len(img.shape) == 2:
        return img.copy()
    return cv.cvtColor(img, cv.COLOR_BGR2GRAY)


def filter_by_angle(lines, target_angle, threshold=ANGLE_THRESHOLD, dedup_rho=20):
    """Filter Hough lines by angle and deduplicate by rho coordinate."""
    if lines is None:
        return []
    filtered = [line for line in lines if abs(line[0][1] - target_angle) % np.pi < threshold]
    unique = []
    for line in filtered:
        rho, theta = line[0]
        if not any(abs(rho - l[0][0]) < dedup_rho and abs(theta - l[0][1]) < threshold for l in unique):
            unique.append(line)
    return unique


def detect_lines(source, page_num=0):
    """Run the Hough line detection pipeline.

    Args:
        source: file path (PNG/JPG/PDF) or a numpy array (BGR image).
            If a PDF, ``page_num`` selects which page to analyze.
        page_num: 0-based page index (only used for PDFs).

    Returns a dict with:
        img, edges, lines (raw), horizontal_lines, vertical_lines, params.
    """
    if isinstance(source, np.ndarray):
        img = source
    elif source.lower().endswith(".pdf"):
        img = load_pdf_page(source, page_num)
    else:
        img = cv.imread(source)
        if img is None:
            raise FileNotFoundError(f"Could not load: {source}")

    params = estimate_params(img)
    gray = _to_grayscale(img)

    edges = cv.Canny(gray, params["canny_low"], params["canny_high"], apertureSize=3)

    # Dilate to connect broken/faint horizontal lines
    kernel = cv.getStructuringElement(cv.MORPH_RECT, (params["dilate_kernel_w"], 1))
    edges = cv.dilate(edges, kernel, iterations=1)

    lines = cv.HoughLines(edges, 1, np.pi / 180, params["hough_threshold"])

    dedup_rho = params["dedup_rho"]
    horizontal_lines = filter_by_angle(lines, np.pi / 2, ANGLE_THRESHOLD, dedup_rho)
    vertical_lines = filter_by_angle(lines, 0, ANGLE_THRESHOLD, dedup_rho)

    return {
        "img": img,
        "edges": edges,
        "lines": lines,
        "horizontal_lines": horizontal_lines,
        "vertical_lines": vertical_lines,
        "params": params,
    }


# ---------------------------------------------------------------------------
# Visualization (only imported when running directly)
# ---------------------------------------------------------------------------

def _draw_lines(img, lines, color):
    """Draw Hough lines on an image copy."""
    display = img.copy()
    if lines is not None:
        for line in lines:
            rho, theta = line[0]
            a = np.cos(theta)
            b = np.sin(theta)
            x0 = a * rho
            y0 = b * rho
            x1 = int(x0 + 3000 * (-b))
            y1 = int(y0 + 3000 * (a))
            x2 = int(x0 - 3000 * (-b))
            y2 = int(y0 - 3000 * (a))
            cv.line(display, (x1, y1), (x2, y2), color, 2)
    return display


def plot_results(result):
    """Four-panel plot: grayscale, edges, vertical lines, horizontal lines."""
    import matplotlib
    matplotlib.use('TkAgg')
    import matplotlib.pyplot as plt

    img = result["img"]
    edges = result["edges"]
    params = result["params"]

    gray = _to_grayscale(img)
    vert_img = _draw_lines(img.copy(), result["vertical_lines"], (0, 255, 0))
    horiz_img = _draw_lines(img.copy(), result["horizontal_lines"], (255, 0, 0))

    plt.figure(figsize=(30, 30))
    plt.subplot(141)
    plt.imshow(gray, cmap='gray')
    plt.title("Grayscale")
    plt.subplot(142)
    plt.imshow(edges, cmap='gray')
    plt.title("Edges")
    plt.subplot(143)
    plt.imshow(cv.cvtColor(vert_img, cv.COLOR_BGR2RGB))
    plt.title(f"Vertical ({len(result['vertical_lines'])})")
    plt.subplot(144)
    plt.imshow(cv.cvtColor(horiz_img, cv.COLOR_BGR2RGB))
    plt.title(f"Horizontal ({len(result['horizontal_lines'])})")

    plt.suptitle(
        f"Scale: {params['scale']:.2f}, "
        f"Canny: ({params['canny_low']}, {params['canny_high']}), "
        f"Hough: {params['hough_threshold']}",
        fontsize=14
    )
    plt.tight_layout()
    plt.show()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main():
    """Usage: python hough.py [image_path]"""
    default_img = str(
        __import__("pathlib").Path(__file__).resolve().parent.parent / "img" / "page_0.png"
    )
    source = sys.argv[1] if len(sys.argv) > 1 else default_img
    page_num = int(sys.argv[2]) if len(sys.argv) > 2 else 0

    result = detect_lines(source, page_num=page_num)
    params = result["params"]
    total = len(result["lines"]) if result["lines"] is not None else 0
    print(f"\nImage: {result['img'].shape[1]}x{result['img'].shape[0]}, scale: {params['scale']:.2f}")
    print(f"Total lines: {total}, Horizontal: {len(result['horizontal_lines'])}, "
          f"Vertical: {len(result['vertical_lines'])}")
    plot_results(result)


if __name__ == "__main__":
    main()
