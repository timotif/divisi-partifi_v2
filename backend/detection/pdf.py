"""Shared PDF page extraction for detection modules."""

import cv2 as cv
import fitz  # PyMuPDF
import numpy as np

DEFAULT_DPI = 300


def load_pdf_page(pdf_path, page_num=0, dpi=DEFAULT_DPI):
    """Extract a single page from a PDF as a BGR numpy array.

    Args:
        pdf_path: path to the PDF file.
        page_num: 0-based page index.
        dpi: rendering resolution (default 300).

    Returns:
        BGR numpy array (3-channel, for consistency with cv.imread).
    """
    doc = fitz.open(pdf_path)
    if page_num < 0 or page_num >= len(doc):
        raise ValueError(
            f"Page {page_num} out of range (PDF has {len(doc)} pages)"
        )
    pix = doc[page_num].get_pixmap(dpi=dpi, alpha=False)
    img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.h, pix.w, pix.n)
    if pix.n == 1:
        img = cv.cvtColor(img, cv.COLOR_GRAY2BGR)
    elif pix.n == 3:
        img = cv.cvtColor(img, cv.COLOR_RGB2BGR)
    doc.close()
    return img
