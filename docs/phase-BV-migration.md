# Phase BV — Cage UI Reconciliation: Feature Migration Decisions

**Phase:** BV (companion to Phase BX telemetry, follows Phase BU audit)
**Date:** 2026-05-04
**Resolution:** Replace `app/cage/session.tsx` (1012 lines, legacy feel/shape grid + Kevin coach) with thin wrapper around `components/CageSessionOverlay.tsx`. Single canonical live-session UI.

## Summary

Per Phase BU audit Component 2 finding F4, two parallel live-session UIs existed:

1. **`components/CageSessionOverlay.tsx`** — camera + audio detection + Stop button + silhouette overlay. Used by `app/(tabs)/swinglab.tsx` Cage Mode card via inline `setCageActive(true)`.
2. **`app/cage/session.tsx`** — feel/shape tagging grid + Log Shot button + Kevin coach box. Reached via `/cage/index.tsx` Start button (which is in turn reached from SwingLab Cage Setup card OR Caddie Tools menu Cage Mode).

Phase BV converges to UI #1 (the overlay). This document records what was in UI #2 and the decision per feature.

## Features in legacy `app/cage/session.tsx` and migration disposition

| Feature | What it did | Phase BV disposition | Rationale |
|---|---|---|---|
| **feel/shape grid** (5 contact × 4 shape buttons) | User taps to label each swing with feel (Flush/Fat/Thin/Heel/Toe) and shape (Draw/Straight/Fade) before logging. | **DEFERRED** | Per-shot user-tagging is a different paradigm than the overlay's audio-detection-plus-Phase-K-classification. Tagging has user value when each shot can be reviewed individually with its tag. That requires per-detection mp4 extraction (Phase BW) so each tagged shot becomes a reviewable artifact. Restoring tagging into the overlay before BW ships would create UI for data the analysis pipeline can't consume per-shot. Defer to a follow-up phase ("BV-followup — restore per-shot tagging in overlay or summary view") that ships AFTER BW makes per-shot analysis useful. |
| **Log Shot button** | Manual per-shot logger that creates a `CageShot` in `activeSession.shots` with the selected feel/shape. | **REPLACED** | Overlay's `handleLogSwing()` does the same thing semantically (manual swing log via `addClipEvent(sessionId, offset, 'manual')`) without the feel/shape coupling. When BW ships per-clip extraction, manual logs and audio-detected logs both become per-shot CageShot entries with proper clipUri values. |
| **Kevin coach box** (live in-flight coaching) | After each Log Shot, ran `analyzeFinalShotPattern()` + `getKevinShotResponse()` and spoke a Kevin coaching line via `speak()`. Pattern-aware: streak detection, every-5-shots summary, every-3-shots tempo comment. | **DEFERRED** | The pattern engine + tempo analysis depends on per-shot tagged data (feel/shape/contact). With audio-only detection in the overlay, there's no input to drive the pattern engine. Useful again post-BW when per-clip Phase K results provide per-shot signals (issue type per swing → live "you've missed right twice in a row"). Wire-up phase: "BV-followup — live Kevin coaching post-BW." |
| **Pattern bar** (real-time hit/miss visualization) | Visual streak indicator updated on each Log Shot. | **DEFERRED** (with coaching) | Same dependency on per-shot tagged data. Restore alongside the live coach. |
| **Session history dots** (visual feedback as shots accumulate) | Small dot row showing each logged shot's outcome. | **DEFERRED** (with coaching) | Same dependency. |
| **Club picker modal** (mid-session club switch via Phase BL three-tier) | Tap club label → modal opens → user picks a different club → segment switch in `cageStore.clubSegments`. | **CARRIED FORWARD INTO OVERLAY (followup)** | Phase BL auto-club-recognition is shipped scaffolding but not yet wired into the overlay's recording phase. Future phase wires it. Not part of BV scope. |
| **Watch tempo integration** | Read averageTempo / dominantFault / earlyTransitionRate from `useWatchStore` and surfaced "You're 3.2:1 backswing-to-downswing" lines in Kevin's coach commentary. | **DEFERRED** | Watch integration depends on the live coach being live. Restore alongside. |
| **Camera/distance calibration** (`/cage/index.tsx`) | Setup screen with distance prompt, club selector, calibration helper. | **PRESERVED** | Setup screen is unchanged. Only the post-Start screen (`/cage/session`) is changed. |

## What replaces the legacy file

`app/cage/session.tsx` is now a 30-line wrapper:

```tsx
export default function CageSession() {
  const router = useRouter();
  return (
    <CageSessionOverlay
      onComplete={(sessionId) => {
        if (sessionId) router.replace(`/swinglab/swing/${sessionId}`);
        else router.replace('/swinglab/library');
      }}
      onCancel={() => router.replace('/cage')}
    />
  );
}
```

All four cage entry points now reach the overlay:

```
SwingLab Cage Mode card (inline)         ──┐
SwingLab Cage Setup card → /cage       ──┐ │
Caddie Tools Cage Mode  → /cage        ──┤ │
                                          ├─→ /cage/session (overlay wrapper)
                                       ──┤ │
                                          ──┘
                                            ↓
                                  CageSessionOverlay
                                            ↓
                                  onComplete → /swinglab/swing/[id]
```

## What was preserved

- All cage `[path3:cage]` telemetry markers from Phase BX continue to fire from the overlay.
- The Phase K analysis path (overlay → `runPhaseKOnSession` background) is unchanged.
- The `cageStore` shape, persistence, and `ingestUploadedSwing` are unchanged.
- The `cageStorage` filesystem layout (master.mp4 + clip metadata) is unchanged.
- `app/cage/index.tsx` setup screen is unchanged. Its `handleStart` still routes to `/cage/session`.
- `app/cage/summary.tsx` is unchanged. Currently orphaned for the new flow (overlay's onComplete navigates directly to `/swinglab/swing/[id]`, skipping `/cage/summary`). Marked as stale; deletion deferred until verification confirms no entry point reaches it.

## Verification protocol (post-BV)

Per [docs/cage-telemetry-map.md](cage-telemetry-map.md) Recipe 3:

```bash
adb logcat | grep -E "\[path3:cage:(zustand-session-end|summary-phase-k-)"
```

These markers should NEVER fire post-BV. If they do, an entry point still reaches the legacy session.tsx end-path or routes to /cage/summary unintentionally.

Also expected:

```bash
adb logcat | grep "\[path3:cage:route-session-"
```

Should fire when reaching cage via the routed entry (Caddie Tools, SwingLab Setup card). Should NOT fire when reaching cage via inline (SwingLab Cage Mode card) — both paths render the overlay, but only the routed path passes through this wrapper.

## Follow-up phase candidates

- **BV-followup A** — Per-shot tagging in overlay, post-BW. Surface feel/shape buttons IN the overlay during recording (not on a separate screen). User taps after each detected swing. Tags persist on the per-clip CageShot. Live-coach uses the tags.
- **BV-followup B** — Live Kevin coach commentary in overlay, post-BW. Triggered every 3–5 detected swings; reads from per-shot Phase K results.
- **BV-followup C** — Watch tempo integration in overlay. Surface tempo metrics in the recording UI; tempo-aware coaching lines.
- **BV-followup D** — Delete `app/cage/summary.tsx` once verified that no entry point reaches it. (Cage history → individual session → /swinglab/swing/[id], not summary.)

These are scoped here, not built. They wait until BW ships per-clip extraction so they have data to operate on.
