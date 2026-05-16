# Phase 406 Audit: Landscape + split-screen layout state

**Audit Date:** 2026-05-16
**Scope:** orientation locks, responsive breakpoints, per-surface
landscape readiness, Galaxy Z Fold open + tablet support.

---

## Current state of orientation

| Site | Locks portrait? | Anchor |
|------|----------------|--------|
| `app.json` | NO — `orientation: 'default'` | line 6 |
| `app/(tabs)/caddie.tsx` | YES — `ScreenOrientation.lockAsync(PORTRAIT_UP)` on tab focus | line 497 |
| `app/onboarding/_layout.tsx` | YES — same lock | line 7 |
| `components/CageSessionOverlay.tsx` | YES — same lock | line 131 |
| All other surfaces | NO explicit lock (inherit app.json default) | n/a |

**The manifest already allows landscape app-wide.** Three surfaces
opt-out at runtime: Caddie home, onboarding, cage session. Everything
else (SmartFinder, SmartVision, SwingLab, Settings, Recap, etc.) is
*already* landscape-capable at the OS level — but the layouts inside
them are mostly portrait-assumed.

## Per-surface landscape readiness

| Surface | Locked? | Aspect-aware? | Landscape verdict |
|---------|---------|---------------|-------------------|
| **Caddie home** | YES | `useWindowDimensions` at line 126 but layout single-column | NEEDS SPLIT-SCREEN |
| **Round flow (caddie tab)** | YES | same as above | NEEDS SPLIT-SCREEN |
| **SmartVision** | NO | `isFoldOpen` check at `smartvision.tsx:99` for Fold-open detection | PARTIAL — first split-screen target |
| **SmartFinder** | NO | `useWindowDimensions` at `smartfinder.tsx:63` | NEEDS LANDSCAPE |
| **Cage session** | YES | `isFoldOpen` check at `CageSessionOverlay.tsx:94` (responsive padding) | KEEP PORTRAIT (camera mechanics) |
| **SwingLab tab** | NO | none — flat 6-card launcher reads fine wide too | LANDSCAPE OK as-is |
| **Settings** | NO | none | LANDSCAPE OK as-is (single column letterboxes naturally) |
| **Course Detail** | NO | `screenW` width hook | LANDSCAPE OK (already responsive to width) |
| **Swing detail (review screen)** | NO | `isFoldOpen` at `[swing_id].tsx:99` for caption layout | LANDSCAPE OK |
| **PostSessionReview / per-swing card** | NO | inherits swing detail | LANDSCAPE OK |
| **Recap** | NO | none | NEEDS LANDSCAPE attention later |

## Aspect-ratio breakpoint convention (proposed)

Per Phase 406 brief:

| Aspect (width/height) | Class | Layout strategy |
|-----------------------|-------|-----------------|
| < 1.0 | `portrait` | current portrait layouts |
| 1.0 - 1.4 | `near-square` | Fold partial-open + portrait tablet; adjusted portrait with breathing room |
| > 1.4 | `landscape` | full split-screen (Fold-open inner, phone rotated, tablet) |

Centralizing this in a hook `hooks/useDeviceLayout.ts` lets every
landscape-capable surface read the same breakpoints — no per-screen
recomputation, easy to retune globally.

## STATE OF LAYOUT

**Most surfaces are landscape-capable at the OS level today; the
three locked surfaces are the ones that need real layout work to opt
back in. SmartVision already has Fold-open detection and is the
cleanest first split-screen target. Caddie home + round flow are the
highest-value but biggest surface area (2900+ line file). Cage session
should stay portrait because camera mechanics assume it.**

## What ships in Phase 406 wave 1

1. `hooks/useDeviceLayout.ts` — shared breakpoint hook returning
   `{ width, height, aspect, orientation: 'portrait' | 'near-square' | 'landscape', isLandscape, isFoldOpen }`.
   Source of truth so future surfaces can opt into landscape with one
   import.

2. **SmartVision split-screen** — when `useDeviceLayout()` returns
   `landscape`, the hole image renders in a 65% left column and the
   F/M/B yardage panel + hole switcher + measure label move to a 35%
   right column. Portrait keeps the existing top-stack-bottom layout
   exactly unchanged.

3. Update `audit-406-layout-state.md` with the shipped scope.

## Deferred to Phase 406 wave 2+

- **Caddie home + round flow split-screen** — biggest impact but
  highest risk of regression. Needs a dedicated session: read all
  conditional render branches in caddie.tsx (2900+ lines), draft the
  split-screen design (avatar + caddie left, data strip + tools
  right), test on Fold open AND closed AND rotated.
- **SmartFinder landscape layout** — camera-AR mode needs the camera
  preview wide; map mode benefits from a side panel. Schedule its own
  layout pass.
- **Cage session landscape** — only if Tank/camera workflow justifies
  it; default stays portrait per the brief.
- **Recap landscape** — score grid widens cleanly; small effort.
- **Empirical Z Fold open verification** — once at least Caddie + Round
  flow lands.

What this phase does NOT include (per brief): tablet-specific
redesigns, multi-window mode, picture-in-picture, external display
support. The split-screen pattern applies uniformly to any landscape
canvas (Fold open, phone rotated, tablet) — no device-class
specialization.
