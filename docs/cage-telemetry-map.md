# Cage Pipeline Telemetry Map (`[path3:cage]`)

**Phase:** BX
**Helper:** [services/cageTelemetry.ts](../services/cageTelemetry.ts) — `cageLog(stage, status, metadata)`
**Format:** `[path3:cage:STAGE] timestamp=ISO8601 status=ok|fail|partial metadata={JSON}`

Every stage transition in the cage pipeline emits a `[path3:cage]` log via the `cageLog()` helper. This document is the catalog of stages — what they mean, where they fire, what metadata to expect.

## How to capture a trace

Run a cage session on Galaxy Z Fold dev-client, then in your laptop terminal:

```bash
adb logcat -c                                 # clear
adb logcat | grep "\[path3:cage:"             # tail markers
```

Pair with `[V6-DIAG]` for Phase K internal stages and `[ttfa]` for TTS timing.

```bash
adb logcat | grep -E "\[path3:cage:|\[V6-DIAG\]|\[ttfa\]"
```

## Expected trace order — canonical overlay path (post-BV)

```
overlay-mount                       → CageSessionOverlay mounts
camera-perm-request / -grant        → camera permission resolved
mic-perm-request   / -grant         → microphone permission resolved
phase-preview                       → user sees pre-record preview
session-start                       → user tapped Start
storage-create-session              → cageStorage.createSession() persisted
storage-session-created (alias)     → component-level marker for the same step
zustand-session-start               → cageStore.startSession() ran
metering-start                      → audio metering active
recording-begin                     → camera.recordAsync() fired
swing-detected (×N)                 → audio threshold breach OR manual log
storage-add-clip-event (×N)         → clip metadata pending
session-end-trigger                 → user tapped Stop
camera-stop                         → camera.stopRecording() fired
master-video-saved                  → master.mp4 moved to session dir
metering-stop                       → Audio.Recording stopped + unloaded
storage-end-session                 → cageStorage finalized session record
clips-finalized                     → cageStorage.finalizeClips wrote clip array
storage-finalize-clips              → service-level marker for the same step
session-end                         → component-level summary marker
library-bridge-start                → about to call ingestUploadedSwing
ingest-uploaded-swing               → cageStore.ingestUploadedSwing ran
library-bridge                      → bridge complete; library entry id known
phase-k-invoke                      → fire-and-forget runPhaseKOnSession
phase-k-enter                       → runPhaseKOnSession entered (videoUpload.ts)
phase-k-result (ok/partial/fail)    → final result writes back to store
zustand-session-end                 → only if older session.tsx end-path used (LEGACY)
overlay-unmount                     → component teardown
```

## Stage catalog

### Overlay lifecycle ([components/CageSessionOverlay.tsx](../components/CageSessionOverlay.tsx))

| Stage | Status | Metadata |
|---|---|---|
| `overlay-mount` | ok | `{ isFoldOpen }` |
| `overlay-unmount` | ok | `{}` |
| `camera-perm-request` | ok | `{}` |
| `camera-perm-grant` | ok | `{ cached?: boolean }` |
| `camera-perm-deny` | fail | `{ reason: 'user-denied' }` |
| `mic-perm-request` | ok | `{}` |
| `mic-perm-grant` | ok | `{}` |
| `mic-perm-deny` | partial | `{ mode: 'manual-only' }` |
| `phase-preview` | ok | `{}` |
| `metering-start` | ok\|fail | `{ interval_ms }` or `{ error, fallback }` |
| `metering-stop` | ok | `{}` |
| `session-start` | ok\|fail | `{}` or `{ reason, error? }` |
| `storage-session-created` | ok | `{ session_id }` |
| `recording-begin` | ok | `{ session_id }` |
| `swing-detected` | ok | `{ method, offset_seconds, dBFS?, threshold_dB?, session_id }` |
| `session-end-trigger` | ok | `{ session_id }` |
| `camera-stop` | ok | `{}` |
| `master-video-saved` | ok\|fail | `{ path, duration_seconds }` or `{ reason\|error }` |
| `clips-finalized` | ok | `{ session_id, swing_count }` (component-level summary) |
| `session-end` | ok | `{ session_id, duration_seconds, swing_count }` |
| `library-bridge-start` | ok | `{ source, clipUri }` |
| `library-bridge` | ok\|fail | `{ library_entry_id }` or `{ error }` |
| `phase-k-invoke` | ok\|fail | `{ library_entry_id, mode }` or `{ error }` |

### Zustand store ([store/cageStore.ts](../store/cageStore.ts))

| Stage | Status | Metadata |
|---|---|---|
| `zustand-session-start` | ok | `{ session_id, club }` |
| `zustand-session-end` | ok\|fail | `{ session_id, shot_count, history_length }` or `{ reason }` |
| `ingest-uploaded-swing` | ok | `{ session_id, source, club, clipUri_length }` |

### Filesystem storage ([services/cageStorage.ts](../services/cageStorage.ts))

| Stage | Status | Metadata |
|---|---|---|
| `storage-create-session` | ok | `{ session_id }` |
| `storage-end-session` | ok\|fail | `{ session_id, duration_seconds, has_master_video }` or `{ reason }` |
| `storage-add-clip-event` | ok | `{ session_id, method, offset_seconds, pending_count }` |
| `storage-finalize-clips` | ok\|fail | `{ session_id, clip_count, duration_seconds }` or `{ reason }` |

### Phase K analysis ([services/videoUpload.ts](../services/videoUpload.ts))

`[path3:cage]` markers complement the existing `[V6-DIAG]` trace. The cage markers fire at the boundary; V6-DIAG fires at every internal stage.

| Stage | Status | Metadata |
|---|---|---|
| `phase-k-enter` | ok | `{ session_id }` |
| `phase-k-result` | ok\|partial\|fail | `{ session_id, primary_issue?, drill_id?, results_count?, reason? }` |

### Setup screen ([app/cage/index.tsx](../app/cage/index.tsx))

| Stage | Status | Metadata |
|---|---|---|
| `cage-index-start` | ok\|fail | `{ club, route }` or `{ reason: 'no-club-selected' }` |

### Summary screen ([app/cage/summary.tsx](../app/cage/summary.tsx))

The summary screen is the **alternate Phase K entry point** used by the older session.tsx end-path. Once Phase BV deletes session.tsx, only the overlay's `phase-k-invoke` should fire — these summary markers should NOT appear in a post-BV trace. If they do, a residual entry point routes through summary.

| Stage | Status | Metadata |
|---|---|---|
| `summary-mount` | ok | `{ session_id, shots_total, shots_with_clip }` |
| `summary-phase-k-skip` | fail | `{ session_id, reason: 'no_clipUri_on_shots' }` |
| `summary-phase-k-start` | ok | `{ session_id, swings_to_analyze }` |
| `summary-phase-k-result` | ok\|partial\|fail | `{ session_id, results_count, primary_issue?, drill_id?, reason? }` |

### Legacy path ([app/cage/session.tsx](../app/cage/session.tsx))

**Not instrumented in BX.** Phase BV deprecates or deletes this file. After BV ships, no `[path3:cage]` markers should originate from this file because it should not exist or should be a redirect-only stub.

## Diagnostic recipes

### Recipe 1 — Verify the canonical overlay path

```bash
adb logcat -c && adb logcat | grep "\[path3:cage:"
```

Run a cage session via SwingLab → Cage Mode card. Expected sequence (in order, no skips):
1. `overlay-mount`
2. `camera-perm-grant` (or request → grant)
3. `mic-perm-grant` (or partial)
4. `phase-preview`
5. `session-start` + `storage-create-session` + `storage-session-created` + `zustand-session-start` + `metering-start` + `recording-begin`
6. one or more `swing-detected` + `storage-add-clip-event`
7. `session-end-trigger`
8. `camera-stop` + `master-video-saved` + `metering-stop`
9. `storage-end-session` + `storage-finalize-clips` + `clips-finalized` + `session-end`
10. `library-bridge-start` + `ingest-uploaded-swing` + `library-bridge`
11. `phase-k-invoke` + `phase-k-enter` + (V6-DIAG sub-trace) + `phase-k-result`
12. `overlay-unmount`

If stage skips or repeats: capture the trace, attach to a regression report.

### Recipe 2 — Detect false positives empirically

```bash
adb logcat | grep "swing-detected" | wc -l
```

After a controlled session (5 real swings + 5 known background noises), the count tells you the TP+FP rate. Combined with manual recall of how many noises actually triggered, you can compute false-positive %.

### Recipe 3 — Detect dual-UI residue (post-BV verification)

```bash
adb logcat | grep -E "\[path3:cage:(zustand-session-end|summary-phase-k-)"
```

These markers should NEVER fire after BV ships. If they do, BV missed an entry point.

### Recipe 4 — Phase K shape mismatch (BU finding F2)

```bash
adb logcat | grep -E "\[V6-DIAG\] STAGE 6 FINAL|phase-k-result"
```

If `phase-k-result status=fail reason=no_data` fires consistently with multi-swing master videos, that confirms the per-clip extraction gap. BW phase fixes this.

## Stage name conventions

- **kebab-case** for stage names.
- **No spaces** in stage names; metadata may include spaces.
- **Status values**: only `ok`, `fail`, `partial`. Never invent new ones.
- **Metadata is JSON-serializable**: numbers, strings, booleans, arrays, plain objects. `cageLog` swallows serialization errors silently and emits `{"_meta_error":"unserializable"}` so a bad metadata payload never breaks the trace.

## When to add a new stage

If a new code path enters the cage pipeline, add a stage at:
1. The boundary where the new code is reached (`*-enter` style).
2. The boundary where the new code returns (`*-result` style).
3. Any `try/catch` boundary where the failure mode is itself diagnostic (use `status='fail'` with `error: e.message`).

Add the new stage to this catalog before merging.
