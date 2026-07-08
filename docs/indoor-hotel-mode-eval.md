# Indoor / Hotel Mode — Evaluation (2026-07-07, NOT built)

Tim's question: how much data could be derived by HOLDING THE PHONE IN THE HAND and
simulating (a) a full swing and (b) a putting stroke — for the traveling golfer in a
hotel room many nights? (The original "indoor mode" concept.)

## What the phone-in-hand actually measures

The phone's IMU (accelerometer + gyroscope, 100-200Hz via expo-sensors) rides the
HANDS. That is genuinely the right sensor location for everything tempo- and
sequencing-related, because the hands ARE the grip:

### Full swing (phone gripped like a club, or against the lead wrist)
| Signal | Derivable? | Honesty grade |
|---|---|---|
| **Tempo ratio** (backswing:downswing) | YES — takeaway start, top (angular-velocity zero-crossing), and "impact" (peak deceleration) are crisp IMU events | HIGH — this is the marquee metric; same math our video tempo uses, at 100Hz instead of 30fps |
| **Backswing / downswing duration (ms)** | YES | HIGH |
| **Transition abruptness** ("snatch" from the top) | YES — jerk (dω/dt) at direction reversal | HIGH — maps to Tim's transition-analytics priority |
| **Swing rhythm consistency across reps** | YES — stddev of tempo over a set | HIGH |
| **Hand-path length & smoothness** | PARTIAL — integrated rotation arc is stable; linear displacement drifts | MEDIUM (report qualitative smooth/jerky, not cm) |
| **Grip-release timing proxy** (wrist rotation rate near "impact") | PARTIAL | MEDIUM — trend only |
| **Clubhead speed** | NO — no club, no clubhead; hand speed ≠ clubhead speed and swinging a 200g phone ≠ swinging a 300g driver | Do NOT show a number. At most "hand speed vs your baseline, trend only" |
| Face angle / path / attack angle / carry | NO | Never (metric-honesty rule) |

### Putting stroke (phone flat in the palm / against the putter-less grip)
| Signal | Derivable? | Honesty grade |
|---|---|---|
| **Stroke tempo** (back:through, ~2:1 benchmark) | YES | HIGH |
| **Backstroke vs through-stroke length ratio** | YES (relative, from integrated rotation) | MEDIUM-HIGH |
| **Face-rotation proxy** (yaw change through stroke) | YES — the phone's yaw IS the hands' rotation | MEDIUM — honest as "quiet vs rotating hands", not degrees-at-impact |
| **Stroke smoothness / deceleration into the ball** (the #1 amateur putting fault) | YES — deceleration profile | HIGH value |
| Start line / speed / break | NO | Never |

## Caveats (why grades are capped)
- Simulated swings without impact change the motion (no ball = people decelerate
  differently). Tempo/transition remain valid; anything "impact-quality" doesn't exist.
- Holding a phone is not holding a club: lighter, no shaft droop. Numbers must be
  framed as YOUR baseline + trend, never compared to tour data.
- Linear-position drift means no honest path TRACE from IMU alone — rhythm, not shape.

## Why it fits the product
- **North star**: phone's own sensors — this is the purest expression yet (no camera,
  no space, no setup: hands-free-adjacent, works in a hotel room in the dark).
- **CNS**: hotel tempo reps feed the SAME `recordSwingMetrics` tendencies we just
  wired, so range/course/hotel all build one tempo picture the caddie can cite.
- **Streak/retention**: a 5-minute hotel session keeps the day-streak alive and the
  points→performance rail honest ("practiced on the road 3 nights").
- **Tempo tones** (Tank's idea) composes perfectly: audio metronome + IMU verification.

## Recommended v1 scope (when green-lit — NOT now)
1. "Hotel Tempo" screen: hold phone, 10 simulated swings → per-rep tempo ratio +
   transition read + consistency score; putting mode with decel-into-ball read.
2. Feeds practicePointsStore + recordSwingMetrics (one brain).
3. expo-sensors only (already RN-compatible), OTA-able, zero native work.
4. Honest labels everywhere: "rhythm & tempo — no ball flight is claimed indoors."

**Effort estimate**: ~1-2 sessions for v1 (sensor loop + segmentation of 10 reps +
UI + CNS wiring). No server work required (pure on-device math).

**Verdict**: HIGH-value, LOW-cost, perfectly on-thesis. The derivable set (tempo,
transition, rhythm consistency, putting decel) is exactly the practice a traveling
golfer can actually do in a room — and it's the metric family Tim already ranked #1
(tempo + transition). Recommend building after the current audit chunks clear.
