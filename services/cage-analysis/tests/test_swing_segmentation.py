# Plain smoke test — no pytest.
# Run: cd services/cage-analysis && python tests/test_swing_segmentation.py
import sys, os
import numpy as np
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app.swing_segmentation import segment_swing_phases

def build_synthetic_swing(fps=60, dur=1.6, impact_t=1.15):
    n = int(fps * dur)
    t = np.linspace(0, dur, n)
    y = np.empty(n)
    for i, ti in enumerate(t):
        if ti < 0.30:                          # address: flat, hands low (high y)
            y[i] = 0.82
        elif ti < 0.90:                        # backswing: rise to apex (y -> min)
            y[i] = 0.82 - 0.72 * ((ti - 0.30) / 0.60)
        elif ti < impact_t:                    # downswing: back down toward address
            y[i] = 0.10 + 0.65 * ((ti - 0.90) / (impact_t - 0.90))
        else:                                  # follow-through: hands rise again
            y[i] = 0.75 - 0.55 * ((ti - impact_t) / (dur - impact_t))
    y += np.random.default_rng(0).normal(0, 0.01, n)
    return y, t, impact_t

fails = []
def check(cond, msg):
    if not cond: fails.append(msg)

y, t, imp = build_synthetic_swing()

# 1) audio-anchored
r = segment_swing_phases(y, t, impact_ts_s=imp)
ordered = (r["address_s"] <= r["takeaway_s"] <= r["top_s"]
           <= r["impact_s"] <= r["follow_through_s"])
check(ordered, f"phases not ordered: {r}")
check(r["impact_source"] == "audio_anchor", f"impact_source={r['impact_source']}")
check(r["confidence"] == "high", f"confidence={r['confidence']}")
check(abs(r["top_s"] - 0.90) < 0.10, f"top off: {r['top_s']}")

# 2) pose-only (no anchor) still returns ordered phases
r2 = segment_swing_phases(y, t, impact_ts_s=None)
ordered2 = (r2["address_s"] <= r2["top_s"] <= r2["impact_s"] <= r2["follow_through_s"])
check(ordered2, f"pose-only not ordered: {r2}")
check(r2["impact_source"] == "pose_estimate", f"src={r2['impact_source']}")

# 3) too-short input degrades gracefully, no raise
r3 = segment_swing_phases(np.zeros(5), np.linspace(0, 0.1, 5), impact_ts_s=None)
check(r3["address_s"] is None, "short input should null address_s")
check(r3["confidence"] == "low", f"short conf={r3['confidence']}")

if fails:
    print("FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print("PASS — swing_segmentation smoke test")
