# Audit 501 — Dead-Code Sweep (post-Phase 500, `3a5714a..HEAD`)

**Scope.** 14 commits since Phase 500 (`d9e9ff3` → `4814a18`). Verifies that
Phase 405 wave 3/4, Phase 406 wave 2, Phase 409 (TightLie integration),
Phase 410 (profile + auth), Phase 411 (Quick Start + bg-task hot fix), and
the Sunnyvale bundle did not leave orphan code behind.

**Method.** For every new/touched export, grep the entire `*.ts`/`*.tsx`
tree for consumers. Cross-checked side-effect imports, router wiring,
intent registration, and route reachability from `app/index.tsx`,
`app/welcome.tsx`, and `app/settings.tsx`.

---

## 1. Unused exports found

| File:line | Symbol | Verdict |
|---|---|---|
| — | — | None. Every new export added since Phase 500 has at least one runtime consumer. |

Spot-checks:

- [`services/backgroundLocationTask.ts:36`](../services/backgroundLocationTask.ts#L36) `BACKGROUND_LOCATION_TASK` — consumed internally + drives `Location.hasStartedLocationUpdatesAsync` calls. No external consumers, but it has to stay exported because the constant is the public task identifier and the test surface assumes it can be referenced.
- [`services/backgroundLocationTask.ts:106`](../services/backgroundLocationTask.ts#L106) `startBackgroundLocation` — consumed via lazy `await import('./backgroundLocationTask')` at [`services/gpsManager.ts:383`](../services/gpsManager.ts#L383).
- [`services/backgroundLocationTask.ts:143`](../services/backgroundLocationTask.ts#L143) `stopBackgroundLocation` — consumed at [`services/gpsManager.ts:418`](../services/gpsManager.ts#L418).
- [`services/intents/atBallHandler.ts:40`](../services/intents/atBallHandler.ts#L40) `atBallHandler` — registered at [`services/intents/index.ts:34`](../services/intents/index.ts#L34); the router itself is exercised by `hooks/useVoiceCaddie.ts`, `services/listeningSession.ts`, `app/voice-debug.tsx`, `app/onboarding/meet-kevin.tsx`, `components/KevinHelpButton.tsx`, `components/WhatCanISayChip.tsx`.
- [`services/movementModeDetector.ts:41`](../services/movementModeDetector.ts#L41) `useMovementModeStore` — consumed by [`components/CaddieDataStrip.tsx:13`](../components/CaddieDataStrip.tsx#L13) and [`components/dev/GpsQualityOverlay.tsx:26`](../components/dev/GpsQualityOverlay.tsx#L26).
- [`services/movementModeDetector.ts:85`](../services/movementModeDetector.ts#L85) `startMovementModeDetector` / `stopMovementModeDetector` — wired in `app/_layout.tsx` at the round-active lifecycle hook (lines 368, 376, 380, 389).
- [`store/playerProfileStore.ts`](../store/playerProfileStore.ts) — every Phase 410 field consumed:
  - `firstName` — `dashboard.tsx`, `caddie.tsx`, `hole-view.tsx`, `useKevin`, `useVoiceCaddie`, `briefing.tsx`, plus all kevin/brain/preround API handlers.
  - `setName` — [`app/welcome.tsx:64`](../app/welcome.tsx#L64), `app/intro.tsx`.
  - `setHandicap` — [`app/welcome.tsx:65`](../app/welcome.tsx#L65), `app/onboarding/about-game.tsx`.
  - `first_opened_at` — `_layout.tsx` (trial lifecycle), `index.tsx` (welcome-gate), `welcome.tsx` (stamp), `subscription-debug.tsx`.
  - `has_completed_onboarding` — `app/index.tsx:46` (route-gate). See deprecated-patterns note below.
- [`store/roundStore.ts`](../store/roundStore.ts) — all Phase 405/409 additions consumed:
  - `TeeColor` (L38), `selectedTee` (L192), `setSelectedTee` (L237) — `app/(tabs)/play.tsx:184-185`, `GpsQualityOverlay.tsx:43`.
  - `pendingLieAnalysis` (L201), `setPendingLieAnalysis` (L240), `clearPendingLieAnalysis` (L241) — `app/lie-analysis.tsx:264`, `hooks/useKevin.ts:141`.
  - `ShotResult.lie_analysis` (L113) — written at L734, persisted in shots, consumed downstream via recap and kevin context.
  - `closeHoleEndLocation` (L301) — `app/_layout.tsx:422`, `services/intents/atBallHandler.ts:99`, `services/shotLocationService.ts:113`.
- [`data/localCourseImages.ts`](../data/localCourseImages.ts) — all six hole-image exports (`LAKES`, `RANCHO_CALIFORNIA`, `CRYSTAL_SPRINGS`, `MARINERS_POINT`, `SAN_JOSE_MUNI`, `SUNNYVALE`) consumed at `app/(tabs)/play.tsx:36-41` for course thumbnails AND from the same module's internal `getLocalHoleImage` lookup table.

---

## 2. Files that may be entirely orphaned

| File | Verdict |
|---|---|
| — | None. Every new file in the 14-commit window has at least one import. |

Considered:

- [`app/welcome.tsx`](../app/welcome.tsx) — reached from [`app/index.tsx:111`](../app/index.tsx#L111) (fresh-install gate) AND [`app/settings.tsx:749`](../app/settings.tsx#L749) ("Edit Profile" row).
- [`app/quick-start.tsx`](../app/quick-start.tsx) — reached from [`app/welcome.tsx:183`](../app/welcome.tsx#L183) ("Quick Start guide" CTA) AND [`app/settings.tsx:768`](../app/settings.tsx#L768) (Help row).
- `services/intents/atBallHandler.ts`, `services/movementModeDetector.ts`, `services/backgroundLocationTask.ts` — wired as documented in section 1.
- 18 × `assets/courses/sunnyvale/hole-NN.jpg` — bundled via `require()` in [`data/localCourseImages.ts:135-156`](../data/localCourseImages.ts#L135).

---

## 3. Deprecated patterns

1. **Side-effect import of `backgroundLocationTask` (FIXED).** The hot-fix
   commit `faff1d9` removed `import '../services/backgroundLocationTask';`
   from `app/_layout.tsx`. Confirmed no other file side-effect-imports it
   — only [`services/gpsManager.ts:383, 418`](../services/gpsManager.ts#L383)
   does lazy `await import()` inside the start/stop functions, which is
   the intended pattern. **No action.**

2. **TightLie stubs.** Searched for `is_stub`, mock lie-analysis responses,
   and stubbed lie code paths. The only `stubbed` matches in the tree are
   in `services/acousticBallSpeed.ts` (intentionally stubbed, unrelated to
   TightLie) and `services/relationshipEngine.ts` (also intentional). Phase
   409 left no TightLie stub residue. **No action.**

3. **Legacy onboarding screens (pre-existing, outside scope).**
   `playerProfileStore` defaults `has_completed_onboarding: true` and
   `isSetupComplete: true` (lines 143-144), so `app/index.tsx:93`'s
   `<Redirect href="/onboarding/welcome" />` is dead under normal install.
   The screens (`app/onboarding/*`) still mutually link via `router.push`,
   but no `app/settings.tsx` row enters that flow — they're reachable only
   by deep-link / direct URL. **Out of scope for this audit (pre-Phase
   500), but worth flagging:** if Tim wants to actually delete them, the
   safe next step is removing the unreachable `/onboarding/welcome`
   redirect from `index.tsx` first and deleting `app/onboarding/*` in a
   later phase. **Suggested action:** track as a future cleanup, do not
   touch before the beta tester drop.

4. **`completeOnboarding` / `completeSetup` actions.** Both still
   called from `app/onboarding/ready.tsx` and `app/intro.tsx` — the intro
   flow is still reachable (first-launch intro video → permissions →
   onboarding), so these are not orphaned. **No action.**

---

## 4. Verdict

**Clean.** Today's 14 commits landed without leaving orphan code behind.
Every new export has a runtime consumer, every new file is reached by at
least one route or import, and the backgroundLocationTask hot-fix
correctly removed the only side-effect import that referenced it. The
Phase 410 profile fields (`first_opened_at`, `firstName`, `setName`,
`setHandicap`) are all consumed by `welcome.tsx`, kevin/brain APIs, and
the dashboard. The Phase 409 TightLie additions (`pendingLieAnalysis`,
`lie_analysis` on `ShotResult`) thread cleanly from `lie-analysis.tsx`
into `useKevin` and `kevin+api.ts` without leaving stub paths behind. The
Sunnyvale bundle is reachable via the `play.tsx` thumbnail roster.

**Beta tester readiness implication:** zero dead-code regression added
this morning. The only standing artifact is the pre-existing unreachable
`app/onboarding/*` tree, which is documented in section 3 as out-of-scope
and should NOT be touched before the tester drop — the screens are inert,
not broken.
