# =============================================================================
# STATUS: v1.5 GROUNDWORK — NOT WIRED IN.
# Nothing in the live pipeline imports this yet. It is inert until a pose
# producer feeds it a per-frame lead-wrist Y signal (server MoveNet Stage 8
# or client BlazePose — decision pending). Safe to ship; zero runtime impact.
# =============================================================================
"""
swing_segmentation.py
Swing-phase segmentation from a lead-wrist vertical trajectory.
Pure numpy/scipy — no pose model, no new dependencies.

Impact is the most reliable event in the cage pipeline and already comes from
the audio stage. When an audio impact timestamp is supplied it is the
ground-truth anchor and other phases are located relative to it; pose-only
impact is the fallback. This fuses the audio and pose lanes.
"""
from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Optional
import numpy as np
from scipy.ndimage import gaussian_filter1d


@dataclass
class SwingPhases:
    address_s: Optional[float]
    takeaway_s: Optional[float]
    top_s: Optional[float]
    downswing_s: Optional[float]   # stub: equals top_s (downswing is a period, top->impact)
    impact_s: Optional[float]
    follow_through_s: Optional[float]
    impact_source: str   # "audio_anchor" | "pose_estimate" | "none"
    confidence: str      # "low" | "medium" | "high"


def segment_swing_phases(
    wrist_y: np.ndarray,
    timestamps_s: np.ndarray,
    impact_ts_s: Optional[float] = None,
    smoothing_sigma: float = 2.0,
    min_frames: int = 12,
) -> dict:
    """
    Segments ONE swing's worth of wrist_y.

    IMPORTANT: detect_strikes returns N impact timestamps per session. The
    caller MUST window wrist_y/timestamps_s around each strike and call this
    once per strike. Do NOT pass a whole multi-swing session with a single
    impact_ts (e.g. strikes[0]) — phases 2..N will be garbage.

    wrist_y      : per-frame lead-wrist vertical position, IMAGE coords
                   (y increases downward), any consistent unit.
    timestamps_s : per-frame timestamps (s), same length as wrist_y.
    impact_ts_s  : known impact time from the audio stage, if available.
    Returns asdict(SwingPhases). On bad/short input returns all-None core
    fields with confidence "low" instead of raising — caller appends a warning.
    """
    wrist_y = np.asarray(wrist_y, dtype=float)
    t = np.asarray(timestamps_s, dtype=float)

    if wrist_y.size < min_frames or wrist_y.size != t.size:
        return asdict(SwingPhases(
            None, None, None, None, impact_ts_s, None,
            "audio_anchor" if impact_ts_s is not None else "none", "low"))

    y = gaussian_filter1d(wrist_y, sigma=smoothing_sigma, mode="nearest")
    v = np.gradient(y, t)

    # TOP of backswing = hands apex = min y (search first 80% so a high
    # follow-through finish can't masquerade as the top).
    search_end = max(min_frames, int(0.8 * y.size))
    top_idx = int(np.argmin(y[:search_end]))

    # ADDRESS = motion onset: last sub-threshold-speed frame before the top.
    # (Acceptable v1 limitation: can fire mid-takeaway if no flat address visible.)
    back_peak_speed = np.max(np.abs(v[: top_idx + 1])) if top_idx > 0 else 0.0
    onset_thresh = 0.15 * back_peak_speed
    address_idx = 0
    for i in range(top_idx, 0, -1):
        if abs(v[i]) < onset_thresh:
            address_idx = i
            break
    takeaway_idx = min(address_idx + 1, top_idx)

    # IMPACT — audio anchor preferred.
    if impact_ts_s is not None:
        impact_idx = int(np.argmin(np.abs(t - impact_ts_s)))
        impact_source = "audio_anchor"
    else:
        impact_idx = (top_idx + int(np.argmax(v[top_idx:]))
                      if top_idx < y.size - 1 else y.size - 1)
        impact_source = "pose_estimate"

    # FOLLOW-THROUGH = first frame after impact where hands stop descending.
    follow_idx = y.size - 1
    for i in range(impact_idx + 1, y.size):
        if v[i] <= 0:
            follow_idx = i
            break

    ordered = address_idx <= top_idx <= impact_idx <= follow_idx
    if impact_source == "audio_anchor" and ordered:
        confidence = "high"
    elif ordered:
        confidence = "medium"
    else:
        confidence = "low"

    return asdict(SwingPhases(
        address_s=float(t[address_idx]),
        takeaway_s=float(t[takeaway_idx]),
        top_s=float(t[top_idx]),
        downswing_s=float(t[top_idx]),
        impact_s=float(t[impact_idx]),
        follow_through_s=float(t[follow_idx]),
        impact_source=impact_source,
        confidence=confidence,
    ))
