"""AI-powered annotation detection for music score pages.

This module is the planned replacement / upgrade path for the Tesseract-based
pipeline in annotations.py.  It sends a page image to a vision-capable LLM
(Claude Haiku by default) and asks it to locate and classify all annotation
regions in one shot.

Why a vision model instead of Tesseract
----------------------------------------
Tesseract is a legacy OCR engine that needs per-font tuning and still fails on
italic serif score fonts (e.g. confusing 'II' with 'I', missing multi-line
labels, hallucinating bracket fragments as characters).  A modern vision model:

  - reads any font / handwriting without parameter tuning
  - understands musical score layout semantics (it has seen thousands of scores)
  - returns structured JSON with region type + bounding box + text in one call
  - handles multi-line labels, Roman numerals, abbreviations, tempo words all at
    the same confidence level

Cost model
----------
One API call per page is needed (not one call per crop).  At Claude Haiku
pricing a 300-DPI page (~300 KB JPEG) costs roughly $0.001–0.003.  A 20-page
score costs ~$0.05.  Exposing this as a paid "AI detection" option (e.g. $0.10–
0.50 per score) covers costs comfortably.

Suggested integration in app.py
---------------------------------
In detect_page_staves(), after the Tesseract-based blocks:

    # --- AI annotation detection (optional, requires ANTHROPIC_API_KEY) ---
    if os.getenv('ANTHROPIC_API_KEY') and data.get('use_ai_detection'):
        try:
            ai_result = detect_with_ai(page_img, is_first_page=(page_num == 0))
            # ai_result overrides Tesseract results when present
            ann                    = ai_result['annotations']
            detected_strip_names   = ai_result['strip_names']
            detected_strip_short_names = ai_result['strip_short_names']
        except Exception:
            logger.exception("AI detection failed — falling back to Tesseract results")

The frontend passes `use_ai_detection: true` in the POST body when the user
has opted in to the premium tier.

Public API
----------
    detect_with_ai(img, is_first_page) -> dict
        {
            "annotations": {
                "header":   (x, y, w, h) | None,
                "markings": [(x, y, w, h), ...],
            },
            "strip_names":       [str, ...],   # one per stave in first system
            "strip_short_names": [str, ...],
        }
"""

from __future__ import annotations

import base64
import json
import logging
import os
import re

import cv2 as cv
import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

# Model to use. Haiku is the cheapest Claude model that supports vision and
# is accurate enough for structured score layout understanding.
# Switch to 'claude-sonnet-4-6' for higher accuracy on ambiguous scores.
_DEFAULT_MODEL = 'claude-haiku-4-5-20251001'

# JPEG quality used when encoding the page image for the API call.
# 85 is a good balance between file size and legibility for text regions.
_JPEG_QUALITY = 85

# Maximum image dimension (width or height) sent to the API.
# 1600px is enough for Haiku to read staff labels; reduces token cost vs 300 DPI.
_MAX_SEND_DIM = 1600

# System prompt sent with every request.
_SYSTEM_PROMPT = (
    "You are a music score analyser. You receive a grayscale page image from "
    "an orchestral or ensemble score and return a JSON object describing the "
    "annotation regions. Coordinates are in image pixels (origin top-left). "
    "Return ONLY valid JSON — no prose, no markdown fences."
)

# User prompt template.  {is_first_page} is replaced with 'true'/'false'.
_USER_PROMPT = """\
Analyse this score page (is_first_page={is_first_page}) and return JSON with
the following keys:

  "instrument_labels": array of objects, one per stave that has a visible
      instrument name in the left margin.  Each object:
        {{ "stave": 0-based index, "name": "full name", "short_name": "abbrev or same",
           "box": [x, y, w, h] }}
      Only include staves where a label is clearly readable.

  "header": object or null.  If this is the first page and there is a title
      block above the first system:
        {{ "text": "title + composer block", "box": [x, y, w, h] }}
      null if no header is present or this is not the first page.

  "markings": array of objects.  Each text annotation that appears BETWEEN
      systems (tempo words, bar numbers, rehearsal letters, dynamics above a
      system):
        {{ "text": "Allegro", "type": "tempo"|"bar_number"|"rehearsal"|"other",
           "box": [x, y, w, h] }}

Boxes are [x, y, width, height] in image pixels.  Be conservative: omit any
region you are not confident about rather than guessing.
"""


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _encode_image(img: np.ndarray) -> tuple[str, int, int]:
    """Resize img to fit within _MAX_SEND_DIM and JPEG-encode as base64.

    Returns (base64_string, sent_width, sent_height).
    The caller uses (sent_width, sent_height) to scale returned coordinates
    back to the original image space.
    """
    h, w = img.shape[:2]
    scale = min(1.0, _MAX_SEND_DIM / max(h, w))
    if scale < 1.0:
        new_w = max(1, round(w * scale))
        new_h = max(1, round(h * scale))
        img = cv.resize(img, (new_w, new_h), interpolation=cv.INTER_AREA)

    sent_h, sent_w = img.shape[:2]
    success, buf = cv.imencode('.jpg', img, [cv.IMWRITE_JPEG_QUALITY, _JPEG_QUALITY])
    if not success:
        raise RuntimeError("Failed to JPEG-encode page image for AI detection")

    b64 = base64.standard_b64encode(buf.tobytes()).decode('ascii')
    return b64, sent_w, sent_h


def _scale_box(box: list[int], sent_w: int, sent_h: int,
               orig_w: int, orig_h: int) -> tuple[int, int, int, int]:
    """Scale a [x, y, w, h] box from sent-image space to original-image space."""
    sx = orig_w / sent_w
    sy = orig_h / sent_h
    x  = round(box[0] * sx)
    y  = round(box[1] * sy)
    w  = round(box[2] * sx)
    h  = round(box[3] * sy)
    # Clamp to image bounds
    x  = max(0, min(x, orig_w - 1))
    y  = max(0, min(y, orig_h - 1))
    w  = min(w, orig_w - x)
    h  = min(h, orig_h - y)
    return x, y, w, h


def _call_claude(b64_image: str, is_first_page: bool, model: str) -> dict:
    """Send image to Claude and return the parsed JSON response.

    Raises RuntimeError if the API call fails or the response is not valid JSON.
    Requires ANTHROPIC_API_KEY in the environment.
    """
    try:
        import anthropic
    except ImportError as exc:
        raise RuntimeError(
            "anthropic package not installed — run: pip install anthropic"
        ) from exc

    api_key = os.environ.get('ANTHROPIC_API_KEY')
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY environment variable not set")

    client = anthropic.Anthropic(api_key=api_key)
    prompt = _USER_PROMPT.format(is_first_page=str(is_first_page).lower())

    message = client.messages.create(
        model=model,
        max_tokens=1024,
        system=_SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/jpeg",
                            "data": b64_image,
                        },
                    },
                    {"type": "text", "text": prompt},
                ],
            }
        ],
    )

    raw = message.content[0].text.strip()
    # Strip markdown fences if the model adds them despite instructions
    raw = re.sub(r'^```(?:json)?\s*', '', raw)
    raw = re.sub(r'\s*```$', '', raw)

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"AI returned non-JSON response: {raw[:200]}") from exc


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_with_ai(
    img: np.ndarray,
    is_first_page: bool = False,
    model: str = _DEFAULT_MODEL,
) -> dict:
    """Detect score annotations using a Claude vision model.

    Sends the page image to Claude and parses the structured JSON response into
    the same format used by the Tesseract pipeline, so it can be a drop-in
    replacement in app.py's detect_page_staves().

    Args:
        img:           Grayscale page image (numpy uint8 array).
        is_first_page: Pass True for page 0 — tells the model to look for a
                       header / title block above the first system.
        model:         Anthropic model ID.  Defaults to Claude Haiku (cheapest).

    Returns:
        {
            "annotations": {
                "header":   (x, y, w, h) or None,
                "markings": [(x, y, w, h), ...],
            },
            "strip_names":       [str, ...],  # full instrument names, first system only
            "strip_short_names": [str, ...],  # abbreviated names (or same as full)
        }

    Raises:
        RuntimeError: if the API key is missing, the network call fails, or the
                      model returns unparseable output.  The caller in app.py
                      should catch this and fall back to the Tesseract result.
    """
    orig_h, orig_w = img.shape[:2]
    b64, sent_w, sent_h = _encode_image(img)
    raw = _call_claude(b64, is_first_page, model)

    # --- Parse instrument labels ---
    strip_names: list[str] = []
    strip_short_names: list[str] = []
    for entry in raw.get('instrument_labels', []):
        strip_names.append(entry.get('name', '').strip())
        strip_short_names.append(entry.get('short_name', '').strip() or strip_names[-1])

    # --- Parse header ---
    header_raw = raw.get('header')
    header: tuple[int, int, int, int] | None = None
    if is_first_page and isinstance(header_raw, dict):
        box = header_raw.get('box')
        if isinstance(box, list) and len(box) == 4:
            header = _scale_box(box, sent_w, sent_h, orig_w, orig_h)

    # --- Parse markings ---
    markings: list[tuple[int, int, int, int]] = []
    for m in raw.get('markings', []):
        box = m.get('box')
        if isinstance(box, list) and len(box) == 4:
            markings.append(_scale_box(box, sent_w, sent_h, orig_w, orig_h))

    return {
        "annotations": {
            "header":   header,
            "markings": markings,
        },
        "strip_names":       strip_names,
        "strip_short_names": strip_short_names,
    }
