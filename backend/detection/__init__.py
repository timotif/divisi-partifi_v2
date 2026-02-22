"""Staff and line detection for music score images."""

from .projection import detect_staves
from .hough import detect_lines
from .annotations import detect_annotations, detect_instrument_labels
