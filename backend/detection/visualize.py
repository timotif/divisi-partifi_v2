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


def label_crop_grid(stave_result: dict) -> None:
    """Plot every OCR label crop for labeled systems in a grid figure.

    One subplot per stave. Each crop is the exact grayscale image passed to
    pytesseract, scaled up 3–8× (nearest-neighbour) so fine strokes are
    legible. The subplot title shows system/stave index and the OCR output.

    Args:
        stave_result: dict returned by detect_staves() — must contain 'img',
                      'systems', and 'barline_info'.
    """
    import matplotlib
    matplotlib.use('TkAgg')
    import matplotlib.pyplot as plt
    from .annotations import detect_instrument_labels

    img          = stave_result["img"]
    systems      = stave_result["systems"]
    barline_info = stave_result.get("barline_info", [])
    img_height, img_width = img.shape[:2]

    gray = cv.cvtColor(img, cv.COLOR_BGR2GRAY) if len(img.shape) == 3 else img

    label_grid = detect_instrument_labels(
        gray, systems, img_width, img_height, barline_info
    )

    # Collect one entry per stave from labeled systems only
    entries: list[tuple[np.ndarray, int, int, str]] = []
    for si, system in enumerate(systems):
        info = barline_info[si] if si < len(barline_info) else {}
        bx   = info.get('x')
        if bx is None:
            continue   # unlabeled system — no label column
        for ti, stave in enumerate(system):
            st   = max(0,           int(stave[0])  - 8)
            sb   = min(img_height,  int(stave[-1]) + 8)
            crop = gray[st:sb, 0:bx]
            name = (label_grid[si][ti]['name']
                    if si < len(label_grid) and ti < len(label_grid[si])
                    else '')
            entries.append((crop, si, ti, name))

    if not entries:
        print("No labeled systems found — nothing to plot.")
        return

    cols = min(len(entries), 6)
    rows = (len(entries) + cols - 1) // cols
    fig, axes = plt.subplots(
        rows, cols,
        figsize=(cols * 2.4, rows * 2.8),
        squeeze=False,
    )

    for idx, (crop, si, ti, name) in enumerate(entries):
        r, c = divmod(idx, cols)
        ax   = axes[r][c]
        # Scale up so thin strokes are legible; nearest-neighbour preserves edges
        scale = max(1, 100 // max(crop.shape[0], 1))
        big   = cv.resize(crop, None, fx=scale, fy=scale,
                          interpolation=cv.INTER_NEAREST)
        ax.imshow(big, cmap='gray', vmin=0, vmax=255)
        ocr_display = f'"{name}"' if name else '(empty)'
        ax.set_title(f"sys{si} stave{ti}\n{ocr_display}", fontsize=7, pad=3)
        ax.axis('off')

    # Hide unused subplot cells
    for idx in range(len(entries), rows * cols):
        r, c = divmod(idx, cols)
        axes[r][c].axis('off')

    fig.suptitle(
        f"Label crops — exact OCR input  "
        f"(×{scale} nearest-neighbour upscale)  |  "
        f"{len(entries)} crops from {sum(1 for i in barline_info if i.get('x'))} labeled system(s)",
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
