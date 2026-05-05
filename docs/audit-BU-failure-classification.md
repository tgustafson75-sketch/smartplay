# Phase BU — Component 3: Failure Classification

**Audit date:** 2026-05-04

Each of Tim's six empirical studio-session observations classified by severity, root cause hypothesis, and fix complexity. Cross-references to Component 2 pipeline findings (F1–F7).

## Severity scale

- **BLOCKING** — Feature cannot be used or core value is defeated. Must fix before any other Cage Mode work or before declaring PATH 3 verified.
- **SIGNIFICANT** — Feature works but degraded enough that it actively damages user trust or data quality.
- **MINOR** — Polish / edge case. Can be deferred without compromising the feature.

## Observation 1 — UI LAYOUT ISSUE

**Tim's words:** "Cage screen buttons jumbled, can't see all controls during active session."

**Severity:** **BLOCKING** — A control surface the user can't operate is not a feature.

**Root cause hypothesis:** Two competing live-session UIs exist (Component 2 finding F4):
- `components/CageSessionOverlay.tsx` — camera + Stop + flip + silhouette.
- `app/cage/session.tsx` — feel/shape grid + Log Shot + Kevin coach box.

Either (a) the user reaches both at once and they overlap, or (b) the overlay's old layout (pre-BS-followup refactor) had insufficient bottom padding so the Stop button hit the gesture-nav bar on Galaxy Z Fold. The BS-followup refactor in the working tree adds `useSafeAreaInsets` + `paddingBottom: insets.bottom + 12` and a fold-aware action row, which targets root cause (b) directly. Root cause (a) is **not addressed** by the working-tree refactor — both code paths still exist.

**Files likely involved:**
- `components/CageSessionOverlay.tsx` (BS-followup refactor — uncommitted)
- `app/cage/session.tsx` (older live UI — still present, not removed)
- Whichever route the user takes from `app/(tabs)/swinglab.tsx` Cage Mode card

**Fix complexity:** 2–4 hours. Lowest-risk path: pick one canonical live UI, route both entry points through it, delete the other. Highest-risk path: try to keep both and de-conflict — not recommended.

**Empirical evidence in working tree:** Layout fix coded but not verified on device. Two-UI ambiguity not addressed.

---

## Observation 2 — VIDEO RECORDING WORKS

**Tim's words:** "Works. Videos play back when found."

**Severity:** **n/a** — confirmed working.

**Notes:** The master video write path (camera → mp4 in `cage_sessions/<id>/master.mp4`) is functioning. Playback via expo-av `<Video>` component in `app/swinglab/swing/[swing_id].tsx` works when the library entry has a valid `clipUri`. **The recording itself is not the issue.** The issues are around what's done WITH the recording (correlation, library, analysis).

---

## Observation 3 — SWING DETECTION FALSE POSITIVES

**Tim's words:** "Background noise (studio ambient, other activity) triggered detected swings that weren't real."

**Severity:** **SIGNIFICANT** — Degrades data quality. Every false positive becomes a noise data point in the swing count, in the analysis pipeline, in the practice statistics. Defeats the "I hit 8 swings" trust contract.

**Root cause hypothesis:** Single-modality audio detection with globally tuned threshold (Component 2 finding F6, F3):
- `TRANSIENT_THRESHOLD_DB = 14` is the same number for driver impacts and putter taps and accidental noises.
- `NOISE_FLOOR_MIN_SAMPLES = 5` (500ms at 100ms cadence) is too short — a sustained background event at start can shift the floor enough that a louder spike won't fire, OR a spike immediately after a quiet moment fires falsely.
- No semantic check (no spectral signature match, no pose confirmation, no IMU correlation).
- `DEBOUNCE_MS = 1500` only prevents double-counting one event; it doesn't reject non-swings.

**Files likely involved:**
- `components/CageSessionOverlay.tsx` (L30–32 thresholds, L174–202 `handleMeterReading`)
- `services/acousticEngine.ts` (existing acoustic library, currently used by upload pipeline only — the live cage path doesn't consult it)
- `services/acousticBallSpeed.ts` (ditto — exists but not used for live detection)

**Fix complexity:** 4–8 hours depending on approach.
- **Quick win (2h):** Tune thresholds + lengthen noise-floor window + add spectral filter (frequency-band check on impact: golf impact has a sharp 1–4 kHz transient, voice/clap has different signature).
- **Proper fix (4–8h):** Pipe the live mic through `acousticEngine.ts` to get spectral classification + per-club threshold mapping. Optionally add a 200-300ms confirmation window where a second cue (silence-after-impact, decay shape) must follow.
- **Multi-modal (out of scope for first pass):** IMU/pose confirmation requires watch + camera infrastructure not present.

**Empirical evidence in working tree:** Not addressed. Same thresholds, same algorithm.

---

## Observation 4 — SAVE/ROUTING BROKEN ⚠️ THE BIG ONE

**Tim's words:** "Detected swings did NOT save to swing library or auto-route to analysis pipeline. Session captured but disconnected from downstream value (analysis, review, sharing)."

**Severity:** **BLOCKING** — Defeats core value of feature. A practice tool that doesn't preserve practice data is a recording app, not a practice tool.

**Root cause hypothesis:** Multi-layered (Component 2 findings F1, F3):
1. **Detection events live in `cageStorage` (filesystem/JSON), shots live in `cageStore` (Zustand). They don't share a key.** Detected swings increment a counter and write clip metadata; manually-logged shots create CageShot entries with `clipUri: null`. Neither path produces a session that has BOTH per-event mp4 clips AND CageShot entries with valid clipUri values.
2. **Two end-paths exist** (F1). The BS-followup refactor's `handleEndSession` in `CageSessionOverlay.tsx` DOES bridge to the library via `ingestUploadedSwing({source: 'live_cage'})` and DOES call `runPhaseKOnSession`. But the older `handleEndSession` in `app/cage/session.tsx` does NEITHER. Depending on which path is reached, the session may or may not appear in the library.
3. **The bridge that exists passes the master video as the clip** (F2). Phase K then samples 5 frames from across the entire master video, which for an 8-swing master is mostly between-swing frames. Result: even when the bridge fires, Phase K returns `'no_data'` or low-confidence `'none'`.

**Files likely involved:**
- `components/CageSessionOverlay.tsx` `handleEndSession` (BS-followup, uncommitted)
- `app/cage/session.tsx` `handleEndSession` (older path, still live)
- `store/cageStore.ts` `ingestUploadedSwing()` (L396–424)
- `services/videoUpload.ts` `runPhaseKOnSession()` (L128–330)
- `services/cageStorage.ts` `finalizeClips()` (L92–115)
- A NEW bridge service that turns clip-metadata-offsets into per-clip mp4 files (does not exist today)

**Fix complexity:** 6–12 hours. This is the heaviest fix because it requires:
1. **Picking one canonical end-path** and removing the other (1–2h).
2. **Per-detection clip extraction**: when session ends, for each entry in `cageStorage._pendingEvents`, extract a 5-second mp4 segment (offset−2 to offset+3) from the master video. Use `expo-video-thumbnails` or a native ffmpeg bridge. Save each as `cage_sessions/<id>/clip_<n>.mp4` (3–5h).
3. **Create one CageShot per extracted clip** with `clipUri = clip_<n>.mp4`. Source is `'live_cage'`. Push all shots into the session's `shots[]` before calling `runPhaseKOnSession` (1h).
4. **Test Phase K** on a per-swing clip — should now produce per-swing analysis. Verify multi-swing classifySession picks a primary issue (1–2h).

**Empirical evidence in working tree:** Layer-2 bridge (`ingestUploadedSwing` with source) is coded. Layer-3 wrong-shape clipUri remains. Layer-1 dual-path remains.

---

## Observation 5 — REVIEW UI LIMITED

**Tim's words:** "Looking at recorded swings has minimal capability."

**Severity:** **SIGNIFICANT** — Practice value depends on review. Without scrubbing, marking, comparison, or re-analysis, the user can't learn from the recording.

**Root cause hypothesis:** `app/swinglab/swing/[swing_id].tsx` is a single-clip player + static analysis card (Component 2 finding F7). Capability gaps:
- No timestamp scrubber for per-swing impact moments within a master video.
- No way to mark or favorite individual swings within a multi-swing session.
- No side-by-side comparison view (this swing vs prior swing, or this swing vs reference).
- No re-analyze button if Phase K returned `failed`/`no_data`.
- No edit-tags post-session (feel/shape/contact set during session is locked after).
- No share/export (deferred to v1.x).

**Files likely involved:**
- `app/swinglab/swing/[swing_id].tsx` (current review screen)
- Possibly a new sub-component for multi-swing scrubber
- `services/poseDetection.ts` for re-analyze support
- `store/cageStore.ts` for tag-edit mutations

**Fix complexity:** Variable, 4–12 hours depending on which gaps are prioritized.
- **Re-analyze button** (1h): just exposes `runPhaseKOnSession()` from a button.
- **Edit-tag post-session** (2–3h): adds CageShot mutators in cageStore + UI affordances.
- **Multi-swing scrubber** (3–5h): needs per-swing clip extraction (depends on Observation 4 fix) + a horizontal timeline component.
- **Comparison view** (4–6h): two-pane player + sync state.

**Empirical evidence in working tree:** Not addressed.

---

## Observation 6 — CORRELATION BROKEN

**Tim's words:** "Detected swing events not linked to saved images/videos. Even successful detections don't propagate to library."

**Severity:** **BLOCKING** — Data integrity. If detection events and saved media can't be joined, every other feature on top of this is built on sand.

**Root cause hypothesis:** Same root as Observation 4 (Component 2 findings F1, F3):
- Detection events (in `cageStorage._pendingEvents` → finalized into `clips[]` array with offset metadata).
- Saved media (single master.mp4 per session; no per-event extracted clips).
- Library entries (in `cageStore.sessionHistory`, with at most one CageShot per live session in the BS-followup path, and that CageShot points at the master video, not at any detection event).

**No correlation ID exists** that joins a clipEvent to a CageShot to a clipUri to a Phase K analysis. They are three separate stores with three separate keying schemes.

**Files likely involved:** Same as Observation 4 — this is essentially the same fix viewed from the "data integrity" angle rather than the "downstream value" angle.

**Fix complexity:** Subsumed in Observation 4's fix. If the per-detection clip extraction is implemented correctly, each detected event becomes one CageShot with one clipUri, which auto-correlates by shared session id + index.

**Empirical evidence in working tree:** Not addressed. No correlation primitive added.

---

## Severity summary

| # | Observation | Severity | Coded fix exists? | Verified? |
|---|---|---|---|---|
| 1 | UI layout jumbled | BLOCKING | Partial (BS-followup refactor in overlay only) | No |
| 2 | Video recording works | n/a | n/a | Yes (Tim's report) |
| 3 | Detection false positives | SIGNIFICANT | No | n/a |
| 4 | Save/routing broken | **BLOCKING** | Partial (library bridge only; clip-extraction missing) | No |
| 5 | Review UI limited | SIGNIFICANT | No | n/a |
| 6 | Correlation broken | **BLOCKING** | No | n/a |

## Cross-cutting observations

- **Two parallel live-session code paths (overlay + older session.tsx)** are the proximate cause of Observation 1, contribute to Observation 4, and increase the surface area of every cage fix going forward. Picking one canonical path is a force multiplier.
- **`clipUri = master_video_path` is wrong** for multi-swing live sessions. Phase K needs per-swing clips, not a whole-session video. This is the structural fix for Observation 4 and 6 simultaneously.
- **No `[path3:cage]` telemetry on the live path** means every empirical verification requires source-code inspection, not log grep. CLAUDE.md mandates these markers; their absence is itself a verification blocker.
- **Single-modality audio detection** is the structural fix for Observation 3. Anything short of pose/IMU/spectral confirmation is tuning, not a real fix.

## Severity-ordered fix list (preview — full sequence in Component 5)

**Must-fix-before-anything-else (BLOCKING):**
- Pick one canonical live UI; remove the other (Obs 1, partial fix for Obs 4).
- Add per-detection clip extraction at session end (Obs 4, Obs 6).
- Add `[path3:cage]` markers (verification gate per CLAUDE.md).

**Fix-for-genuine-utility (SIGNIFICANT):**
- Detection threshold tuning + spectral filter (Obs 3).
- Re-analyze button + tag editing in review UI (Obs 5).

**Polish (MINOR):**
- Comparison view, multi-swing scrubber, share/export (Obs 5 deeper gaps).
