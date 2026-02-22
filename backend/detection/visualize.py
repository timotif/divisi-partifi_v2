"""Combined visualizer for stave detection + annotation/label detection.

Imports from both projection and annotations modules and shows two figures:

Figure 1 — projection.plot_results(): the standard four-panel stave/barline
           detection diagnostic.

Figure 2 — label_crop_grid(): one subplot per stave in every labeled system,
           showing the exact image crop passed to OCR and the resulting text.
           This is the primary tool for diagnosing OCR quality.

Usage:
    python -m detection.visualize [image_or_pdf] [page_num] [--no-plot]

Examples:
    python -m detection.visualize tests/img/score.pdf
    python -m detection.visualize tests/img/score.pdf 2
    python -m detection.visualize tests/img/music.png
    python -m detection.visualize tests/img/score.pdf 0 --no-plot   # summary only
"""

import sys
import pathlib

import cv2 as cv
import numpy as np


def _easyocr_read(crops: list[np.ndarray]) -> list[str]:
    """Run EasyOCR on a list of grayscale crops. Returns one string per crop.

    Initialises the reader once (lazy, slow first call) and reuses it.
    Returns empty string for any crop that yields no result.
    """
    import easyocr
    reader = easyocr.Reader(['en', 'de', 'it'], gpu=False, verbose=False)
    results = []
    for crop in crops:
        big = cv.resize(crop, None, fx=2, fy=2, interpolation=cv.INTER_CUBIC)
        detections = reader.readtext(big, detail=0, paragraph=True)
        results.append(' '.join(detections).strip())
    return results


def label_crop_grid(stave_result: dict) -> None:
    """Plot every label crop with Tesseract vs EasyOCR results side by side.

    Layout: one column per stave (from labeled systems only).
      Row 0: the crop image (nearest-neighbour upscaled for legibility)
      Row 1: Tesseract result
      Row 2: EasyOCR result

    Args:
        stave_result: dict returned by detect_staves() — must contain 'img',
                      'systems', and 'barline_info'.
    """
    import matplotlib
    matplotlib.use('TkAgg')
    import matplotlib.pyplot as plt
    from .annotations import detect_instrument_labels, _ocr_text_crop

    img          = stave_result["img"]
    systems      = stave_result["systems"]
    barline_info = stave_result.get("barline_info", [])
    img_height, img_width = img.shape[:2]

    gray = cv.cvtColor(img, cv.COLOR_BGR2GRAY) if len(img.shape) == 3 else img

    # Tesseract labels via existing pipeline
    tess_grid = detect_instrument_labels(
        gray, systems, img_width, img_height, barline_info
    )

    # Collect crops from labeled systems only
    crops:   list[np.ndarray]       = []
    entries: list[tuple[int, int]]  = []   # (sys_idx, stave_idx)
    for si, system in enumerate(systems):
        info = barline_info[si] if si < len(barline_info) else {}
        if info.get('x') is None:
            continue
        scan_right = info.get('bracket_x') or info['x']
        for ti, stave in enumerate(system):
            st = max(0,          int(stave[0])  - 8)
            sb = min(img_height, int(stave[-1]) + 8)
            crops.append(gray[st:sb, 0:scan_right])
            entries.append((si, ti))

    if not entries:
        print("No labeled systems found — nothing to plot.")
        return

    print(f"Running EasyOCR on {len(crops)} crops (first run downloads model)…")
    easy_texts = _easyocr_read(crops)
    print("EasyOCR done.")

    n    = len(entries)
    cols = min(n, 6)
    rows = (n + cols - 1) // cols
    # 3 subplot rows per grid row: image + tesseract label + easyocr label
    fig, axes = plt.subplots(
        rows * 3, cols,
        figsize=(cols * 2.6, rows * 4.0),
        squeeze=False,
    )

    for idx, ((si, ti), crop, easy) in enumerate(zip(entries, crops, easy_texts)):
        gc, r = idx % cols, idx // cols
        tess  = (tess_grid[si][ti]['name']
                 if si < len(tess_grid) and ti < len(tess_grid[si]) else '')

        # Row 0: crop image
        ax_img  = axes[r * 3][gc]
        scale   = max(1, 100 // max(crop.shape[0], 1))
        big     = cv.resize(crop, None, fx=scale, fy=scale,
                            interpolation=cv.INTER_NEAREST)
        ax_img.imshow(big, cmap='gray', vmin=0, vmax=255)
        ax_img.set_title(f"sys{si} stave{ti}", fontsize=7, pad=2)
        ax_img.axis('off')

        # Row 1: Tesseract
        ax_t = axes[r * 3 + 1][gc]
        ax_t.axis('off')
        ax_t.text(0.5, 0.7, 'Tesseract:', ha='center', va='center',
                  fontsize=6, color='gray', transform=ax_t.transAxes)
        ax_t.text(0.5, 0.3, f'"{tess}"' if tess else '(empty)',
                  ha='center', va='center', fontsize=8,
                  color='steelblue', transform=ax_t.transAxes, wrap=True)

        # Row 2: EasyOCR
        ax_e = axes[r * 3 + 2][gc]
        ax_e.axis('off')
        ax_e.text(0.5, 0.7, 'EasyOCR:', ha='center', va='center',
                  fontsize=6, color='gray', transform=ax_e.transAxes)
        ax_e.text(0.5, 0.3, f'"{easy}"' if easy else '(empty)',
                  ha='center', va='center', fontsize=8,
                  color='darkorange', transform=ax_e.transAxes, wrap=True)

    # Hide unused cells
    for idx in range(n, rows * cols):
        gc, r = idx % cols, idx // cols
        for row_offset in range(3):
            axes[r * 3 + row_offset][gc].axis('off')

    fig.suptitle(
        f"Label crops — Tesseract (blue) vs EasyOCR (orange)  |  "
        f"{n} staves from {sum(1 for i in barline_info if i.get('x'))} labeled system(s)",
        fontsize=9,
    )
    fig.tight_layout()


def main():
    no_plot  = '--no-plot' in sys.argv
    args     = [a for a in sys.argv[1:] if not a.startswith('--')]
    default  = str(pathlib.Path(__file__).resolve().parent.parent
                   / "tests" / "img" / "score.pdf")
    source   = args[0] if args else default
    page_num = int(args[1]) if len(args) > 1 else 0

    print(f"Source : {source}  (page {page_num})")

    from .projection import detect_staves, plot_results, _print_summary
    result = detect_staves(source, page_num=page_num)
    _print_summary(result, source)

    if no_plot:
        return

    # Figure 1: standard stave/barline diagnostic
    plot_results(result)

    # Figure 2: OCR label crop grid
    label_crop_grid(result)

    import matplotlib.pyplot as plt
    plt.show()


if __name__ == "__main__":
    main()
