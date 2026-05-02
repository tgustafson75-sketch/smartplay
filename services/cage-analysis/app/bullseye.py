"""
Bullseye detection — red blob localization on a single frame.

Shared between:
  - POST /api/cage/check-bullseye  (live preview validity check)
  - Pipeline Stage 4               (clean reference frame, 1s before first
                                    strike, used by disturbance localization)

Logic:
  1. BGR → HSV
  2. Two-band red mask (covers the hue wrap-around at 0° and 180°)
  3. Contours, keep area > 50 px
  4. Largest blob whose centroid sits in the upper 60% of the frame and
     between 20% and 80% horizontally — this is the validity check
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np


@dataclass
class BullseyeResult:
    detected: bool
    location: Optional[tuple[int, int]]  # (cx, cy) in pixels, top-left origin
    canvas_visible: bool


_HSV_RED_LOW_1 = np.array([0, 120, 70], dtype=np.uint8)
_HSV_RED_HIGH_1 = np.array([10, 255, 255], dtype=np.uint8)
_HSV_RED_LOW_2 = np.array([170, 120, 70], dtype=np.uint8)
_HSV_RED_HIGH_2 = np.array([180, 255, 255], dtype=np.uint8)

_MIN_BLOB_AREA_PX = 50
_VALID_TOP_FRAC = 0.60      # centroid must be in upper 60% of the frame
_VALID_LEFT_FRAC = 0.20     # centroid horizontal position lower bound
_VALID_RIGHT_FRAC = 0.80    # centroid horizontal position upper bound


def red_mask(frame_bgr: np.ndarray) -> np.ndarray:
    """Return a binary mask of red pixels (uint8, 0/255)."""
    hsv = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2HSV)
    m1 = cv2.inRange(hsv, _HSV_RED_LOW_1, _HSV_RED_HIGH_1)
    m2 = cv2.inRange(hsv, _HSV_RED_LOW_2, _HSV_RED_HIGH_2)
    return cv2.bitwise_or(m1, m2)


def detect_bullseye(frame_bgr: np.ndarray) -> BullseyeResult:
    """
    Find the bullseye (largest valid red blob) on a single BGR frame.

    Returns BullseyeResult.detected=True only when the centroid lands inside
    the spec'd valid region — this is the gate the live preview uses to
    decide READY vs NOT_READY.
    """
    if frame_bgr is None or frame_bgr.size == 0:
        return BullseyeResult(detected=False, location=None, canvas_visible=False)

    height, width = frame_bgr.shape[:2]
    mask = red_mask(frame_bgr)

    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    valid_centroids: list[tuple[int, int, float]] = []
    for c in contours:
        area = cv2.contourArea(c)
        if area <= _MIN_BLOB_AREA_PX:
            continue
        moments = cv2.moments(c)
        if moments["m00"] <= 0:
            continue
        cx = int(moments["m10"] / moments["m00"])
        cy = int(moments["m01"] / moments["m00"])

        in_top_band = cy < int(height * _VALID_TOP_FRAC)
        in_horiz_band = (
            int(width * _VALID_LEFT_FRAC) < cx < int(width * _VALID_RIGHT_FRAC)
        )
        if in_top_band and in_horiz_band:
            valid_centroids.append((cx, cy, area))

    if not valid_centroids:
        return BullseyeResult(detected=False, location=None, canvas_visible=False)

    # Largest valid blob wins
    valid_centroids.sort(key=lambda t: t[2], reverse=True)
    cx, cy, _ = valid_centroids[0]
    return BullseyeResult(detected=True, location=(cx, cy), canvas_visible=True)
