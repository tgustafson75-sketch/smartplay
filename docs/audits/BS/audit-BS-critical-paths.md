# Phase BS — Critical Paths Status

**Date:** 2026-05-04
**Companion to:** [docs/critical-paths.md](../../critical-paths.md), [docs/audit-AX-empirical.md](../../audit-AX-empirical.md)

---

## Headline

**All four critical paths are EMPIRICALLY UNVERIFIED.** This was true at session start (per `docs/critical-paths.md:233-236` "_not verified_" entries) and remains true at session end. Today's session did not move any path from unverified → verified because no on-device testing happened.

---

## Path 1 — ONBOARD (`[path1:onboard]`)

**Definition:** Cold install → onboarding → Caddie home with profile populated.

**Code state:**
- Onboarding multi-step flow shipped pre-session (`app/onboarding/_layout.tsx` + 7 screens). No onboarding code changed today.
- `app/intro.tsx` legacy single-file flow still co-exists with `app/onboarding/` — routing precedence unverified (BI URGENT-H1 finding).
- No Phase BR/BL/BN/U1/U2 work touches onboarding.

**Verification gap:** all AX-1 through AX-12 scenarios remain `PENDING EMPIRICAL`.

**Status: NOT VERIFIED. No change from session start.**

---

## Path 2 — ROUND (`[path2:round]`)

**Definition:** Open app → find course → start round → log shots → end round → recap on scorecard.

**Code state at session end (changes since session start):**
- BR Component 9: recap now references active practice context (`api/recap.ts`, `services/recapGenerator.ts`, `app/(tabs)/caddie.tsx`). When no tutorials are active, behavior unchanged from pre-session.
- BL: `currentClub` and `clubSegments` added to cageStore — these affect cage flow, not round flow.
- No round-flow code path changed for users without active tutorials.

**Verification gap:** all of AX-79 through AX-100 (round flow scenarios) remain `PENDING EMPIRICAL`. The BI gap analysis URGENT-1 (pose-detection timeout/fallback) is now addressed via U1 — but U1 affects cage upload, not round flow.

**Status: NOT VERIFIED. Round-flow risk profile unchanged from session start.**

---

## Path 3 — CAGE (`[path3:cage]`)

**Definition:** SwingLab → Cage Mode setup → record → analysis → drill.

**Code state at session end:**
- **BL: substantial.** New "ID club" photo capture button, voice intents, manual picker modal, per-club session segmentation, settings toggle. Whole new sub-flow on top of existing cage session.
- **U1: substantial.** `analyzeSwingTentative` heuristic-fallback path added; runPhaseKOnSession's zero-results branch now fires the fallback instead of immediate failure. 30s→15s primary timeout.
- **BQ: instrumentation.** `[upload:*]` markers light up the entire pipeline from picker through UI render.

These changes increase the surface area of the cage flow significantly but stay additive — existing happy-path stays the same.

**Verification gap:** AX-101 through AX-118 + the BL-specific scenarios from `docs/club-recognition-architecture.md` "Empirical verification" all `PENDING EMPIRICAL`. Specifically:
- Does Sonnet vision actually read club soles reliably?
- Does the heuristic-fallback fire on the actual failure mode Tim sees?
- Does per-club segmentation render correctly?

**Status: NOT VERIFIED. Significant new code surface; empirical verification is high priority for next testing pass.**

---

## Path 4 — VOICE (`[path4:voice]`)

**Definition:** Earbud / on-screen tap → Kevin engages → query → response → continuation/close.

**Code state at session end:**
- **BR caddie context injection: substantial.** All 3 Kevin client call sites (`services/listeningSession.ts`, `hooks/useVoiceCaddie.ts`, `hooks/useKevin.ts`) now pass `practice_context` to `/api/kevin`. Server-side prompt injection adds a "PLAYER PRACTICE CONTEXT" block when active tutorials exist.
- **BL voice intents:** new `club_change` / `club_query` / `club_menu` intents in the voice classifier prompt + handler registry.
- When no tutorials are active and no club intents fire, voice flow behavior is **unchanged** from pre-session.

**Verification gap:** AX-55 through AX-78 (voice scenarios) remain `PENDING EMPIRICAL`. Specifically untested:
- Does the practice_context block change Kevin's responses on relevant clubs?
- Do the new club voice intents route correctly during a cage session?
- Does the conversation feel different (better? worse?) with practice context injected?

**Status: NOT VERIFIED. New voice paths added (club intents); existing paths unchanged for users without active tutorials.**

---

## Cross-cutting empirical risks

The four paths share these failure-mode risks that today's session did **not** address (because they're empirical-only or out of scope):

1. **Earbud tap reliability on Galaxy Buds** — Phase AC's honest-disable still in effect; no native module work today. On-screen tap remains the working fallback.
2. **GPS fix at hole transitions** — no GPS code changed today; risk profile unchanged.
3. **TTS audio routing during rapid listen↔speak transitions** — no `voiceService.ts` audioModeQueue changes today.
4. **EAS dev-client build freshness** — Tim's Z Fold currently has whatever build was last installed. Anything shipped today requires a fresh build OR a Metro tunnel reload (latter works only if no native modules added — confirmed for today's set).

---

## Beta-readiness verdict (per critical-paths.md gate)

The gating rule from `docs/critical-paths.md:228-230`:

> **External beta requires:** all four critical paths verified end-to-end on a real device within the last 7 days, on a real round (not just simulated). Until that's true: internal personal beta only. No external testers.

**Today's session output: 0 of 4 paths verified.**

External beta remains gated. Internal beta also gated until at least Path 2 verifies on Z Fold.

---

## What flips Paths 2, 3, 4 to VERIFIED

| Path | Action | Time |
|---|---|---|
| Path 2 ROUND | Real round on home course on Z Fold; capture `[path2:round]` markers; confirm Mark refreshes SmartFinder + SmartVision | ~15 min on course |
| Path 3 CAGE | Cage session with mixed clubs (BL test) + intentional bad-lighting / bad-angle swing video to force U1 heuristic-fallback path | ~20 min |
| Path 4 VOICE | Activate a tutorial → start round → ask Kevin a question on the practiced club → confirm response references the practice cue + recap cites it post-round | ~20 min during round |

Total Z Fold testing budget to flip 3 of 4 paths: **~1 hour focused on-device** (after commit + push + EAS build pulls today's changes).

Path 1 (Onboard) requires fresh-install / wipe-app-data, ~10 minutes additional. Often deferred until external beta enrollment.
