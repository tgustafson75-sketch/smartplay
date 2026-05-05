# Audit 111 — SwingLab Tab Current State

Phase 111 deliverable. Captures what's currently on the SwingLab tab, what's being kept, what's being removed, and what replaces it.

## Current state (as of pre-Phase-111 commit)

`app/(tabs)/swinglab.tsx` — 1020 lines. The tab renders, top to bottom:

1. **Header** — title + subtitle ("Drills, technique, and setup guides")
2. **KevinCoachBox** — Coach-mode contained-presence card (Phase I). Persona-aware. Dismissible per session at L2/L3/L4, hidden at L1.
3. **Practice Tools** — collapsible (default closed) card with 8 ToolRow entries:
   - Start Cage Session
   - Add Tutorial
   - Scan Your Space
   - Cage Drill
   - My Swing Library
   - Tutorials
   - Cage Mode
   - Arena
4. **Watch Banner** — conditional, shown only when `watchConnected`
5. **Drills** — collapsible (default closed) card with environment filter pills + DrillCard list
6. **Setup Guide** — two `<AddressSilhouette>` cards: "Full Swing" (face-on silhouette) + "Putting" (putting silhouette). Each has hint text + a "Watch Demo" button that opens a YouTube search.

## Phase 111 verdict per surface

| Surface | Verdict | Reason |
|---|---|---|
| Header | KEEP | Functional, identifies the tab |
| KevinCoachBox | KEEP | Real value — persona-aware Coach-mode introduction |
| Practice Tools | KEEP | High-utility navigation, well-organized |
| Watch Banner | KEEP | Status indicator, lightweight |
| Drills | KEEP | Core content — the drill library is the tab's main job |
| Setup Guide (silhouette cards) | **REPLACE** | The `AddressSilhouette` is the goofy-stick-figure problem Phase 111 calls out. The "Watch Demo" YouTube-search pattern produces unpredictable results (search-rank-of-the-day, no quality control). |

## Translucent overlay audit

Phase 111 prompt mentions "translucent overlay" evaluation. A grep across `*.ts` / `*.tsx` for `translucent` / `Translucent` returned **zero matches**. There is no element by that name in the codebase.

**Interpretation:** the term in Tim's prompt likely refers to one of:
1. The `AddressSilhouette` SVG component (which renders semi-transparent body shapes) — this matches the "goofy silhouette" framing and is being deprecated as part of Phase 111's Setup Guide replacement.
2. A modal-overlay pattern elsewhere in the app — no matches found, so not in scope.
3. A separate planned feature that was never implemented — nothing to do.

**Decision: DEPRECATE.** The AddressSilhouette component is removed from `swinglab.tsx` as part of Phase 111. The component file `components/AddressSilhouette.tsx` is left in the repo (not deleted) so any other consumer breaks loudly if discovered; Phase 111 cleanup pass can delete it after empirical verification.

## What replaces the Setup Guide

A **Primary Issue Cards** stack. Each card:
- Issue title (e.g. "Swing Path", "Weight Transfer")
- Clean SVG illustration (vector, professional-feel, NOT a goofy silhouette)
- Brief description (1–2 sentences)
- "Watch" button → opens a curated reputable-instructor YouTube link (specific URL, not a search)
- "Try drill" button when a related drill exists in the library

**Default first card: Swing Path.** Three-variant illustration showing inside-out / on-plane / outside-in paths.

**Personalization (Phase 111 / Component 7):** if the user has cage-session history with per-shot Phase K analysis, the most-frequently-detected issue rises to first position. New users without history see the static default order.

## Card content sources

- `constants/primaryIssueCatalog.ts` — the static catalog of fault categories with default order, illustration component, description, and instructor video keys.
- `constants/instructorVideos.ts` — fault-keyed map of curated YouTube URLs (primary + fallback per category), each marked `verified: false` for Tim's empirical verification before public ship.
- `services/primaryIssueRanker.ts` — reads `useCageStore.sessionHistory[].shots[].perShotAnalysis.detected_issue`, counts frequencies across the recent N sessions, and re-ranks the catalog so user-specific issues rise to top.

## Illustration approach

Phase 111 spec calls for "professional illustrations, NOT stick figures." Real options for production-quality art:
- Custom commissioned: ~$100–300 per illustration × 6 categories = $600–1800
- Generated and refined: variable cost
- Reputable-source diagrams with permission: free but legally specific

This Phase 111 implementation ships **clean SVG primitives** built inline as React Native SVG components. They're not commissioned art — they're geometric diagrams (lines, arcs, club path arrows) that read as instructional rather than goofy. The Swing Path card gets the most attention because it's the default first card; the others ship with cleaner-than-silhouette but less elaborate illustrations. Tim can swap any one for commissioned art later — the illustration slot is a typed component prop, easy to replace per category.

## Instructor video verification status

Phase 111 spec lists Mike Malaska, Sean Foley, Hank Haney, Pete Cowen, Mike Bender, Cameron Champ, Top 100 GolfDigest pros, LPGA Hall of Fame teachers as examples. The Phase 111 commit ships a starter curation in `constants/instructorVideos.ts` with **every entry marked `verified: false`**. Tim verifies each link works, is under 10 minutes, addresses the fault category, and the channel is still active before any external beta. The catalog includes a fallback URL per category in case the primary breaks.

## Empirical verification (Tim, on Galaxy Z Fold)

Per Phase 111 / Component 9:
- SwingLab tab opens cleanly with new card pattern
- Default first card is Swing Path with a clean illustration
- "Watch" button opens the YouTube URL (browser or YouTube app)
- Card sizing appropriate on phone aspect and Fold open
- Multiple cards display without overcrowding
- AddressSilhouette section is gone
- Personalization works if perShotAnalysis history exists

If Tim wants the AddressSilhouette section back temporarily, the component file is preserved — re-importing it into swinglab.tsx restores the prior layout.
