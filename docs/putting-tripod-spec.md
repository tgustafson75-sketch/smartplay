# Putting Tripod Analysis — Design Spec (draft)

**Status:** spec / not built. Refine with Tim before any code.
**North-star fit:** phone-only, "drop the tripod, say go," AI does the rest. No
extra hardware. This is the **putting analog of shot tracing** and overlaps the
green-heat-mapping goal.

## The vision (Tim, 2026-06-13)

Set the phone on a little tripod behind the ball, looking down the line to the
hole. The app:

1. **Reads the line/break** from that fixed vantage *before* the putt.
2. **Watches the ball roll the whole way** to the hole.
3. **Decomposes** the result: how much of what happened was **undulation/slope**
   (the green acting on the ball), how much was **green speed / grass** (stimp,
   grain), and how much was **the ball simply coming off the face in X
   direction** (the player's start line / face error).

## What exists today (honest baseline)

- `services/puttingAnalysisService.ts` — a **moment** read, not a roll read.
  Sends a few frames + spoken read to `/api/putting-analysis` (Claude Vision) →
  structured `greenSlope / setup / stroke / recommendation`. Built for **glasses
  POV**, reads a snapshot. Does NOT track the ball to the hole or attribute cause.
- `services/puttFrameExtractor.ts` — samples 5 putt-phase frames (incl. one
  `roll` frame at 0.92). Sampling, **not continuous tracking**.
- `services/swing/ballTrace.ts` — **the reusable spine.** Measures the *real
  initial departure direction* relative to the aim line (`computeTraceDirection`)
  + an honest green→red colour (`traceColor`). This is **exactly the
  "came-off-in-X-direction" component** — but it's gated `!puttMode` today. A
  tripod-behind-the-ball view **is** a down-the-line view, so that gate is wrong
  for this use case; the math is reusable as-is.
- `api/ball-departure.ts` — server CV that locates the ball a few frames after
  impact (feeds ballTrace's `departurePoint`). The roll-tracker extends this from
  one point to a path.
- `puttMode` plumbing already exists (`ballTrace.ts`, `app/swinglab/smartmotion.tsx`).

## Why the decomposition is honest (not fabricated)

The app's rule is **real signals only** (see memory `smartmotion-metrics-honesty`).
Unlike spin/launch-angle, **we measure the roll path directly** — so the
decomposition is grounded, not invented:

| Component | How it's obtained | Honesty |
|---|---|---|
| **Start direction** (face/path) | ballTrace departure angle vs aim line | **measured** |
| **Undulation / break** | curvature of the roll *after* a straight start (frame-by-frame ball centroid) | **measured** |
| **Green speed** | deceleration rate + total roll-out distance | **measured** (stimp *proxy*) |
| **Grass / grain vs pure slope** | the hard split | **inferred** — ship folded into "green effect"; grain is a later refinement, never claimed separately on day one |

Boundary line for v1: **show what the camera saw.** Attribute start-direction and
break confidently (both measured); present speed as a relative fast/slow read;
do NOT split grain out as its own number until we can ground it.

## The two real builds

### Build 1 — continuous ball-roll tracker
Extend ballTrace's single `departurePoint` into a full **centroid path** across
the whole roll (server-side, batching frames from the fixed clip). Output: an
ordered list of normalized `{x, y, t}` ball positions from impact to rest (or to
the hole). This is the spine for "watch it to the hole."

- Reuse `api/ball-departure` detection per-frame; add temporal association so a
  detection at frame N is the same ball as frame N-1.
- Rest detection: position delta < ε for K frames → ball stopped → roll-out done.
- Defensive: if tracking drops (ball occluded / leaves frame), return the partial
  path + a `tracked_fraction` confidence, never a fabricated continuation.

### Build 2 — decomposition model
Pure, deterministic, unit-testable (like ballTrace). Input: the tracked path +
the aim line + the hole location. Output:

```
PuttRollAnalysis {
  startDirection: { side, divergenceDeg }      // from ballTrace — measured
  break: { side, inches, apexFraction }        // curvature minus initial heading
  speed: { roll: 'short'|'good'|'long', decelRate, relStimp }  // from decel
  outcome: { made: bool, missSide, missDistanceFt }
  attribution: { startPct, slopePct }          // how much miss owed to face vs green
  confidence, trackedFraction
}
```

The **attribution** is the headline answer to Tim's question: *"X% of your miss
was your start line, Y% was the green."* Computed geometrically — the deviation
explained by the measured initial heading vs the deviation that developed as
curvature after a straight start.

## The hard part — perspective / plane

A single camera behind the ball sees a **2D projection of a 3D path on a sloped
plane.** Two tiers:

- **v1 (relative, ships first):** report in frame-relative terms + qualitative
  reads ("started 2° right, broke ~8 inches left, decelerating fast = quick
  green"). Tractable without metric calibration. Honest and useful.
- **v2 (metric):** homography off known references — the hole is 4.25", the ball
  is 1.68" — to convert pixel-curve → real-world inches of break and a true stimp
  estimate. This is where green-heat-mapping data could accumulate per hole.

## Capture flow (Simplified Sophistication lens)

"Dock it, say go." Setup screen: confirm ball box (reuse `EditableCageTargets`)
and tap the hole once. Say go / auto-start on stillness → it records the roll →
analysis. One screen, two taps, no menus.

## Open questions for Tim

1. **First surface** — does this live as a Smart Motion **putt mode** (env =
   green), or its own "Putt Lab" entry? (Leaning: Smart Motion putt mode, reuse
   the engine — consistent with the practice-engine pattern.)
2. **v1 read depth** — is the *relative* read (start dir + break direction + fast/
   slow) enough to ship and feel magic, or does it need metric inches on day one?
3. **Where does the hole come from** — one tap on the setup frame, or auto-detect
   the hole/flag via CV?
4. **Does this feed green-heat-mapping** — should accumulated rolls per
   green build the heat map over time (the data moat)?

## Increment plan (when we build)

1. Un-gate ballTrace for the tripod putt case + a `PuttRollAnalysis` type (pure,
   tested). No CV yet — feed it synthetic paths in sims.
2. Roll-tracker (Build 1) behind a flag, fixed-camera clip only.
3. Decomposition (Build 2) + the relative-read UI.
4. Metric homography (v2) + green-heat-map feed.
