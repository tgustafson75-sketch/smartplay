# Upload Analysis Pipeline Map (Phase BQ Component 1)

**Date:** 2026-05-04
**Scope:** Swing-video upload from picker → Phase K analysis → user-visible result.
**Companion to:** [docs/club-recognition-architecture.md](club-recognition-architecture.md), [docs/migration-gap-analysis.md](migration-gap-analysis.md)

---

## TL;DR

The upload pipeline is **all-local, no cloud upload** in v1.0. The "upload" name is a UX term, not a backend transfer. The video URI returned by the OS picker is stored as-is in `cageStore` and read directly by the analysis pipeline. Frames are sampled on-device, base64-encoded, and POSTed to the Vercel-hosted Anthropic Sonnet vision endpoint per swing.

**Failure-prone stages historically:** frame extraction (Phase V.6 fix), API call (timeout / network), classifier output (Phase V.6 single-swing classifier branch), UI status propagation. See "Failure modes" section.

---

## Stage-by-stage map

Stage IDs match the `[upload:<stage>]` markers added in Phase BQ Component 2.

| # | Stage | File:function | What happens | Existing markers | New `[upload:*]` markers |
|---|---|---|---|---|---|
| 1 | **User entry** | [app/swinglab/upload.tsx](../app/swinglab/upload.tsx) — `UploadSwing` | User taps "Upload Swing" route, sees pick-then-metadata UI | none | none (UI surface) |
| 2 | **File picker** | [services/videoUpload.ts:pickVideo](../services/videoUpload.ts) | `expo-image-picker.launchImageLibraryAsync` (videos), permissions check, file-size cap (200MB) | none | `[upload:capture-start]` / `[upload:capture-end]` (status: ok\|cancelled\|failed) |
| 3 | **Probe video** | [services/videoUpload.ts:probeVideo](../services/videoUpload.ts) | `Audio.Sound.createAsync` to read duration + infer audio-track presence | none | `[upload:preprocess-start]` / `[upload:preprocess-complete]` |
| 4 | **Metadata UI** | [app/swinglab/upload.tsx](../app/swinglab/upload.tsx) — `step === 'metadata'` | Club picker, notes, swinger, tag (purely UI state) | none | none |
| 5 | **Save tap** | [app/swinglab/upload.tsx](../app/swinglab/upload.tsx) — `onSave` | Tim taps "Add to Library" → `ingestVideoFromPick` | none | `[upload:save-tap]` |
| 6 | **Local store ingest** | [services/videoUpload.ts:ingestVideoFromPick](../services/videoUpload.ts) → [store/cageStore.ts:ingestUploadedSwing](../store/cageStore.ts) | Builds `UploadMetadata`, creates a one-shot `CageSession` with `source: 'uploaded_video'`, returns `sessionId` | none | `[upload:storage-local]` (with sessionId scoped from here on) |
| 7 | **Navigate to swing detail** | [app/swinglab/upload.tsx](../app/swinglab/upload.tsx) — `router.replace('/swinglab/swing/${sessionId}')` | Routes to swing detail; user sees "Saving…" briefly then the detail screen | none | none — the next marker is `[upload:ui-render]` from the detail screen |
| 8 | **Background analysis trigger** | [services/videoUpload.ts:ingestVideoFromPick](../services/videoUpload.ts) — fire-and-forget `runPhaseKOnSession(sessionId)` | Returns synchronously; analysis runs in the background. UX is "Kevin starts watching." | none | `[upload:analysis-trigger]`, `[upload:analysis-trigger-throw]` (only if the FAF promise rejects synchronously) |
| 9 | **Phase K entry** | [services/videoUpload.ts:runPhaseKOnSession](../services/videoUpload.ts) | Reload session from store; abort if missing; probe each clip's file info | `[V6-DIAG] STAGE 0` | `[upload:phase-k-enter]`, `[upload:phase-k-abort]` (session not in store), `[upload:phase-k-no-swings]` (zero clipUri) |
| 10 | **Per-swing pose detection** | Loop over swings → [services/poseDetection.ts:analyzeSwing](../services/poseDetection.ts) | For each swing: extract frames, POST to `/api/swing-analysis`, parse response | `[V6-DIAG] STAGE 1-4` (duration probe → frame extract → POST → parse) | `[upload:pose-detection-start]` (once per session), `[upload:frame-analysis-start]` / `[upload:frame-analysis-complete]` (per swing, with `kind` and `confidence`), `[upload:pose-detection-complete]` (once per session, with successful/attempted counts) |
| 10a | **Frame extraction** | [services/poseDetection.ts:extractKeyFrames](../services/poseDetection.ts) | Probe duration via `Audio.Sound` then `expo-video-thumbnails` lower-bound; sample 5 frames at fractions [0.08, 0.40, 0.60, 0.75, 0.88]; resize to 1024px wide @ q=0.75 JPEG; base64-encode | `[V6-DIAG] STAGE 1-2` per-frame | covered by `[upload:frame-analysis-start/complete]` parent |
| 10b | **Vision API** | POST `${EXPO_PUBLIC_API_URL}/api/swing-analysis` with frames + context, 30s `AbortSignal.timeout` | [api/swing-analysis.ts](../api/swing-analysis.ts) — Anthropic Sonnet (`claude-sonnet-4-6`, max 400 tokens, T=0.2). Returns `{ detected_issue, severity, confidence, observation, follow_up_question? }` | server-side `console.log/error` only on errors | covered by `[upload:frame-analysis-complete]` (carries `kind` + `confidence` + error message) |
| 11 | **No-results branch** | `if (results.length === 0)` | If every swing returned `none/no_frames/no_network/error`, fire **U1 heuristic fallback** (`analyzeSwingTentative`) on first available clip — single-frame at 0.5/0.3/0.7 fractions + `mode: 'tentative'` server prompt → synthesise a tentative `PrimaryIssue` (issue_id `tentative_read`, confidence `low`) so the user gets a useful observation. If tentative also fails, surface stage-specific copy (no_frames vs no_network vs error vs mixed). | `[V6-DIAG] STAGE 6 / TENTATIVE STAGE 0-4` | `[upload:phase-k-zero-results]`, `[upload:tentative-fallback-start]`, `[upload:tentative-fallback-complete]` |
| 12 | **Classifier** | [services/swingIssueClassifier.ts:classifySession](../services/swingIssueClassifier.ts) | Aggregates per-swing analyses into a single `PrimaryIssue` (or null if no consensus). Phase V.6 added single-swing branch. | `[V6-DIAG] STAGE 5` | `[upload:classifier-start]` / `[upload:classifier-complete]` (with primary_issue_id, severity, confidence) |
| 13 | **Drill recommendation** | [services/drillRecommendation.ts:recommendDrill](../services/drillRecommendation.ts) | Maps `primary_issue.issue_id` → `DrillRecommendation` from the bundled drill library | none | covered by `[upload:result-store]` |
| 14 | **Store analysis** | [store/cageStore.ts:setSessionAnalysis](../store/cageStore.ts) | Patches `primary_issue` + `drill_recommendation` onto the session in `sessionHistory` (immutably). Sets `analysis_status: 'ok'`. | `[V6-DIAG] STAGE 6 FINAL — ok` | `[upload:result-store]` |
| 15 | **Side-effects** | [services/relationshipEngine.ts:processSwingAnalysis](../services/relationshipEngine.ts) + [services/contextSynthesizer.ts:synthesizeCageInsight](../services/contextSynthesizer.ts) | Feeds Kevin's relationship engine; fires Sonnet synthesis for `recentInsights[]` | none | none (additive, not gating user-visible output) |
| 16 | **UI render** | [app/swinglab/swing/[swing_id].tsx](../app/swinglab/swing/[swing_id].tsx) | Subscribed to `cageStore`. Renders `analyzing_*` progress copy → `PrimaryIssueCard` + `DrillCard` on `analysis_status === 'ok'`. TTS auto-narrates. | none | `[upload:ui-render]` (one event per analysis_status transition) |
| 17 | **Re-analyze** | [app/swinglab/swing/[swing_id].tsx](../app/swinglab/swing/[swing_id].tsx) — `onReanalyze` (Phase V.7) | Resets status to `pending`, clears `spokenForRef`, calls `runPhaseKOnSession(swing_id)` again | none | `[upload:reanalyze-start]` |

---

## Stages with no logging coverage today (gaps that BQ instrumentation closes)

| Stage | Gap | BQ marker added |
|---|---|---|
| pickVideo entry/exit | Silent — no record of permission denial, cancellation, oversize | `[upload:capture-start/end]` |
| probeVideo | Silent | `[upload:preprocess-start/complete]` |
| onSave (Save tap) | Silent | `[upload:save-tap]` |
| ingestVideoFromPick → store | Silent (only V6-DIAG inside runPhaseKOnSession) | `[upload:storage-local]`, `[upload:analysis-trigger]` |
| Per-swing analyze loop boundaries | V6-DIAG covers per-swing ENTER/EXIT; no aggregate start/complete event | `[upload:pose-detection-start/complete]` (aggregate); `[upload:frame-analysis-start/complete]` (per-swing) |
| Classifier boundaries | V6-DIAG has STAGE 5 entry; no completion event | `[upload:classifier-start/complete]` |
| Result store | V6-DIAG has FINAL ok/failed; doesn't break out the actual `setSessionAnalysis` call | `[upload:result-store]` |
| UI render | None — silent | `[upload:ui-render]` (one event per status transition) |
| Re-analyze trigger | None | `[upload:reanalyze-start]` |
| FAF (`runPhaseKOnSession.catch`) | Was a console.log; gives no structured trace | `[upload:analysis-trigger-throw]` |

---

## Logging conventions

`[upload:*]` markers are emitted by `services/uploadDiagnostic.ts`'s `uploadLog(stage, data?, key?)` function. Format:

```
[upload:<stage>] {"ts":1714862400000,"delta_ms":124,"elapsed_total_ms":3210,"session_key":"<sessionId>",...stage-specific data...}
```

- **`ts`** — wall-clock ms since epoch.
- **`delta_ms`** — ms since the previous marker for the same `key`. Powers stage-by-stage timing analysis.
- **`elapsed_total_ms`** — ms since the first marker for the same `key`. Powers end-to-end latency analysis.
- **`session_key`** — present for events scoped to a specific upload session. Pre-ingest events use `pre-session` and have no session_key; the `uploadAdoptSessionKey()` call in `storage-local` promotes the pre-session timing record to the session-scoped one so the trace is continuous across the ingest boundary.
- **stage-specific keys** — `status: 'ok'|'failed'|'cancelled'`, `message: string` (failures), plus contextual data (size_mb, duration_ms, kind, confidence, primary_issue_id, drill_id, etc.).

`[V6-DIAG]` markers are pre-existing and stay untouched. `[upload:*]` markers fill the gaps. Both can be filtered together via `adb logcat | grep -E 'upload:|V6-DIAG'`.

`uploadLog` also mirrors every event to `analytics.track('upload_stage', { stage, delta_ms, ... })` so Sentry breadcrumbs (when configured) capture the full trace alongside crash reports.

---

## How to read the trace

For an empirical capture, expect this happy-path sequence per upload:

```
[upload:capture-start]
[upload:capture-end]   status=ok size_mb=15 duration_ms=12000
[upload:preprocess-start]
[upload:preprocess-complete]   status=ok has_audio=true duration_sec=12
[upload:save-tap]   club=7i has_audio=true duration_sec=12
[upload:storage-local]   status=ok session_id=1714... club=7i
[upload:analysis-trigger]   session_id=1714...
[upload:phase-k-enter]   session_id=1714...
[upload:pose-detection-start]   swings_to_analyze=1
[upload:frame-analysis-start]   index=0 club=7i
[V6-DIAG] STAGE 1 / 2 / 3 / 4 ...    ← deep-pipeline trace
[upload:frame-analysis-complete]   index=0 kind=ok status=ok detected_issue=swing_path_outside_in confidence=high
[upload:pose-detection-complete]   status=ok successful=1 attempted=1
[upload:classifier-start]   results_count=1
[upload:classifier-complete]   status=ok primary_issue_id=swing_path_outside_in confidence=high
[upload:result-store]   status=ok primary_issue_id=swing_path_outside_in drill_id=...
[upload:ui-render]   analysis_status=analyzing_frames ...    ← these fire as state propagates
[upload:ui-render]   analysis_status=analyzing_pose ...
[upload:ui-render]   analysis_status=analyzing_pattern ...
[upload:ui-render]   analysis_status=ok has_primary_issue=true has_drill=true
```

When something fails, the **last marker emitted** identifies the stage where execution stopped. The marker's `status: 'failed'` plus `message` field carries the immediate cause; the surrounding V6-DIAG line has the deep-pipeline detail.

### Likely failure signatures

| What you see in the trace | Almost-certainly cause |
|---|---|
| Stops after `[upload:capture-end] status=ok` — no `preprocess-start` | `pickVideo` returned but `probeVideo` never invoked. UI step transition broken in `app/swinglab/upload.tsx` |
| `[upload:preprocess-complete] status=failed` | `Audio.Sound.createAsync` threw — codec/format issue or file not actually a video |
| Stops after `[upload:save-tap]` — no `storage-local` | `ingestVideoFromPick` never returned; check `cageStore.ingestUploadedSwing` for an exception path that doesn't currently log |
| Stops after `[upload:storage-local]` — no `analysis-trigger` | Code path bug — `analysis-trigger` is emitted directly after; if missing, suspect a try/catch swallowing |
| `[upload:phase-k-abort] reason=session_not_in_store` | The store rehydration race — session was created but the loop reads `getState()` before the persist write completes |
| `[upload:frame-analysis-complete] kind=no_frames` for every swing | Frame extraction failed — likely Phase V.6's targeted area: codec, duration probe, or VT.getThumbnailAsync failure |
| `[upload:frame-analysis-complete] kind=no_network` | API call timed out (30s `AbortSignal.timeout` in `analyzeSwing`) or network actually unavailable |
| `[upload:frame-analysis-complete] kind=error message="HTTP 5..."` | Server-side `/api/swing-analysis` failed — Anthropic API issue, prompt validation, model availability |
| `[upload:classifier-complete]` shows `primary_issue_id=null` | All swing analyses were `none` — classifier had no consensus. Phase V.6 added a single-swing fallback; check `confidence` |
| `[upload:result-store]` fires but `[upload:ui-render]` never reaches `analysis_status=ok` | UI subscription isn't picking up the store update — Zustand persistence race or the swing-detail screen isn't subscribed correctly |
| `[upload:ui-render] analysis_status=ok` fires but user reports "nothing rendered" | Render gate inside `[swing_id].tsx` is hiding the cards despite ok status — check the conditional render path |

---

## Failure modes addressed by prior phases (and the ones that remain hypothetical)

| Phase | Claimed fix | Actually addressed | Still possible |
|---|---|---|---|
| V.6 (commit `2e5f4d0`) | Single-swing classifier + duration-probe fallback + tentative-read caveat | Yes — three real bugs landed in `services/swingIssueClassifier.ts`, `services/poseDetection.ts:probeDurationMs`, and `PrimaryIssueCard` confidence prefix | Frame extraction can still return zero usable frames if the device's `expo-video-thumbnails` build silently fails on a particular codec |
| V.7 (re-analyze button) | Reset `pending` + retry path | Yes — exists at [swing_id].tsx:178 onReanalyze | If the ROOT cause is in the API call (timeout, model issue), retry just produces the same outcome |
| U1 (timeout + heuristic fallback) | Explicit timeout + heuristic-fallback path | **Not shipped.** U1 was held back per Tim's BQ direction ("stop patching"). The existing 30s `AbortSignal.timeout` in `analyzeSwing` was already an explicit timeout; lowering it without empirical data was speculative. | A real fix here is gated on whether the empirical trace shows timeouts as the actual failure mode — vs. e.g. zero-frames or classifier-returns-null |

---

## What this map does NOT cover

- **The Anthropic Sonnet vision endpoint internals.** The prompt + canonical-issue catalog are in [api/swing-analysis.ts](../api/swing-analysis.ts:21-95). If empirical data shows the failure is "model returns garbage," the fix lives there.
- **`expo-video-thumbnails` codec edge cases on Galaxy Z Fold.** This is a known fragile dep; the fallback duration-probe (`probeDurationMs`) was a Phase V.6 mitigation but doesn't fix the underlying frame-extraction failure when the codec just won't decode.
- **The cage live-recording path.** Components from [components/CageSessionOverlay.tsx](../components/CageSessionOverlay.tsx) follow a similar but not identical pipeline. BQ's instrumentation focuses on the *upload* path (uploaded_video source). Live-cage uses `[V6-DIAG]` markers and they remain untouched.

---

## Empirical capture protocol (what Tim runs)

1. Connect Galaxy Z Fold via USB. Authorize.
2. Open Terminal, run:
   ```
   adb logcat -c
   adb logcat -s ReactNativeJS:I | grep -E "upload:|V6-DIAG"
   ```
3. Open SmartPlay → SwingLab → Upload → pick a video that has previously failed.
4. Watch the trace stream. The last `[upload:*]` marker before the trace stops is the failure point.
5. Save the full log; paste in chat. The next phase prompt should be focused on the specific failure stage, not pipeline-wide speculation.

---

## What changes in code (BQ Component 2 only — no fix yet)

Files modified:
- `services/uploadDiagnostic.ts` — NEW (95 LOC). `uploadLog`, `uploadResetTiming`, `uploadAdoptSessionKey`. No new deps.
- `services/videoUpload.ts` — added `[upload:*]` markers at: capture-start/end (pickVideo), preprocess-start/complete (probeVideo), storage-local + analysis-trigger (ingestVideoFromPick), phase-k-enter/abort/no-swings/zero-results/throw, pose-detection-start/complete, frame-analysis-start/complete, classifier-start/complete, result-store, analysis-trigger-throw. V6-DIAG markers preserved untouched.
- `app/swinglab/upload.tsx` — added `[upload:save-tap]` on save tap.
- `app/swinglab/swing/[swing_id].tsx` — added `[upload:ui-render]` on analysis_status transitions, `[upload:reanalyze-start]` on reanalyze tap.

Verification:
- `npx tsc --noEmit` — 0 errors
- `npm run lint` — 1 error + 8 warnings (identical to pre-BQ baseline; zero regression)
- No new dependencies. No new behavior. **Diagnostic-only changes.**

The Component 4–10 work (root cause analysis, targeted fix, multi-scenario testing, regression protection, failure messaging, full architecture doc) is gated on Tim's empirical capture per BQ Component 3.
