# DTL Analysis Partition — Design Spec (draft)

**Status:** spec / not built. Needs device footage + on-device verification before
wiring (touches the pose pipeline). Refine with Tim first.
**Origin:** Tim, 2026-06-13 — "the 2/3 / 1/3 framing makes analyzing ball vs golfer
characteristics partitionable, right?" Yes. This spec turns that into a build.

## The idea

The DTL cage setup now enforces a known layout (shipped): the **player fills ~2/3**
of the frame and the **ball + target line sit in the outer 1/3** (handedness-mirrored
— see `services/cage/targetRig.ts`, memory `cage-dtl-framing-partition`). Because the
frame is spatially partitioned, the analysis can be **spatially scoped**:

- **Player region (≈2/3) → golfer characteristics**: pose, tempo, biomech, swing
  path / faults.
- **Ball region (≈1/3, the placed ball box) → ball characteristics**: ball
  detection, strike / departure, trace, start direction.

## Why it's worth building

1. **Clean separation** — "what the ball did" vs "what the golfer did" stop
   contaminating each other.
2. **Speed + reliability** ([[speed-is-the-wow]]) — each CV pipeline searches a
   smaller, known region instead of the full frame. Pose on the player box, ball CV
   on the ball box → fewer false detections, faster.
3. **Honest** — the regions come from the rig the user already placed; nothing is
   guessed.

## Current state (what exists)

- The rig (ball box `{x,y,r}` + target `{x,y}`) is placed/dragged and persisted on
  the cage session (`cageStore` ball_area_norm / target_norm). `services/cage/targetRig.ts`
  gives the handedness default + rigid move.
- **Ball CV is already partly scoped**: `detectBallDeparture({ videoUri, impactMs, ballArea })`
  already takes the ball area — it searches around the placed ball.
- **Pose is NOT scoped**: `services/poseAnalysisApi.ts` `analyzeSwingFromVideo(clipUri, durationMs, angle, …)`
  takes no region/crop — it runs pose on the whole frame.

## The build

### 1. Pure region helper — `services/cage/analysisRegions.ts`
`deriveAnalysisRegions(ball, target, handedness, frameAspect)` → `{ playerBox, ballBox }`
as normalized rects (`{x, y, w, h}`).
- **ballBox**: a padded rect around the placed ball area (reuse `ball.r`).
- **playerBox**: the complementary ~2/3 on the player's side (opposite the ball's
  outer third) — RH ball-right → player occupies the left ~0..0.66; LH mirrors. Tall
  (head→feet), clamped to frame. Pure + unit-tested with synthetic rigs.

### 2. Scope ball CV (low risk — param already exists)
Pass the derived `ballBox` (or keep `ballArea`) through the ball-departure / trace
calls. Mostly already there; formalize the region.

### 3. Scope pose (the real work — needs care + device verify)
Two options, pick after a footage test:
- **(a) Crop-then-pose**: crop each extracted frame to `playerBox` before running
  MediaPipe, then map keypoints back to full-frame coords. Biggest speed win; risk =
  a player who steps outside the box (tall backswing, follow-through) gets clipped →
  need a generous box + a "person left the box" fallback to full-frame.
- **(b) Full-frame pose + region filter**: run pose as today but discard detections
  outside `playerBox` (rejects a bystander / the ball-region noise). Lower speed win,
  much lower risk. **Ship (b) first**, graduate to (a) once the box sizing is proven
  on real clips.

### 4. Honest fallbacks
If the rig isn't placed (no ball box) or the person is detected outside the box,
fall back to full-frame analysis — never drop the read. Flag low-confidence rather
than going dark ([[overstrict-gate-lens]], [[caddie-failsafe-no-walls]]).

## Verification (PATH 3 CAGE — Tim, on device)
- A normal DTL swing: pose still tracks head→feet (not clipped), tempo/biomech
  unchanged vs full-frame; ball departure still fires.
- A tall/long swing: player not clipped (box generous enough) or clean fallback.
- LH swinger: regions mirror correctly.
- Measure: is analysis faster (smaller search) with no accuracy loss?

## Increments
1. `analysisRegions.ts` pure helper + sims (no wiring yet — gate behind step 2 so
   it's not dead code: land it together with the consumer).
2. Pose region-filter (option b) wired into `analyzeSwingFromVideo`, behind a flag,
   verified on device.
3. Crop-then-pose (option a) if (b) proves the box sizing.
4. Formalize ball-region scoping + (future) feed the partition to the SmartMotion
   shot map.

See memory: `cage-dtl-framing-partition`, `analysis-reliability-architecture`,
`speed-is-the-wow`, `framing-coach`.
