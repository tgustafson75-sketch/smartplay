"""
Stage 5 — Canvas region + calibration.

On a clean reference frame:
    HSV white mask  (0,0,180) - (180,60,255)
    Restricted to upper 65% of the frame
    Largest connected component = canvas
    Erode 9x9 to stay safely inside the canvas edge
    canvas_width_px  = bounding-box width
    inches_per_px    = 30.0 / canvas_width_px   (canvas is ~30 inches wide)
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger(__name__)

CANVAS_WIDTH_INCHES = 30.0

_HSV_WHITE_LOW = np.array([0, 0, 180], dtype=np.uint8)
_HSV_WHITE_HIGH = np.array([180, 60, 255], dtype=np.uint8)
_UPPER_FRAC = 0.65
_ERODE_KERNEL = np.ones((9, 9), dtype=np.uint8)


@dataclass
class CanvasCalibration:
    mask: np.ndarray                # uint8 0/255, full-frame size
    bbox: tuple[int, int, int, int] # x, y, w, h
    inches_per_px: float


def calibrate_canvas(reference_bgr: np.ndarray) -> Optional[CanvasCalibration]:
    """Locate the canvas, return calibration. None when no canvas component found."""
    if reference_bgr is None or reference_bgr.size == 0:
        return None

    h, w = reference_bgr.shape[:2]
    hsv = cv2.cvtColor(reference_bgr, cv2.COLOR_BGR2HSV)
    white = cv2.inRange(hsv, _HSV_WHITE_LOW, _HSV_WHITE_HIGH)

    # Restrict to upper 65% — zero out the lower band
    cutoff = int(round(h * _UPPER_FRAC))
    if cutoff < h:
        white[cutoff:, :] = 0

    # Largest connected component (skip background label 0)
    n_labels, labels, stats, _ = cv2.connectedComponentsWithStats(white, connectivity=8)
    if n_labels <= 1:
        log.warning("[canvas] no white components found")
        return None

    areas = stats[1:, cv2.CC_STAT_AREA]
    largest_idx = int(np.argmax(areas)) + 1  # +1 to skip background
    x = int(stats[largest_idx, cv2.CC_STAT_LEFT])
    y = int(stats[largest_idx, cv2.CC_STAT_TOP])
    cw = int(stats[largest_idx, cv2.CC_STAT_WIDTH])
    ch = int(stats[largest_idx, cv2.CC_STAT_HEIGHT])

    raw_mask = np.where(labels == largest_idx, 255, 0).astype(np.uint8)
    eroded = cv2.erode(raw_mask, _ERODE_KERNEL)

    if cw <= 0:
        log.warning("[canvas] zero-width bbox")
        return None

    inches_per_px = CANVAS_WIDTH_INCHES / float(cw)
    log.info(
        "[canvas] bbox=(x=%d y=%d w=%d h=%d) inches_per_px=%.4f",
        x, y, cw, ch, inches_per_px,
    )
    return CanvasCalibration(mask=eroded, bbox=(x, y, cw, ch), inches_per_px=inches_per_px)
