# Phase BU — Component 5: Recommended Fix Sequence

**Audit date:** 2026-05-04

Phased fix proposals, priority-ordered by severity and dependency. Each entry: phase ID, scope, files, estimated hours, verification approach, dependency notes. No fix is shipped without empirical verification on Galaxy Z Fold.

## Priority 1 — BLOCKING. Cage Mode is non-functional until these land.

### BV — Reconcile dual live-session UIs

**Targets:** Observation 1 (UI layout jumbled), part of Observation 4.

**Scope:**
- Pick `components/CageSessionOverlay.tsx` as the canonical live-session UI (it's the newer, refactored path with safe-area handling and silhouette overlay).
- Migrate the feel/shape grid + Log Shot button + Kevin coach box from `app/cage/session.tsx` into the overlay (or remove them if they are no longer the desired UX).
- Delete `app/cage/session.tsx` from active routing OR convert it to a thin redirect.
- Audit every navigation surface that opens cage: `app/(tabs)/swinglab.tsx`, `app/cage/index.tsx`, voice intent open_tool="swinglab" routing, Tools menu — verify all reach the canonical UI.

**Files:**
- `components/CageSessionOverlay.tsx` (extend)
- `app/cage/session.tsx` (delete or redirect)
- `app/cage/index.tsx` (route to overlay)
- `app/(tabs)/swinglab.tsx` (cage card onPress)
- `services/intents/openToolHandler.ts` (cage tool routing if applicable)

**Estimated hours:** 3–4

**Verification:** See Component 6 — UI verification protocol. Cold launch → tap Cage Mode card → verify only one UI renders, all controls visible (Stop, flip, swing-count, club label, feel/shape grid if kept), no overlap on Fold-closed AND Fold-open.

**Dependencies:** None. Can ship first.

---

### BW — Per-detection clip extraction at session end

**Targets:** Observation 4 (save/routing broken), Observation 6 (correlation broken).

**Scope:** This is the structural fix. After camera stop and master video write, before bridging to library:
1. Read clip metadata from `cageStorage` (already structured: `start_time_seconds`, `end_time_seconds`, `detected_at_session_offset_seconds`, `detection_method` per detected event).
2. For each clip, extract a 5-second mp4 segment from the master video at the specified time range. Save to `cage_sessions/<id>/clip_<n>.mp4`.
3. Construct one CageShot per extracted clip with `clipUri = clip_<n>.mp4`, source `'live_cage'`, club from session-level club state, timestamp from absolute session start + offset.
4. Push CageShots into the session's `shots[]` array.
5. Bridge into library via `ingestUploadedSwing` — but reshape: instead of one ingest with the master video, the live session creates one full CageSession with N CageShots (each with its own clipUri), and Phase K runs per-clip.

**Library/tooling decision required:**
- **Option A:** `expo-video-thumbnails` — already installed for frame extraction in upload pipeline. Verify whether it supports video-segment extraction (vs single-frame thumbnails). If yes: lowest-friction path.
- **Option B:** `expo-av` Recording API to re-record sub-segments — likely slow and impractical.
- **Option C:** Native ffmpeg bridge (`react-native-ffmpeg` or `ffmpeg-kit-react-native`) — heavyweight install but reliable. Adds ~30MB to bundle.
- **Option D:** Defer per-clip extraction; ship a Phase K reshape that accepts a master video + offset list and samples 5 frames around each offset. Avoids native dependency. Per-event mp4 files can come later.

**Recommended:** Option D first (Phase K reshape), Option A or C as a 1.x improvement if per-clip mp4 files are user-valuable for sharing.

**Files:**
- `components/CageSessionOverlay.tsx` `handleEndSession` — wire the new flow
- `services/cageStorage.ts` `finalizeClips` — return clip metadata to caller
- `services/videoUpload.ts` `runPhaseKOnSession` — reshape to accept multi-swing master + offset list (Option D) OR consume per-clip URIs (Option A/C)
- `services/poseDetection.ts` `analyzeSwing` — accept time-range + masterUri parameters
- `store/cageStore.ts` — possibly add a multi-shot ingest helper (parallel to `ingestUploadedSwing`)

**Estimated hours:** 5–8 (Option D), 8–12 (Option A or C with per-clip extraction).

**Verification:** See Component 6. Run a 5-real-swing session, confirm 5 CageShots in library entry, each with valid clipUri/offset, Phase K runs and returns ≥3 confidence-medium analyses.

**Dependencies:** BV (one canonical UI) so we know which `handleEndSession` to wire.

---

### BX — `[path3:cage]` telemetry markers

**Targets:** Empirical verification gate per CLAUDE.md. Every PATH 3 fix is a verification blocker without these.

**Scope:** Add `console.log('[path3:cage] <event>')` markers at:
- `startSession()` enter (cageStore)
- `handleStart()` enter (CageSessionOverlay)
- Camera permission grant
- `handleMeterReading()` detection emit (with offset, dB, threshold)
- `handleEndSession()` enter
- `cageStorage.finalizeClips` complete (clip count)
- Per-clip extraction success/fail (post-BW)
- `ingestUploadedSwing` call from cage path
- `runPhaseKOnSession` enter + final result

Pair with `[V6-DIAG]` markers already in `runPhaseKOnSession` for end-to-end trace.

**Files:**
- `components/CageSessionOverlay.tsx`
- `store/cageStore.ts` `startSession`/`endSession`
- `services/cageStorage.ts` `finalizeClips`
- (already has [V6-DIAG] in `services/videoUpload.ts`)

**Estimated hours:** 1–2.

**Verification:** Run a 3-swing session, grep `adb logcat | grep "\[path3:cage\]"`, confirm expected sequence of markers.

**Dependencies:** None. Can ship before BV/BW. Recommended **first** so subsequent verification is grep-based, not source-code-based.

---

## Priority 2 — SIGNIFICANT. Feature is genuinely useful only after these.

### BY — Detection signal-to-noise hardening

**Targets:** Observation 3 (false positives).

**Scope:** Two-tier:

**Quick win (recommended first):**
- Lengthen noise-floor window from 5 → 20 samples (`NOISE_FLOOR_MIN_SAMPLES = 20` ≈ 2s).
- Raise threshold from +14 → +18 dB (or make it adaptive to the noise-floor variance).
- Add a basic spectral check: `Audio.Recording` doesn't expose FFT, but a high-pass via signal-to-rms-ratio over the buffer's recent peak vs 100ms-prior baseline can serve as a sharpness proxy. If the spike's "sharpness ratio" is below threshold, reject (likely voice or ambient).

**Proper fix:**
- Pipe the live mic stream through `services/acousticEngine.ts` (already used by upload pipeline for ball-speed estimation). It has FFT + spectral classification. Add an `isImpactLikelihood(spectralFingerprint, club)` predicate that returns confidence in [0,1].
- Per-club threshold mapping (driver impact vs putter tap have different transient widths and dominant frequencies).

**Files:**
- `components/CageSessionOverlay.tsx` (L30–32, L174–202)
- `services/acousticEngine.ts` (extend if proper fix)
- New module: `services/impactClassifier.ts` (proper fix)

**Estimated hours:** 2–3 (quick win), 6–10 (proper fix).

**Verification:** Controlled test (Component 6) — 5 real swings + 5 known background noises (clap, club drop, voice, footstep, door). Verify ≥4/5 real swings detected, ≤1/5 false positives.

**Dependencies:** BX (telemetry to measure detection events vs noise events).

---

### BZ — Review UI capability uplift

**Targets:** Observation 5 (review UI limited).

**Scope:** Phased uplift to `app/swinglab/swing/[swing_id].tsx`:

**v1 (must-haves):**
- Re-analyze button (re-runs `runPhaseKOnSession` if status is `failed` or `no_data`).
- Editable tags post-session (feel/shape/contact).
- Multi-swing timestamp scrubber (depends on BW per-clip URIs OR offset metadata): horizontal timeline showing detected swing markers, tap to jump video to swing N.

**v2 (nice-to-haves):**
- Side-by-side comparison view (this swing vs prior swing in same session).
- Pin/favorite a swing.

**v3 (deferred):**
- Share / export.

**Files:**
- `app/swinglab/swing/[swing_id].tsx`
- New: `components/swinglab/SwingScrubber.tsx`
- `store/cageStore.ts` (tag-edit mutators)
- `services/poseDetection.ts` (re-analyze entry point)

**Estimated hours:** 4 (v1), 6 (v2), 4 (v3).

**Verification:** Each capability has a specific empirical check — see Component 6.

**Dependencies:** BW (multi-swing scrubber needs per-swing data structure).

---

## Priority 3 — POLISH. After core works.

### CA — Per-club detection thresholds

Build on BY's spectral classifier; add per-club calibration. Driver/iron/wedge/putter each have characteristic transients. Use the existing `clubProfiles` in `cageStore` as the persistence layer.

**Estimated hours:** 4–6.

### CB — Per-clip mp4 file extraction (if BW shipped Option D)

Upgrade from offset-based Phase K (Option D) to actual extracted mp4 segments. Required if/when share/export becomes a feature, since you'd need a file to share.

**Estimated hours:** 4–8 (depends on chosen ffmpeg/thumbnails library).

### CC — Pose-confirmation for detection (out of scope today)

Multi-modal: combine audio detection with pose-based motion confirmation in a 200ms window. Requires pose detection running on the live preview frames, which today only runs at extraction time. Significant infra lift; deferred until pose becomes a real-time feature.

---

## Phase ordering — recommended sequence

```
1. BX  Telemetry markers           [1–2h]   ← ships first; enables verification
2. BV  Reconcile dual UIs          [3–4h]   ← removes ambiguity
3. BW  Per-detection clips/Phase K [5–8h]   ← structural fix for BLOCKING issues 4 + 6
4. BY  Detection hardening (quick) [2–3h]   ← false-positive quick win
5. BZ  Review UI v1 must-haves     [4h]     ← practice value
─── empirical verification gate per CLAUDE.md ───
6. BY  Detection hardening (proper)[6–10h]  ← if quick win insufficient
7. CA  Per-club thresholds         [4–6h]
8. BZ  Review UI v2/v3             [10h]
9. CB  Per-clip mp4 extraction     [4–8h]
10. CC Pose confirmation           [defer]
```

**Total work to FUNCTIONAL Cage Mode (BLOCKING + first-pass SIGNIFICANT):** ~15–21 hours.

**Total work to GREAT Cage Mode (everything in P1+P2 properly):** ~35–45 hours.

## Honest scope discipline notes

Per CLAUDE.md:
- Don't add features beyond what each phase requires. BV is just reconciliation, not a UI redesign. BW is just per-clip extraction, not a new analysis pipeline. BY is just signal-to-noise, not an ML model.
- Don't ship without empirical verification. Each phase has a specific Galaxy Z Fold check listed in Component 6.
- Honest framing: "Cage Mode is non-functional today" is more useful than "we're 30% there." Tim's empirical state is the bar.
