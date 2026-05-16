# Phase 403 (analysis) Audit: SmartMotion swing-analysis pipeline

**Audit Date:** 2026-05-15
**Scope:** end-to-end SmartMotion swing analysis from clip ingest →
Sonnet vision → per-shot diagnostic → review-UI rendering.
**Methodology:** read-only inspection of `api/swing-analysis.ts`,
`api/smartmotion.ts`, `services/poseDetection.ts`,
`services/videoUpload.ts`, `services/swingIssueClassifier.ts`,
`services/poseAnalysisApi.ts`, `store/cageStore.ts` (CageShot + CageSession +
mutators), `components/swinglab/PrimaryIssueCard.tsx`, and
`app/swinglab/swing/[swing_id].tsx` (the review screen).

> **Note on naming.** A different "Phase 403" shipped today as
> `app/smartmotion-quick.tsx` (the simplified course-mode capture
> surface). This audit is about the swing-*analysis* pipeline that runs
> AFTER a clip is captured — same name, different layer. Internally we
> tag this work "Phase 403b" to avoid collision with the capture phase.

---

## 1. Input source

**REAL — per-detected-swing clips with frame extraction.**

- Live-cage multi-shot path: `services/videoUpload.ts` accepts a master
  video URI + N swings with `clipStartSeconds` / `clipEndSeconds`
  boundaries (CageShot field at `store/cageStore.ts:46-47`). Phase K
  samples frames **inside each swing's window only**, not the whole
  master video.
- Single uploaded swing (and the new SmartMotion quick capture, Phase
  403): `cageStore.ingestUploadedSwing` wraps a single clipUri as one
  CageShot with no boundaries — `analyzeSwing` falls back to
  whole-clip sampling.
- Frame extraction: `services/poseDetection.ts:132-207`
  (`extractKeyFrames`). 5 frames at fractions `[0.08, 0.40, 0.60, 0.75,
  0.88]` (`poseDetection.ts:87`) — clustered around the 60–78%
  downswing-to-impact window where face/path/contact are most readable.
  Each frame carries `time_sec` for temporal anchors.

## 2. Analysis processing

**REAL and STRUCTURED.**

- Model: `claude-sonnet-4-6` (`api/swing-analysis.ts:168`).
- System prompt (lines 77–117) enforces a canonical-fault catalog of 11
  values + 'none', plus severity ∈ {minor, moderate, significant,
  none}, plus confidence ∈ {high, medium, low}, plus a one-sentence
  observation and an optional follow-up question. Response is required
  to be JSON only.
- Tentative prompt (lines 57–75) is a fallback for the case where the
  primary 5-frame call returned no usable result — forces
  detected_issue='none', confidence='low', and asks for a
  general descriptive observation only. Wired at
  `services/videoUpload.ts:282-372` (`analyzeSwingTentative`).
- Response parsing at `api/swing-analysis.ts:182-206` strips fences,
  enforces enum membership, and normalises out-of-range values to
  conservative defaults.

**Gap.** The analyst prompt does NOT ask Sonnet to report **which
frame index** showed the fault. So even though 5 frames are submitted,
the response tells you "weight is hanging back" without telling you
**which of the 5 frames you should look at**. The 5 frame images are
discarded after the response returns.

**Gap.** The analyst prompt does NOT inject persona character. The
SmartMotion quick capture endpoint (`api/smartmotion.ts:67-104`)
**does** inject a persona/caddie name; Phase K's
`api/swing-analysis.ts` does not. Result: a Kevin user and a Tank user
get the same neutral analyst voice in the structured observation.

## 3. Output storage

**REAL.**

- Per-shot: `setShotAnalysis(sessionId, shotId, { detected_issue,
  severity, confidence, observation })` writes
  `CageShot.perShotAnalysis` at `store/cageStore.ts:571` and is called
  for every successful per-swing analysis at `videoUpload.ts:261-266`.
- Per-shot timestamps: `setShotIssueTimestamps` stores the 5 sampled
  `time_sec` values as `CageShot.detected_issue_timestamps_sec` at
  `store/cageStore.ts:671`.
- Session-level aggregation: `classifySession` rolls up per-swing
  outcomes into `CageSession.primary_issue` (mechanical_breakdown +
  feel_cue + visual_reference_path field at
  `store/cageStore.ts:166`) and `drill_recommendation`.
  **Note: `PrimaryIssue.visual_reference_path` field already exists in
  the type — but is never written to anywhere.** It's a stub field
  waiting for a producer.
- Biomechanics: `setSessionBiomechanics` fires fire-and-forget after
  Phase K completes (`videoUpload.ts:443-457`). Computed via
  `services/poseAnalysisApi.ts` only when `POSE_API_KEY` is configured.

## 4. PostSessionReview rendering

**PARTIAL.**

- Single-upload swings render `PrimaryIssueCard`, `DrillCard`, and
  `BiomechanicsCard` (when present). Per-swing analysis row IS hidden
  — `app/swinglab/swing/[swing_id].tsx:479` gates it on
  `session.shots.length > 1`. The single-upload analysis exists in
  `shot.perShotAnalysis` but the UI never shows it for single-shot
  sessions.
- Multi-swing live-cage sessions render the per-swing list (line
  487+). Each row shows: index, issue name, confidence badge, good-rep
  star, notes icon, "tap to jump" video scrub.
- Detected-moment pills (`lines 414-431`) render `issueTimestamps_sec`
  values as scrub-to-time buttons — but only the session-level value;
  per-swing timestamps aren't surfaced in the per-swing rows.
- **No fault-frame image rendered anywhere.** The 5 frames extracted
  for analysis are sent to Sonnet and then discarded; the `visual_
  reference_path` field on `PrimaryIssue` is permanently null.

## 5. Caddie voice

**REAL — but neutral, not in-character.**

- Auto-narration on first completion at
  `app/swinglab/swing/[swing_id].tsx:115-125, 153-169` — speaks the
  primary issue name + mechanical breakdown + feel cue via the
  `speak()` service.
- Voice gender comes from `settingsStore.voiceGender`. Persona
  (Tank/Kevin/Serena/Harry) is NOT injected into the analyst voice — the
  copy is the same regardless of active caddie. Tank-style cadence
  ("Weight's hanging back at frame 4. Not acceptable. Drill incoming.")
  is in the spec but not in code.

## 6. Phase K pipeline

**REAL end-to-end.** `runPhaseKOnSession()`
(`services/videoUpload.ts:129-470`) walks every usable swing in the
session, calls `analyzeSwing()` per swing with boundary windows when
present, aggregates results via `classifySession()`, recommends a
drill, kicks pose biomechanics fire-and-forget. No stubs in the data
flow.

## 7. Verdict by component

| Component | State | Evidence |
|-----------|-------|----------|
| Per-clip frame extraction | REAL | `poseDetection.ts:132-207` |
| Per-swing Sonnet call | REAL | `videoUpload.ts:220-266` |
| Structured fault output | REAL | `api/swing-analysis.ts:77-117, 182-206` |
| **fault_frame_index in response** | **MISSING** | prompt schema has no such field |
| **Fault-frame image persistence** | **MISSING** | 5 frames extracted, all discarded after inference |
| **PrimaryIssue.visual_reference_path written** | **MISSING** | field exists in type, no producer |
| Per-swing render for SINGLE uploads | **PARTIAL** | gated on `shots.length > 1` |
| Per-swing render for MULTI-swing | REAL | `[swing_id].tsx:479-541` |
| **Persona injection in analyst prompt** | **MISSING** | `api/swing-analysis.ts:77` is generic |
| Caddie voice TTS playback | REAL | `[swing_id].tsx:153-169` |
| Phase K orchestration | REAL | `videoUpload.ts:129-470` |
| Biomechanics card | REAL | `[swing_id].tsx:565-579` (audit's earlier "missing" was wrong; it does render when biomechanics is non-null) |

## STATE OF SMARTMOTION ANALYSIS

**SmartMotion produces real per-swing structured diagnostics today.
What's missing is the *visual* and *character* layer Tim wants: (a)
Sonnet doesn't tell us which frame showed the fault, (b) the 5
extracted frames are thrown away so there's no JPEG to show the user,
(c) per-swing analysis is hidden on single-upload sessions even though
it exists in the store, and (d) the analyst speaks in a neutral
voice instead of the active caddie's cadence.** The diagnostic exists;
the evidence and character don't.

## What ships in this phase

Priority order:

1. **`fault_frame_index` in Sonnet response** — extend
   `api/swing-analysis.ts` schema + system prompt. 0-based index into
   the submitted frames identifying the most diagnostic frame.
2. **Persist that frame as a JPEG to the FileSystem cache** — when
   Phase K calls `analyzeSwing`, on success save
   `frames[fault_frame_index]` to a stable path keyed by shot id.
3. **CageShot.perShotAnalysis extended** with `visual_reference_path`
   and `fault_frame_index` (additive, optional). New mutator
   `setShotFaultFrame(sessionId, shotId, path, frame_index)`.
4. **Persona injection** — pass active caddie name into
   `api/swing-analysis.ts` request body; system prompt accepts a
   `caddie_name` and instructs the analyst to use that caddie's
   cadence in `observation` (Tank: clipped imperative; Kevin: neutral
   technical; Serena: precise; Harry: warm-encouraging).
5. **Per-swing card rendered on single uploads** — remove the
   `length > 1` gate at `[swing_id].tsx:479`. Single uploads now see a
   "this swing" card with their own diagnostic instead of only the
   session-level aggregate (which for a 1-swing session was just the
   same data anyway).
6. **Fault-frame thumbnail + "See the moment" expansion** — when
   `perShotAnalysis.visual_reference_path` is set, render a thumbnail
   in the per-swing row. Tap to expand to a full-size view with the
   observation overlaid.

Empirical accuracy validation against Tim's real swings is deferred to
his Z Fold pass — same standing pattern as Phase 400/401/402.

What this phase does NOT include (per the brief):
- Reference swing comparison (Phase 404)
- Shot tracer overlay
- Multi-angle analysis
- Real-time analysis during recording
- Annotation overlay on the fault frame (subtle indicator pointing to
  the fault area) — the frame itself is the evidence; annotation can
  come later
