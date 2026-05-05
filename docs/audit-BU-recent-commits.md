# Phase BU — Component 1: Recent Commit + Uncommitted-Change Review

**Audit window:** From `6dff9f3` ("Today's session: U1 + U2 + BR + BL + BN + BJ + BI + BM + BS audit") through `HEAD` plus working tree.
**Audit date:** 2026-05-04

## Ground truth

- `6dff9f3` is the most recent commit on `origin/main` and on local `main`.
- Local branch is **1 commit ahead of origin/main** (the `6dff9f3` commit hasn't been pushed yet).
- `git log 6dff9f3..HEAD` returns **no new commits**.
- All "fixes Tim sent via Claude Code post-studio" are **uncommitted local working-tree changes** — 65 modified files + 4 new untracked avatar PNGs. None of them are committed.

This means: when Tim asks "what was changed since the studio session," the answer is split:

1. **Inside `6dff9f3`** — large bundled commit dated 2026-05-04 15:23 PDT. Includes BS audit docs, BL auto club recognition scaffolding, BR tutorial flow, U1 pose-detection fallback, BN Serena voice. **Does NOT include the BS-followup cage session refactor** (the work that targets Tim's 8 studio observations). The studio session post-mortem 8 fixes happened AFTER `6dff9f3` was created.
2. **Working tree (uncommitted)** — two distinct change sets stacked on top of `6dff9f3`:
   - **Cage session refactor** targeting Tim's studio session observations
   - **Persona widening** (4-character system: Kevin/Serena/Harry/Tank + bug fixes for Zustand hydration race)

## Working-tree changes by category

### A. Cage Mode refactor (BS-followup, uncommitted)

Addresses Tim's 8 observed studio issues directly. Files:

| File | Change | Issue addressed |
|---|---|---|
| `components/CageSessionOverlay.tsx` | +460 lines / -159. Comprehensive UI refactor: Ionicons replace emoji, `useSafeAreaInsets` for paddingBottom, `flex:1` preview, silhouette overlay, fold-aware action row, compact rec header, `runPhaseKOnSession()` invocation in `handleEndSession`, bridge to `useCageStore.ingestUploadedSwing` with `source: 'live_cage'`. | A (icon polish), B (size compaction), C (safe-area bottom), D (preview flex:1), E (silhouette overlay), F (button cutoff), G (library bridge + auto-analyze), H (default club 'unknown') |
| `store/cageStore.ts` | +16 lines. `ingestUploadedSwing()` now accepts optional `source: SwingSource` (default 'uploaded_video', live cage passes 'live_cage'). Routes id suffix and shotId by source. | G (library bridge) |
| `app/(tabs)/swinglab.tsx` | +14/-7 lines. Cage `onComplete` callback now routes to `/swinglab/swing/${sessionId}` instead of `/cage-debug`. | G (library/review routing) |

**Empirical verification status of these fixes:** **CODED ONLY — NOT VERIFIED ON DEVICE.** TypeScript and lint pass clean. Tim has not run a Cage Mode session on Galaxy Z Fold since these changes were made. The studio session that produced the 8 observations occurred *before* this work; nothing has been re-tested empirically post-fix.

### B. Persona widening (Kevin → Serena/Harry/Tank, uncommitted)

Layered ON TOP of the cage refactor in the same working tree. Touches ~62 files. **Does not touch Cage Mode logic** other than:
- `components/CageSessionOverlay.tsx` — also picked up persona refactor edits (same file, two stacked change reasons)
- `services/cageApi.ts` — `coachReview()` accepts `voiceGender` arg for persona-aware Sonnet prompts

The persona work introduced 7 follow-up bug fixes to address a hydration race condition (Zustand AsyncStorage). **None of those fixes touch Cage Mode** — they fix greeting screen audio routing, avatar component, settings hydration. Documented separately.

### C. Untracked avatar PNGs

`assets/avatars/harry_outdoor_portrait_001.png`, `harry_portrait.png`, `tank_portrait.png`, `tank_studio_portrait_001.png` — staged locally, not added to git. Only `tank_portrait.png` and `harry_portrait.png` are referenced in code.

## What the BS audit (`6dff9f3`) shipped that touches Cage

- **BL auto club recognition scaffolding** (`api/club-recognition.ts`, `services/clubRecognition.ts`) — Sonnet vision endpoint that reads the stamped club number from a photo. Wired into the active session screen (`app/cage/session.tsx`) as a **manual** picker grid; the auto-camera-button isn't yet on the live session flow. **Not directly relevant to Tim's 6 studio observations**, but it's the foundation for future club-tagging during cage practice.
- **U1 pose-detection fallback** (`api/swing-analysis.ts` — TENTATIVE_PROMPT, `services/poseDetection.ts:analyzeSwingTentative`) — when the 5-frame Phase K analysis fails to confirm a fault, falls back to a 1–2 frame relaxed observation read. **Relevant to Cage Mode** because a live cage session that captures only ambient audio with no per-event clipUri will exit Phase K early; U1 would in principle catch low-quality cases but only when there's a clipUri to begin with (which live cage doesn't produce — see Component 2).

## What recent work (committed + uncommitted) does NOT touch

- **Audio detection threshold logic** in `CageSessionOverlay.tsx` (L30–32: `TRANSIENT_THRESHOLD_DB = 14`, `DEBOUNCE_MS = 1500`, `NOISE_FLOOR_MIN_SAMPLES = 5`). Same single-modality, short-buffer-noise-floor algorithm that produced the false positives Tim observed in the studio.
- **Per-detection clip extraction**. Detected swings still store offset metadata only (`cageStorage.addClipEvent`); no per-event mp4 file is extracted from the master video. This is the structural cause of "correlation broken" — see Component 2 + 3.
- **Review UI capability gaps** in `app/swinglab/swing/[swing_id].tsx` — same minimal feature set (video player + audio toggle + Phase K result card) since Phase R.
- **Live-session UI control jumble** Tim observed — the BS-followup refactor *intends* to address this (compact rec header, fold-aware action row), but the changes are unverified empirically.

## Commit-readiness assessment

The working tree contains two intermingled change sets (cage refactor + persona work) that should ideally have shipped as separate commits. Recovery options when fixes are confirmed working:

- **Recommended**: separate commits per change set (`Phase BS-followup — cage session refactor` and `Phase BN/BU — persona widening + hydration fixes`).
- **Acceptable fallback** (matches the user-greenlit "Strategy A" pattern from the BS audit): single bundle commit with a body that enumerates both change sets honestly.

Either way, **commit should follow empirical verification of the cage refactor on Galaxy Z Fold** — not before. Per CLAUDE.md "Critical Path Verification Gates," PATH 3 CAGE has not been re-verified since the studio session.

## Summary table

| Change set | Status | Targets studio observations? | Verified? |
|---|---|---|---|
| `6dff9f3` body (BS audit + scaffolding) | Committed | Indirectly (BL future foundation, U1 fallback) | No |
| Cage session refactor (Issues A–H) | Uncommitted | YES — directly | **No** |
| Persona widening + hydration fixes | Uncommitted | No (orthogonal) | Partially (tsc/lint clean, device verification pending) |

The fixes Tim sent via Claude Code post-studio **exist in the working tree, target the right observations on paper, and have never run on a real device**. Phase BU's job is to confirm whether those uncommitted fixes are actually correct architecturally before Tim runs his next cage session — and to surface failures the refactor *didn't* address (false positives, correlation between detected events and saved media).
