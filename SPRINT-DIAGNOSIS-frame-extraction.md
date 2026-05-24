# BUG #1 — Frame Extraction Regression Diagnosis

**Date:** 2026-05-23
**Status:** Read-only diagnosis. No source files modified.
**Reported symptom:** Swing analysis describes only the START of the swing (setup frame), not the full motion through takeaway / transition / impact / follow-through.

---

## Hypothesis verdict: **DENIED**

The pipeline still extracts 5 frames and transmits all 5 to the vision model. The setup-only output is not caused by frame-count collapse. The cause lives downstream in the Sonnet prompt / interpretation, not in extraction or transport.

---

## Current frame count along the pipeline

| Stage | Count | Evidence |
|---|---|---|
| Extraction (client) | **5 frames** at fractions `[0.08, 0.40, 0.60, 0.75, 0.88]` | [services/poseDetection.ts:108](services/poseDetection.ts#L108) — `FRAME_TIME_FRACTIONS` literal unchanged from Fix J/K |
| Extraction loop | Up to 5 (one per fraction; filters to valid frames only) | [services/poseDetection.ts:185-215](services/poseDetection.ts#L185-L215) — `Promise.all` over the fractions array |
| Fetch body to `/api/swing-analysis` | All valid extracted frames passed through as `frames: wireFrames` | [services/poseDetection.ts:296,309](services/poseDetection.ts#L296) |
| API reception (server validation) | Accepts `frames.length > 0` and `<= 5` | [api/swing-analysis.ts:200-201](api/swing-analysis.ts#L200-L201) |
| Sonnet content[] build | All frames mapped to distinct image blocks via `...frames.map(f => ({ type: 'image', ... }))` | [api/swing-analysis.ts:303-310](api/swing-analysis.ts#L303-L310) |

Telemetry confirms: V6 diagnostic logs `frames_count: wireFrames.length` at [poseDetection.ts:299](services/poseDetection.ts#L299) — the client knows how many frames it sent.

---

## Recent rework — touched files audited

Commits since Fix J/K that touched any pipeline file:

| Commit | File | Frame-pipeline impact |
|---|---|---|
| aba33c2 (smartAnalysisEngine + unifiedVisionContext) | `services/smartAnalysisEngine.ts` | Touches `runClubRecommend` / `runShotStrategy` dispatch only — does NOT touch swing-analysis frame extraction |
| aba33c2 | `services/unifiedVisionContext.ts` | Composes a prompt block (GPS + hole + geometry + shots) for the brain/kevin endpoint — does NOT touch `/api/swing-analysis` |
| (prior) | `services/swingMetricsService.ts` | Synthesizes club/ball/smash/carry metrics from a Phase K result — runs AFTER analysis; no frame impact |
| 6074d80, 92f0cc2, 70120d4 | `services/poseDetection.ts` | Add language / angle / swing-validity gates. Do NOT touch the `FRAME_TIME_FRACTIONS` array or the extraction loop. |

**No commit collapsed the 5-frame extraction or shifted the API contract from `frames_base64: string[]` to a single-image shape.** The fetch body, server validation, and Sonnet content build all remain multi-frame.

---

## Two-path compartmentalization — both intact

| Perspective / routing | Endpoint | Frame count | Status |
|---|---|---|---|
| `perspective === 'watching_someone'` OR full-swing default | `/api/swing-analysis` (Phase K) | 5 (fractions above) | ✅ working |
| `perspective === 'pov_self'` AND tag `putt`/`chip` OR `meta_glasses` source-device | `/api/putting-analysis` | Up to 5 putt-phase frames at `[0.05, 0.20, 0.50, 0.70, 0.92]` via [services/puttFrameExtractor.ts:55-60](services/puttFrameExtractor.ts#L55-L60); server cap `MAX_FRAMES = 6` | ✅ working |

Routing gate at [services/videoUpload.ts:154](services/videoUpload.ts#L154) calls `getAnalyzerKind()` from [services/swingLibrary.ts:45](services/swingLibrary.ts#L45). Both branches receive multi-frame input.

---

## Where the actual bug likely lives (downstream)

Tim's symptom — analysis describing setup only — is NOT caused by extraction or transport. The 5 frames are arriving at Sonnet. Three downstream hypotheses worth verifying before any fix:

1. **System prompt may inadvertently bias toward frame[0].** The analyst prompt at [api/swing-analysis.ts:134-188](api/swing-analysis.ts#L134-L188) instructs the model on what to read. If the prompt leads with "describe the setup" or doesn't explicitly enumerate "now describe transition / impact / follow-through across the remaining frames," Sonnet may anchor on the first image and treat the rest as supporting context rather than discrete moments. Multi-image vision needs the prompt to explicitly walk the model through frame-by-frame analysis.

2. **Context lines may be malformed and pushing the model toward a single observation.** The `userContent` prepends contextual text (club, swing_number, prior_issues, language hint). If recent additions made the context block long or shifted its position relative to the images, Sonnet's attention may be skewed toward the first image + text rather than treating all five as parallel inputs.

3. **No server-side log of what Sonnet receives.** There's V6 diagnostic on the client side ([poseDetection.ts:299](services/poseDetection.ts#L299)) confirming the count outbound. There is NOT a parallel log at [api/swing-analysis.ts:314-324](api/swing-analysis.ts#L314-L324) confirming the count of distinct image blocks in the `messages.create()` call. Without that, we can't rule out a content-shape bug at the boundary (though the code reads correct).

---

## Recommended fix — described, NOT applied

**Do NOT modify frame extraction.** It is correct.

Instead, in priority order:

1. **Add server-side diagnostic logging** at [api/swing-analysis.ts:314](api/swing-analysis.ts#L314) (just before `anthropic.messages.create`) — log the count of image blocks in `userContent`, the count of text blocks, and the byte size of each image. This confirms with telemetry that Sonnet is seeing 5 images, not 1.

2. **Audit the system prompt** ([api/swing-analysis.ts:134-188](api/swing-analysis.ts#L134-L188)) to ensure it explicitly walks the model through frame-by-frame analysis. The desired shape:

   > "You are looking at 5 keyframes of a golf swing in chronological order: 1) address, 2) takeaway, 3) transition / top, 4) impact, 5) follow-through. Describe what you see in EACH frame. Do not focus on the address frame alone."

   The current prompt likely needs this enumeration if it's missing — Sonnet's multi-image behavior is sensitive to explicit framing.

3. **Synthetic test** — POST 5 distinct color-coded test frames (e.g., red / orange / green / blue / purple solid PNGs) directly to `/api/swing-analysis` with a debug-mode prompt asking "what colors do you see, in order?". If Sonnet returns one color, the pipeline is broken. If it returns all five, the bug is the analyst prompt's instructional bias.

4. **Validate the swing-validity gate** ([services/swingValidity.ts](services/swingValidity.ts) — if it exists and runs pre-analysis) isn't filtering out non-setup frames as "invalid" before they reach the wireFrames array. Confirm `wireFrames.length === 5` in real captures via the existing V6 client log.

---

## File:line citations

- Frame fractions (5 frames): [services/poseDetection.ts:108](services/poseDetection.ts#L108)
- Extraction loop: [services/poseDetection.ts:185-215](services/poseDetection.ts#L185-L215)
- Client wireFrames build: [services/poseDetection.ts:296](services/poseDetection.ts#L296)
- Client fetch body: [services/poseDetection.ts:309](services/poseDetection.ts#L309)
- Client diagnostic log: [services/poseDetection.ts:299](services/poseDetection.ts#L299)
- Server frames validation: [api/swing-analysis.ts:200-201](api/swing-analysis.ts#L200-L201)
- Server content[] build (all frames spread): [api/swing-analysis.ts:303-310](api/swing-analysis.ts#L303-L310)
- Server Sonnet call: [api/swing-analysis.ts:314-324](api/swing-analysis.ts#L314-L324)
- Analyst system prompt: [api/swing-analysis.ts:134-188](api/swing-analysis.ts#L134-L188)
- Putt extractor: [services/puttFrameExtractor.ts:55-60](services/puttFrameExtractor.ts#L55-L60)
- Putt endpoint MAX_FRAMES: [api/putting-analysis.ts](api/putting-analysis.ts) (const `MAX_FRAMES = 6`)
- Analyzer routing gate: [services/swingLibrary.ts:45](services/swingLibrary.ts#L45)
- Pipeline dispatch: [services/videoUpload.ts:154](services/videoUpload.ts#L154)

---

## Summary

The "setup-only analysis" symptom is real but the proximate cause is NOT in the frame-extraction pipeline. That pipeline is intact and multi-frame end-to-end. The bug lives in either (a) the Sonnet prompt's framing of multi-image input or (b) an undetected boundary issue that server-side telemetry would surface immediately. Fix should start with telemetry + prompt audit, not extraction code.
