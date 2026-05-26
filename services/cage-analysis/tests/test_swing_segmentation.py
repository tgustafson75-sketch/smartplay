"""
Self-contained smoke test for swing_segmentation.

Runs with plain Python — pytest is NOT in services/cage-analysis/requirements.txt
(this is a deliberately dep-free verification of the standalone module).
Invoke with:

    cd services/cage-analysis
    python -m tests.test_swing_segmentation
    # OR equivalent:
    python tests/test_swing_segmentation.py

Exits 0 on success, non-zero on first failed assertion.
"""
from __future__ import annotations

import sys
import os

# Allow `from app.swing_segmentation import ...` when invoked from the
# services/cage-analysis directory.
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import numpy as np

from app.swing_segmentation import segment_swing_phases


def synthesize_swing(fps: int = 60, duration_s: float = 1.5) -> tuple[np.ndarray, np.ndarray, float]:
    """
    Build a realistic wrist-Y trajectory in IMAGE coords (y increases downward):
      - Address: flat baseline (y0) for ~0.25s
      - Takeaway → Top: smooth rise (y decreases) to an apex at ~0.83s
      - Downswing → Impact: rapid descent back through baseline near ~1.13s
      - Follow-through: hands rise (y decreases) again into a finish

    Returns (wrist_y, timestamps_s, impact_ts_s).
    """
    n = int(fps * duration_s)
    t = np.linspace(0.0, duration_s, n, endpoint=False)

    y0 = 500.0           # baseline pixel row for the wrist at address
    top_amp = 220.0      # how high (in px) the hands rise above address at the top
    finish_amp = 160.0   # how high the hands rise above address at finish

    top_t = 0.83         # apex time (s)
    impact_t = 1.13      # impact time (s)

    y = np.full(n, y0, dtype=float)

    for i, ti in enumerate(t):
        if ti < 0.20:
            # Address — flat (tiny ±0.5px jitter only, no drift)
            y[i] = y0
        elif ti < top_t:
            # Takeaway → Top: smooth (half-cosine) rise to apex
            phase = (ti - 0.20) / (top_t - 0.20)
            y[i] = y0 - top_amp * np.sin(0.5 * np.pi * phase)
        elif ti < impact_t:
            # Downswing: rapid (half-cosine) descent through baseline
            phase = (ti - top_t) / (impact_t - top_t)
            y[i] = (y0 - top_amp) + (top_amp + 10) * np.sin(0.5 * np.pi * phase)
        else:
            # Follow-through: hands rise into finish (half-cosine)
            phase = (ti - impact_t) / (duration_s - impact_t)
            y[i] = (y0 + 10) - finish_amp * np.sin(0.5 * np.pi * phase)

    # Sprinkle ±0.5px jitter so the smoothing path is exercised.
    rng = np.random.default_rng(seed=42)
    y = y + rng.normal(0.0, 0.5, size=n)

    return y, t, impact_t


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    sys.exit(1)


def assert_true(cond: bool, msg: str) -> None:
    if not cond:
        fail(msg)


def assert_eq(actual, expected, msg: str) -> None:
    if actual != expected:
        fail(f"{msg} — expected {expected!r}, got {actual!r}")


def test_with_audio_anchor() -> None:
    wrist_y, t, impact = synthesize_swing()
    phases = segment_swing_phases(wrist_y, t, impact_ts_s=impact)

    # All phases populated
    for k in ("address_s", "takeaway_s", "top_s", "downswing_s", "impact_s", "follow_through_s"):
        assert_true(phases[k] is not None, f"phase {k} is None")

    # Time order
    assert_true(
        phases["address_s"] <= phases["takeaway_s"]
        <= phases["top_s"] <= phases["impact_s"]
        <= phases["follow_through_s"],
        f"phases out of order: {phases}",
    )

    # Audio anchor honored
    assert_eq(phases["impact_source"], "audio_anchor", "impact_source mismatch")
    assert_eq(phases["confidence"], "high", "confidence with audio anchor")

    # Impact timestamp lands within one frame of the supplied anchor
    assert_true(abs(phases["impact_s"] - impact) < 1.0 / 60.0,
                f"impact_s={phases['impact_s']} far from anchor {impact}")

    print("[OK] test_with_audio_anchor")


def test_without_audio_anchor() -> None:
    wrist_y, t, _impact = synthesize_swing()
    phases = segment_swing_phases(wrist_y, t, impact_ts_s=None)

    for k in ("address_s", "takeaway_s", "top_s", "downswing_s", "impact_s", "follow_through_s"):
        assert_true(phases[k] is not None, f"phase {k} is None (pose-only)")

    assert_true(
        phases["address_s"] <= phases["takeaway_s"]
        <= phases["top_s"] <= phases["impact_s"]
        <= phases["follow_through_s"],
        f"pose-only phases out of order: {phases}",
    )
    assert_eq(phases["impact_source"], "pose_estimate", "impact_source w/o anchor")
    print("[OK] test_without_audio_anchor")


def test_short_input_does_not_raise() -> None:
    short_y = np.array([500.0, 501.0, 499.0, 502.0, 500.0])
    short_t = np.linspace(0.0, 0.1, 5)
    phases = segment_swing_phases(short_y, short_t, impact_ts_s=None)

    for k in ("address_s", "takeaway_s", "top_s", "downswing_s", "follow_through_s"):
        assert_eq(phases[k], None, f"short input should null {k}")
    assert_eq(phases["confidence"], "low", "short input confidence")
    assert_eq(phases["impact_source"], "none", "short input impact_source w/o anchor")
    print("[OK] test_short_input_does_not_raise")


def test_short_input_with_anchor_preserves_impact() -> None:
    short_y = np.array([500.0, 501.0, 499.0, 502.0, 500.0])
    short_t = np.linspace(0.0, 0.1, 5)
    phases = segment_swing_phases(short_y, short_t, impact_ts_s=0.05)
    assert_eq(phases["impact_s"], 0.05, "short-input impact_s w/ anchor")
    assert_eq(phases["impact_source"], "audio_anchor", "short-input source w/ anchor")
    assert_eq(phases["confidence"], "low", "short-input confidence w/ anchor")
    print("[OK] test_short_input_with_anchor_preserves_impact")


if __name__ == "__main__":
    test_with_audio_anchor()
    test_without_audio_anchor()
    test_short_input_does_not_raise()
    test_short_input_with_anchor_preserves_impact()
    print("\nAll swing_segmentation tests passed.")
    sys.exit(0)
