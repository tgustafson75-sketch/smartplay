# Phase BU — Component 2: Cage Mode Pipeline Architecture

**Audit date:** 2026-05-04

End-to-end map of Cage Mode from session-start through review. File:line citations throughout. Telemetry markers and break-points called out.

## Pipeline overview

```
[1] Cage Index           → user picks club, taps Start
       ↓
[2] CageSessionOverlay   ← (camera + audio metering live in this component)
       ├─ [3] handleMeterReading() emits detection events on audio threshold breach
       │      → cageStorage.addClipEvent(sessionId, offset, 'audio_transient')
       │      → swingCount++ (UI counter only)
       ↓
[5] handleEndSession()
       ├─ stops camera, finalizes master_video_path
       ├─ cageStorage.endSession() → finalizeClips() (writes clip metadata to index.json)
       ├─ NEW (BS-followup, uncommitted): useCageStore.ingestUploadedSwing({source: 'live_cage'})
       │   → creates a CageSession in Zustand sessionHistory with one CageShot
       │     whose clipUri = master_video_path
       └─ NEW (BS-followup, uncommitted): runPhaseKOnSession(libraryEntryId)
       ↓
[6] /api/swing-analysis  ← Sonnet vision: 5 sampled frames → SwingAnalysis JSON
       ↓ (writes back via cageStore.setSessionAnalysis)
[7] /swinglab/library    ← getLibrary() reads sessionHistory, source='live_cage' shows
       ↓                   the cage entry alongside uploads
[8] /swinglab/swing/[id] ← review UI: video player + Phase K issue card + drill card
       ↓
[9] (no export today)
```

## Stage 1 — Session start

**Files:** [app/cage/index.tsx](../app/cage/index.tsx) (L49–82, club picker + Start), [store/cageStore.ts](../store/cageStore.ts) `startSession()` (L250–269).

`CageIndex` mounts → user picks club from `CLUBS` grid → `handleStart()` → `useCageStore.getState().startSession(selectedClub)` → store creates `activeSession` with empty `shots[]`, opens first `clubSegment`. Then routes to the live session UI.

**Camera does not initialize in this stage**. Camera + audio init happens later in `CageSessionOverlay` (Stage 2).

**Telemetry:** Silent. No `[path3:cage]` marker on session-start.

## Stage 2 — Active session state (camera + UI)

**Files:** [components/CageSessionOverlay.tsx](../components/CageSessionOverlay.tsx) (L45–280+ live session render path).

`CageSessionOverlay` is the modal that owns:
- `expo-camera` `<CameraView>` recording the master video (single mp4 per session).
- `expo-av` `Audio.Recording` with `isMeteringEnabled: true` for swing detection (started in `startMetering()` L106–148).
- The on-screen UI controls: timer, swing-count badge, Stop button, flip-camera button, cancel button.

Per the BS-followup uncommitted refactor, this component now:
- Imports `useSafeAreaInsets` and applies `paddingBottom: insets.bottom + 12` to the SafeArea.
- Renders the live-preview area with `flex: 1` so it takes the full available vertical space.
- Adds an Ionicons `body-outline` silhouette overlay at 42% green.
- Replaces emoji icons with `Ionicons` (`videocam`, `flip-camera`, `close`, `body-outline`).
- Bridges the session into `cageStore` and fires Phase K on end (see Stage 5).

**There is a separate "active session" screen at [app/cage/session.tsx](../app/cage/session.tsx)** (L376–658) which renders the feel/shape grid, log-shot button, and shot-history dots. This is a *different* live-session UI from the one in the overlay. The two paths exist because the BS-followup refactor moved the camera/recording into the overlay, but the feel/shape grid + log-shot button remained in the older `app/cage/session.tsx` route. Some users get one UI, some get the other — needs reconciliation. **This is likely the source of the "buttons jumbled" UI observation.**

**Telemetry:** Audio metering callbacks log silently (`console.log` only on detection event). No `[path3:cage]`.

## Stage 3 — Swing detection events

**Files:** [components/CageSessionOverlay.tsx](../components/CageSessionOverlay.tsx) `handleMeterReading()` L174–202.

Audio-only detection on the live `Audio.Recording` meter:
- Rolling buffer of the last 20 dBFS samples (~2s at 100ms cadence) — `meterBufferRef`.
- Noise floor = mean of last 5 samples — `NOISE_FLOOR_MIN_SAMPLES = 5` (L32).
- Threshold = noise_floor + 14 dB — `TRANSIENT_THRESHOLD_DB = 14` (L30).
- If incoming `dBFS > threshold`, emit detection.
- Debounce: ignore detections within 1.5s of the last one — `DEBOUNCE_MS = 1500` (L31).
- On detection: `cageStorage.addClipEvent(sessionId, offset, 'audio_transient')` + `swingCount++`.

**False-positive surface:**
1. **Single modality.** Pose / motion / IMU is NOT consulted. Any audio transient louder than noise floor + 14 dB triggers.
2. **Short-window noise floor.** 5 samples = 500ms of silence. A clap or bag rustle preceding a swing can artificially raise the floor *or* fail to count toward it.
3. **No semantic check.** A dropped club, a footstep on a hollow mat, a voice, or door slam all register identically to a real impact.
4. **Threshold is global, not per-club.** Driver impacts and putter taps hit the same +14 dB rule, but they have very different acoustic signatures.

**No clip extraction occurs at detection time.** Only the offset (time-since-recording-start in seconds) is stored. The master video keeps recording.

**Telemetry:** `console.log('[CageSession] Auto-detected swing @ ${offset}s')` (L192). No `[path3:cage]`.

## Stage 4 — Save logic (filesystem + store)

**Files:** [services/cageStorage.ts](../services/cageStorage.ts) (L82–115, `addClipEvent`/`finalizeClips`), [store/cageStore.ts](../store/cageStore.ts) `addShot()` (L303–336).

Two parallel persistence paths:

### Path A — `cageStorage` (filesystem)
- `addClipEvent(sessionId, offset, method)` → pushes to in-memory `_pendingEvents` Map.
- `finalizeClips(sessionId)` (called on session end) → reads pending events, builds clip metadata `{start_time_seconds: max(0, offset−2), end_time_seconds: min(duration, offset+3), detected_at_session_offset_seconds, detection_method}`, writes them into `sessions[idx].clips` in `cage_sessions/index.json`.
- **No mp4 extraction**. Clips are metadata pointing into the master video.

### Path B — `cageStore` Zustand sessionHistory
- `addShot(shot)` (called from `app/cage/session.tsx` Log Shot button) creates a `CageShot` with `clipUri: null`.
- Shots accumulate in `activeSession.shots[]`.
- On `endSession()` the activeSession is moved to `sessionHistory`.

**The two paths don't merge in live mode.** A user who taps Log Shot 8 times creates 8 `CageShot` entries with `clipUri: null`. A user who lets audio detect 8 swings creates 8 clip metadata entries in cageStorage but ZERO `CageShot` entries unless they also tapped Log Shot. **This is the "correlation broken" symptom Tim observed**: detected swing events live in cageStorage; logged shots live in cageStore; they are not joined by id, time, or any other key.

**Telemetry:** Silent.

## Stage 5 — Session end

**Files (live recording overlay):** [components/CageSessionOverlay.tsx](../components/CageSessionOverlay.tsx) `handleEndSession()` (L277–340 in working tree).

Per the **uncommitted BS-followup refactor**:
1. Stop camera, finalize master video → `masterVideoPath`.
2. Stop audio metering, unload `Audio.Recording`.
3. `cageStorage.endSession(sessionId, masterVideoPath, durationSeconds)` → finalizes clip metadata.
4. **NEW**: `libraryEntryId = useCageStore.getState().ingestUploadedSwing({clipUri: masterVideoPath, club: 'unknown', upload: {...}, source: 'live_cage'})` — creates a one-shot `CageSession` in Zustand `sessionHistory` with a single `CageShot` whose `clipUri = masterVideoPath`.
5. **NEW**: `void runPhaseKOnSession(libraryEntryId).catch(...)` — fire-and-forget Phase K analysis.
6. `onComplete(libraryEntryId ?? session.id)` → callback in `swinglab.tsx` routes to `/swinglab/swing/${sessionId}`.

**Files (older feel/shape route):** [app/cage/session.tsx](../app/cage/session.tsx) `handleEndSession()` (L350–363).

The OLDER end path is different:
1. `analyzeFinalShotPattern()` (Kevin coaching summary).
2. `endSession({dominantMiss, rootCause, summary})` (no clipUri propagation).
3. `router.push('/cage/summary')`.
4. The summary screen ([app/cage/summary.tsx](../app/cage/summary.tsx) L84–144) tries to run Phase K in a `useEffect` BUT filters `swingsWithClips = session.shots.filter(s => s.clipUri)`. Live shots have `clipUri = null`, so this filter is empty and Phase K exits early as `'no_data'`.

**Two different end-paths exist.** Which one fires depends on whether the user is in the new overlay (BS-followup) or the older feel/shape session screen. **Discrepancy not resolved in the working tree** — both code paths still exist.

**Telemetry:** `console.log('[CageSession] Session ended. Duration: ${s}s, Swings: ${n}, Video: ${path}')`. No `[path3:cage]`.

## Stage 6 — Analysis routing (Phase K)

**Files:** [services/videoUpload.ts](../services/videoUpload.ts) `runPhaseKOnSession()` (L128–330), [services/poseDetection.ts](../services/poseDetection.ts) `analyzeSwing()` + `analyzeSwingTentative()`, [api/swing-analysis.ts](../api/swing-analysis.ts).

Flow when called with a valid `clipUri`:
1. Reads `session.shots` from `cageStore`, filters to shots with `clipUri`.
2. For each shot: `analyzeSwing(clipUri, {club, swing_number, prior_issues})` → extracts 5 frames at fixed phase fractions `[0.08, 0.40, 0.60, 0.75, 0.88]`, base64-encodes, POSTs to `/api/swing-analysis` (Sonnet vision).
3. Returns `SwingAnalysis { detected_issue, severity, confidence, observation, follow_up_question }`.
4. Per-session classification: `classifySession(swings)` → primary issue + drill recommendation.
5. **U1 fallback (Phase BL/U1)**: if all swings return `none`/`failed`/no-network, retries first swing with `analyzeSwingTentative()` (1–2 frames, relaxed prompt). Result is forced to `detected_issue: 'none'`, confidence `'low'`, observation only.
6. `setSessionAnalysis(sessionId, primaryIssue, drillRecommendation)` writes into the Zustand entry.

**Empirical issue for live cage**: with the BS-followup refactor, the live cage flow now passes `masterVideoPath` as `clipUri`. Phase K will extract frames at phase fractions of the WHOLE master video. If the user took 8 swings during a 6-minute master video, Phase K extracts frames at relative timestamps 0.08, 0.40, 0.60, 0.75, 0.88 of the whole 6 minutes — which means it samples frames mostly between swings, not at impact. **The current per-clip frame extraction is the wrong shape for a multi-swing master video.** Result: low-confidence/`none` analysis for live cage.

**Telemetry:** Heavy `[V6-DIAG]` markers throughout L32–35, L133, L143, L202–210, L223–227, L248–250, L300. Full trace: `STAGE 0 enter`, `STAGE 2-3 analyzeSwing call`, `STAGE 4 returned`, `STAGE 6 fallback`, `STAGE 6 FINAL`.

## Stage 7 — Library integration

**Files:** [services/swingLibrary.ts](../services/swingLibrary.ts) `getLibrary(filter)` (L31–48), [app/swinglab/library.tsx](../app/swinglab/library.tsx).

`getLibrary()` reads `useCageStore.getState().sessionHistory`, maps each session to a `LibraryEntry` with display metadata, sorts newest first. Filter chips: all / uploads / cage. The `source` field on each session distinguishes:
- `'uploaded_video'` — set explicitly in `ingestUploadedSwing()` (default).
- `'live_cage'` — set by the BS-followup refactor's call.
- `undefined` — older sessions; treated as `'live_cage'` for back-compat.

Tapping an entry → `/swinglab/swing/${session.id}`.

**Empirical issue:** if a user runs the OLDER end path (`app/cage/session.tsx`), the live session ends with `endSession()` only — it's never bridged into `sessionHistory` via `ingestUploadedSwing`, so it appears in cageStorage filesystem but **not** in the swing library at all. The BS-followup refactor only fixed this for the overlay path.

## Stage 8 — Review UI

**Files:** [app/swinglab/swing/[swing_id].tsx](../app/swinglab/swing/[swing_id].tsx).

Renders:
- `<Video>` player (expo-av) with the `clipUri` as source.
- `PrimaryIssueCard` — shows `detected_issue`, severity, mechanical breakdown, feel cue (only if Phase K returned `'ok'`).
- `DrillCard` — shows recommended drill + reason (only if Phase K returned `'ok'`).
- Audio toggle: coach audio (embedded) vs Kevin TTS narration of the analysis.
- Status copy mapped from `analysis_status` enum (`pending`/`analyzing_frames`/`analyzing_pose`/`ok`/`failed`/`no_data`).

**Capability gaps Tim observed as "minimal":**
1. No timestamp scrubber for the per-swing impact moments within a master video.
2. No way to mark/save individual swings within a multi-swing master.
3. No comparison view (previous swing vs current).
4. No share/export.
5. No re-analyze button if Phase K returned `failed` or `no_data`.
6. No tagging (feel/shape/contact) editable post-session.

The review UI is functionally a single video player + a static analysis card. For a feature that's supposed to be the centerpiece of practice, it's thin.

## Stage 9 — Sharing / export

Not implemented. Long-press to delete is the only mutation in `app/swinglab/library.tsx`. Cloud sync deferred to v1.x per `services/videoUpload.ts` L14.

## Critical findings

### F1 — Two stale code paths for "end session"
The overlay's `handleEndSession` (BS-followup refactor) and the older `app/cage/session.tsx` `handleEndSession` are both live. They have different finalization logic. The older path doesn't bridge into `sessionHistory` and silently breaks library integration. **This needs reconciliation.**

### F2 — `clipUri = masterVideoPath` is wrong shape for multi-swing video
The BS-followup refactor passes the master video as the swing's clipUri. Phase K samples frames at phase fractions of the whole master video, which means frames land mostly between swings on a typical multi-swing session. The U1 fallback may also produce nonsensical observations because it's looking at random non-impact frames.

**Fix direction:** Either (a) extract per-detection mp4 segments from the master video (using `start_time_seconds`/`end_time_seconds` in cageStorage clip metadata) before calling Phase K, or (b) reshape Phase K to accept a multi-swing master video + a list of detection offsets and sample 5 frames per detected swing.

### F3 — Detection events don't become CageShots
Audio detection writes to `cageStorage._pendingEvents`. CageShots are created only when the user manually taps Log Shot in the older session screen. **The two channels never join.** This is the "correlation broken" Tim observed. Even if Phase K worked correctly, the user-visible "I logged 5 swings, but the library shows 0 entries" mismatch is structural.

### F4 — UI control jumble (overlay vs feel/shape session screen)
There are TWO different live-session UIs that can be reached depending on entry point:
- The overlay (camera + Stop button + silhouette).
- `app/cage/session.tsx` (feel/shape grid + Log Shot + Kevin coach box).

If both are reachable in the same navigation flow, controls overlap or compete. Tim's observation of "buttons jumbled, can't see all controls" likely stems from this.

### F5 — No telemetry on the cage live path
No `[path3:cage]` markers on session start, detection event, end, library write, or Phase K invocation from the live path. CLAUDE.md mandates these markers for path verification. Until they're added, every cage failure requires source-code inspection rather than logcat grep.

### F6 — Audio detection is single-modality + globally tuned
No pose, no IMU, no per-club thresholds. Tim's "background noise triggered swings that weren't real" observation is a direct consequence.

### F7 — Review UI is thin
Single video player + static card. No multi-swing scrubber, no per-swing extraction, no comparison, no re-analyze, no edit-tags. Tim's "minimal capability" observation matches.

## File summary table

| Stage | File | Function/Component | Telemetry | Status |
|---|---|---|---|---|
| 1 | `app/cage/index.tsx` | `CageIndex()`, club picker | Silent | OK |
| 1 | `store/cageStore.ts` (L250) | `startSession(club)` | Silent | OK |
| 2 | `components/CageSessionOverlay.tsx` | `<CameraView>` + `Audio.Recording` metering | Silent | UI ambiguity vs older session.tsx |
| 2 | `app/cage/session.tsx` (L376+) | feel/shape grid + Log Shot | Silent | Stale; competes with overlay |
| 3 | `CageSessionOverlay.tsx` (L174) | `handleMeterReading()` | `[CageSession]` (loose) | Single-modality, false-positive prone |
| 4 | `services/cageStorage.ts` (L82) | `addClipEvent`/`finalizeClips` | Silent | Metadata only, no mp4 extraction |
| 4 | `store/cageStore.ts` (L303) | `addShot()` | Silent | clipUri=null in live; broken correlation |
| 5 | `CageSessionOverlay.tsx` (L277) | `handleEndSession()` (BS-followup) | `[CageSession]` (loose) | Bridges to library + fires Phase K. Unverified. |
| 5 | `app/cage/session.tsx` (L350) | `handleEndSession()` (older) | Silent | Doesn't bridge to library. Stale. |
| 6 | `services/videoUpload.ts` (L128) | `runPhaseKOnSession()` | `[V6-DIAG]` | Wrong frame-sample shape for master video |
| 7 | `services/swingLibrary.ts` | `getLibrary()` | Silent | OK once bridged |
| 8 | `app/swinglab/swing/[swing_id].tsx` | review screen | Silent | Thin |
| 9 | — | (no export) | — | Deferred 1.x |

## Recommended next-step verification (out of audit scope)

1. Add `[path3:cage]` markers at: session start, each detection, session end, library write, Phase K start, Phase K result.
2. Run a controlled session (5 known real swings + 3 known background-noise events).
3. Grep `adb logcat | grep "\[path3:cage\]"` and verify counts.
4. Open the resulting library entry and confirm Phase K result vs expected (likely `no_data` or low-confidence `none` due to F2).
