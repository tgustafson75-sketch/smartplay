"""
Stage 6 — Per-strike disturbance localization.

For each strike timestamp:
    Reference frame  at t - 0.3 s
    Candidate posts  at t + 33 ms, +66 ms, +100 ms, +150 ms
    For each post:
        cv2.absdiff vs reference, gray-scale
        Mask to canvas-only
        Mean canvas-internal diff
    Pick the post with the highest mean diff
    argmax of diff inside canvas mask = impact pixel
    (dx, dy) inches from bullseye
    If max diff < threshold → detection_confidence: low
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger(__name__)

POST_OFFSETS_MS = (33, 66, 100, 150)
PRE_REF_OFFSET_S = 0.3
LOW_CONFIDENCE_DIFF_THRESHOLD = 8.0     # mean canvas-internal diff
HIGH_CONFIDENCE_DIFF_THRESHOLD = 18.0   # comfortable detection above this


@dataclass
class StrikeImpact:
    horizontal_inches: float
    vertical_inches: float
    radius_inches: float
    confidence: str  # "high" | "medium" | "low"


def _read_frame_at_ms(cap: cv2.VideoCapture, ts_ms: float) -> Optional[np.ndarray]:
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, ts_ms))
    ok, frame = cap.read()
    if not ok or frame is None:
        return None
    return frame


def localize_strike(
    cap: cv2.VideoCapture,
    strike_time_s: float,
    canvas_mask: np.ndarray,
    bullseye_px: tuple[int, int],
    inches_per_px: float,
) -> Optional[StrikeImpact]:
    """
    Returns the impact offset for a single strike, or None when neither
    a usable reference nor any post-frame can be read.
    """
    ref_ts_ms = max(0.0, (strike_time_s - PRE_REF_OFFSET_S) * 1000.0)
    ref_frame = _read_frame_at_ms(cap, ref_ts_ms)
    if ref_frame is None:
        log.warning("[disturb] no reference frame at t=%.3fs", ref_ts_ms / 1000.0)
        return None

    ref_gray = cv2.cvtColor(ref_frame, cv2.COLOR_BGR2GRAY)

    best_mean_diff = -1.0
    best_diff: Optional[np.ndarray] = None

    for offset_ms in POST_OFFSETS_MS:
        ts_ms = strike_time_s * 1000.0 + offset_ms
        post_frame = _read_frame_at_ms(cap, ts_ms)
        if post_frame is None:
            continue
        post_gray = cv2.cvtColor(post_frame, cv2.COLOR_BGR2GRAY)
        diff = cv2.absdiff(post_gray, ref_gray)
        masked = cv2.bitwise_and(diff, diff, mask=canvas_mask)
        # Mean over canvas-mask pixels only
        mask_count = int(np.count_nonzero(canvas_mask))
        if mask_count == 0:
            continue
        mean_diff = float(np.sum(masked, dtype=np.float64)) / float(mask_count)
        if mean_diff > best_mean_diff:
            best_mean_diff = mean_diff
            best_diff = masked

    if best_diff is None:
        log.warning("[disturb] no post-frames available for strike at %.3fs", strike_time_s)
        return None

    # argmax of diff inside the canvas mask
    flat_idx = int(np.argmax(best_diff))
    impact_y, impact_x = np.unravel_index(flat_idx, best_diff.shape)

    dx_px = float(impact_x) - float(bullseye_px[0])
    dy_px = float(impact_y) - float(bullseye_px[1])
    horizontal_in = round(dx_px * inches_per_px, 2)
    vertical_in = round(dy_px * inches_per_px, 2)
    radius_in = round(float(np.hypot(horizontal_in, vertical_in)), 2)

    if best_mean_diff >= HIGH_CONFIDENCE_DIFF_THRESHOLD:
        confidence = "high"
    elif best_mean_diff >= LOW_CONFIDENCE_DIFF_THRESHOLD:
        confidence = "medium"
    else:
        confidence = "low"

    return StrikeImpact(
        horizontal_inches=horizontal_in,
        vertical_inches=vertical_in,
        radius_inches=radius_in,
        confidence=confidence,
    )
