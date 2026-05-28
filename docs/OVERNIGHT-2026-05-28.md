# Overnight 2026-05-28 — Audit + Fixes Summary

Morning Tim. Here's what happened while you slept.

## Shipped fixes (8 total, both channels, server-side deployed)

| Fix | Commit | What |
|-----|--------|------|
| FJ | 6a7b821 | Caddie speaks on mic-blocked instead of bare alert (presence pass C) |
| FK | 0f4ce88 | Tools menu polish — tightened subtext, dropped duplicate cards, fixed Cage route bug |
| FL | e7c5a43 | Coalesced stationary GPS noise so subscribeFixChange fanout doesn't churn (iPad SmartVision glitch) |
| FM | 82310c3 | `tier='quick'` on SmartMotion — Haiku-only, skip OpenAI+Sonnet escalation (~35s → ~5s server-side) |
| FN | aad0435 | Route chip/putt clips to short-game prompt — stop spurious "early extension" calls |
| FO | c62d5cb | Pose backfill probes real duration + tiered sampling for long uploads (Katie's videos) |
| FP | ccbe060 | Audio transcript flows into analyzer + file-size visibility on /api/transcribe |
| FQ | 027b5ab | Bounded wait for coach_audio + hoisted cageAngleCtx out of per-swing loop |
| FR | 0888757 | Surface green-coord resolution source in calcLog (dev-audit telemetry) |

All Vercel deploys ● Ready. OTAs on both preview + production.

---

## What you asked for, what you got

### Item 1 — SmartMotion `swing_tag` for chip/putt (FN)
SmartMotion was calling /api/swing-analysis without `swing_tag`, so every chip and putt went through the full-swing fault classifier (spurious "early extension" reads on glasses-POV chips). Now derives the tag from:
- Voice `shotType` param ("chip cam" / "putt cam") — already forwarded by quick-record, just wasn't being read
- Selected club — PT→putt, LW/SW/GW→chip

Combined with FM's `tier='quick'`, chip/putt clips now hit Haiku with the short-game prompt and ship in ~5s.

### Item 2 — Pose API silent failure (FO)
Two converging bugs on Katie's full-body coaching videos:
1. **Duration default of 3s**: swing-detail backfill called `analyzeSwingFromVideo` with `(session.upload.duration_sec ?? 3) * 1000`. Camera-roll uploads typically have `duration_sec=null` → 3000ms. Pose sampled at 5/25/50/65/90% of THREE seconds in a 30-second clip — every frame landed in the first 3s where Katie was just starting to talk.
2. **Fixed-fraction assumption**: even with the right duration, `SWING_POSITIONS = [0.05, 0.25, 0.50, 0.65, 0.90]` assumed "the entire clip is the swing" — fine for in-app 3s captures, wrong for Katie's "talk + demo + swing" structure.

Fix:
- `probeDurationMs` exported and called inside `analyzeSwingFromVideo`; probe wins when caller passed the suspicious 3000 default or disagrees by >50%
- Tiered sampling matching the vision analyzer's windows: >10s → wide-spread back-tilted (LONG_CLIP_POSITIONS), 4-10s → last-5s back-window, <4s → original
- Frame-counts logged so silent failures are visible in `adb logcat` next time

### Item 3 — Audio transcription end-to-end (FP)
Discovered the infrastructure ALREADY existed — `swingCommentaryService.ts` (Fix AJ Phase 2, 2026-05-25) subscribes to cageStore and POSTs every clip to `/api/transcribe`. Two gaps were keeping it from working for Katie's case:
1. **No file-size pre-check**: Katie's videos can be 30-50MB; `/api/transcribe` rejects at 25MB. The service waited 30s for the upload to fail, then silently bailed.
2. **Analyzer never saw the transcript**: even when transcription succeeded, `shot.commentary_transcript` was rendered as "YOUR COMMENTARY" on the swing-detail screen but never threaded into the vision prompt.

Fixes:
- New `services/videoTranscription.ts` helper with file-size pre-check (skips at 20MB with clean log), language threaded from settingsStore, elapsed_ms telemetry on every call
- `swingCommentaryService` refactored to use the helper
- `coach_audio` field added to AnalyzeSwingContext; `videoUpload.ts` threads `shot.commentary_transcript` into the analyzer when present
- Server prompt block in `api/swing-analysis.ts` tells the analyzer to confirm-or-mismatch against the audio rather than take it as ground truth
- **Fix FQ follow-up**: bounded 5s wait for transcript when `session.upload.has_audio === true` so the FIRST analysis sees it, not just re-analyze. Silent clips skip the wait (speed path untouched)

---

## Speed wins shipped

Per your "make analysis faster" ask, here's what actually moves the needle (in shipped order):

| Where | Saved | Notes |
|-------|-------|-------|
| FM (tier='quick' on SmartMotion) | ~30s | Server skips OpenAI+Sonnet escalation when Haiku returns parseable |
| FN (correct swing_tag) | indirect | Chip/putt no longer escalate from bad fault classification |
| FO (pose duration probe) | unblocks | Pose actually finds the swing now; not a latency win, a correctness win |
| FQ (cageAngleCtx hoist) | ~50ms × shots | Per-session save in the parallel-batch path |

The audit confirmed most other speed wins are already shipped (parallel per-shot batching at 3, payload compression 800px/0.65, Lambda warmup throttled, tiered duration probe, etc.).

**Remaining speed opportunities I did NOT ship** (all low impact or higher risk):
- Sonnet `max_tokens: 800` could probably drop to 500-600 (~100ms saved) — needs profiling first to avoid truncated reads
- Pose-frame extraction in `poseAnalysisApi` runs sequentially (line 510 `for (const { key, timeMs } of positionTimes)`) — could parallelize to ~5x faster, but pose is already a non-blocking backfill so it doesn't affect perceived latency
- Coach-audio race I fixed (FQ) adds up to 5s for clips with audio — that's a worthwhile trade (much better analysis), not a regression

---

## Dev audit — findings prioritized for YOUR review

The audit flagged some real architectural concerns and some overstated risks. I dismissed the overstated ones; the rest are listed here for your call (none shipped overnight — they need your judgment):

### Real concerns worth addressing (your call):

1. **`commentary_transcript` has no status field** — when transcription fails (network, oversize, Whisper down), we can't tell whether it was tried-and-failed vs not-yet-tried. Adding `commentary_transcript_status: 'pending' | 'ok' | 'failed' | 'not_attempted'` would let the UI show "audio transcription couldn't read this clip" instead of just no card. **Effort: ~1hr. Risk: low.**

2. **L1 quiet-mode bypass inconsistency** — `voiceService.isVoiceAllowed` gates everything except `userInitiated: true`, but not every proactive speak() caller is audit-clean on which paths set `userInitiated`. Risk of silent L1 violations (caddie talks when you're in Quiet). **Effort: ~2hr audit + ESLint rule. Risk: medium.**

3. **Hydration ordering on app launch** — `useVoiceCaddie` mounts and reads `settingsStore.language` / `caddiePersonality` before AsyncStorage rehydration finishes; some boots end up with stale language. **Effort: half day for proper fix. Risk: medium — touches boot path.**

4. **Three GPS pollers fire on similar cadences without synchronization** — holeDetection (4s) + offCourseDetector (5s) + movementModeDetector (5s) all read `lastFix` independently. Order of mutations on the same fix is non-deterministic. After FL this is less of a glitch source but still architecturally fragile. **Effort: half day to consolidate. Risk: medium — affects round-flow logic.**

### Dismissed (claims I verified are wrong):

- **"Concurrent shot.perShotAnalysis overwrites"** — claimed pose backfill overwrites perShotAnalysis with null. Verified: pose backfill writes `session.biomechanics`, NOT `shot.perShotAnalysis`. All setters use immutable spread merge (`{ ...shot, field: val }`) so concurrent writes to different fields preserve each other. No bug.
- **"Cage capture 2s assumption skews frame sampling"** — the `FALLBACK_DURATION_MS = 2000` only triggers when Audio.Sound probe AND multiple VT probes ALL fail. Extreme edge case. Not a practical issue.

### Low-priority telemetry (FR shipped one of these):

- Smart-finder green-coord resolution source — **shipped (FR)** — calcLog now records which path (truth/override/courseHoles/geometryCache) produced the coords. Helpful for "wrong-course" diagnosis.
- presenceCaddie local fallback could include club/hole context when brain is down — small enhancement, not urgent

---

## What's still on the queue (your prior asks)

These were on the todo list before tonight and remain:

- **Companion-vs-Active-Listening defaults** — you picked "App / round launch default" as the resting state. Not shipped tonight (deferred to your morning so you can confirm the exact behavior — e.g. what gates Active Listening if it's no longer the default).
- **Brain-fetch local fallback** — when /api/kevin times out, fall back to local intent routing so "open SmartMotion" still navigates even without the brain. Not shipped (you picked "Add better error path" in the question earlier, but I prioritized the three items from your sleep ask).
- **Tools menu polish further iterations** — beyond FK, the Caddie tab still has the green-arrow dropdown with several pills that could simplify.

---

## Recommended next session

In rough order of impact-per-effort:

1. **Verify FN/FO/FP actually helped Katie's videos** — pull one of Katie's uploads from your camera roll, re-upload, watch for: (a) Coach Audio card appears with her words, (b) primary issue read references what she said, (c) biomechanics overlay renders
2. **Verify FM/FN actually helped SmartMotion latency** — record a glasses-POV chip and time it; should be ~8-15s now instead of ~60s
3. **Ship the Active-Listening default change** you flagged — quick UX call
4. **Decide on transcript-status field** (dev audit #1) — small but visible improvement

Sleep well. I'm here when you wake up.
