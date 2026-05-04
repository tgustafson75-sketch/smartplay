# Research — Hand tracking (MediaPipe Hands) (Phase BJ Component 5)

**Capability:** 21-landmark-per-hand tracking from camera feed (MediaPipe Hands model), repurposed for golf-specific signals: grip orientation proxy, wrist-hinge timing, club-path inference through impact.

**Verdict: QUEUE — depth feature, post-foundation**

## Technical reason

MediaPipe Hands works fine in isolation (the model is mature and shipped in Google's MediaPipe SDK). The integration cost in *this app* is the issue:

1. **The pose-detection pipeline (Phase K) is itself unverified on real device.** Per the migration gap analysis, `services/poseDetection.ts` (252 LOC) currently returns `null` and has no timeout / fallback. Adding hand-tracking on top of an unproven CV pipeline doubles the surface area before the underlying surface works.
2. **Hand landmarks alone do not give you grip pressure, wrist hinge angle, or club path** — they give you 2D coordinates of finger joints. To convert that into a meaningful golf signal, you need:
   - Wrist hinge: derive from elbow + wrist angle change over swing video frames (already what pose-detection should do).
   - Grip pressure: not measurable from camera at all. (Real grip pressure requires instrumented grip + strain gauges.)
   - Club path: requires also detecting the club, not the hands.
3. **MediaPipe Hands frame-rate cost adds to MediaPipe Pose**, which the cage flow would already be using if Phase BJ Component 1 ships pose detection. Running both at 30 FPS on a Galaxy Z Fold 5 is plausible but unverified.

## What would have to change for BUILD TODAY

1. Phase K pose-detection has to ship and verify empirically first (covered by Phase BI URGENT recommendation U1: timeout + fallback).
2. A specific signal worth extracting from hand landmarks has to be identified. Without a clear "we need X from hands and pose alone won't give it" answer, this is solution-looking-for-a-problem.

## Recommendation

**QUEUE** until after Phase K proves out empirically and a specific hand-derived signal is requested. The most likely first use isn't grip / wrist analysis — it's **club-bottom detection for Phase BL (auto club ID)**. The user shows the bottom of the club with the number visible (per [docs/legacy-club-detection-capture.md](legacy-club-detection-capture.md)) — that's vision-on-a-static-image, not real-time hand tracking. So even Phase BL doesn't need MediaPipe Hands.

If/when this becomes a real ask, the same library evaluation as MediaPipe Pose applies — see [docs/research-mediapipe.md](research-mediapipe.md).
