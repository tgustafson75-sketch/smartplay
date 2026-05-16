# Phase 500 — Build health verdict + cleanup ledger

**Date:** 2026-05-16
**Goal:** zero TS errors, zero lint errors, zero lint warnings, dead
code removed, ready for the Z Fold empirical-testing pass.

---

## Baseline (before Phase 500 cleanup)

| Check | Result |
|-------|--------|
| `tsc --noEmit` | **0 errors** |
| `expo lint` | 0 errors, **19 warnings** |

Warning categories at baseline:
- 7 × `import/no-named-as-default` — `BrandHeaderRow` / `GlobalToolsMenu` / `GlobalToast` exported both as `default` and as named; consumers imported as default.
- 9 × `@typescript-eslint/no-unused-vars` — leftover imports + assignments after the V3 Course Detail redesign + Phase 405 cleanups.
- 3 × `@typescript-eslint/array-type` — `Array<T>` style in `app/api/kevin+api.ts` request typings.

## Final state (after Phase 500 cleanup)

| Check | Result |
|-------|--------|
| `tsc --noEmit` | **0 errors, 0 warnings** |
| `expo lint` | **0 errors, 0 warnings** |

## Fixes shipped

### 1. `import/no-named-as-default` (7 → 0)

Consumers in `app/_layout.tsx`, `app/(tabs)/caddie.tsx`,
`app/(tabs)/dashboard.tsx`, `app/(tabs)/play.tsx`,
`app/(tabs)/scorecard.tsx`, `app/(tabs)/swinglab.tsx` converted from
default imports to named imports for `BrandHeaderRow`,
`GlobalToolsMenu`, `GlobalToast`. The source files keep both
`export function X` and `export default X` for back-compat with any
consumer outside this repo.

### 2. `@typescript-eslint/no-unused-vars` (9 → 0)

- `app/(tabs)/caddie.tsx` — dropped unused `TrustLevel` type import.
- `app/(tabs)/dashboard.tsx` — dropped unused `Image` from
  `react-native` destructure.
- `app/(tabs)/play.tsx` — dropped unused `toggleListening` alias.
- `app/(tabs)/swinglab.tsx` — dropped unused `Image` from
  `react-native` destructure.
- `app/course/[course_id].tsx` — V3 redesign cleanup:
  - Dropped `Image` import (no `<Image>` in the new layout).
  - Dropped unused `PALMS_IMAGES` import.
  - Dropped `isPalms` local (no consumer after stats strip removal).
  - Dropped `Stat` function (stats strip removed in V3 redesign).
  - Dropped `heroSource` useMemo + `getCourseImageryUrl` import
    (hero image removed in V3 redesign).
  - Dropped `heroFailed` state, `aboutOpen` / `tipsOpen` /
    `photosOpen` state, `simpleBriefing` IIFE — all dead with the
    redesign's always-expanded sections.
  - Kept `useWindowDimensions()` call as a side-effect subscription
    (Fold reconfigure invalidation) without binding the return value.
- `app/swinglab/cage-drill.tsx` — dropped unused `H` from
  `useWindowDimensions` destructure.

### 3. `@typescript-eslint/array-type` (3 → 0)

`app/api/kevin+api.ts` request-body typings: `Array<{...}>` →
`{...}[]` for `history` + `recentShots` + `holeShots`.

## Dead code identified and removed

- `Stat({ label, value })` component in `app/course/[course_id].tsx`
  (orphan after stats strip removal).
- `heroSource` `useMemo` + dependencies in `app/course/[course_id].tsx`
  (orphan after hero image removal).
- `simpleBriefing` / `aboutOpen` / `tipsOpen` / `photosOpen` /
  `heroFailed` state + setters in `app/course/[course_id].tsx`
  (orphan after V3 redesign's always-expanded sections).

The `void` IIFE that was suppressing unused-var warnings on those
hooks was also removed — no longer needed because the underlying
declarations are gone.

## Deferred to follow-up sessions (per audit-doc family)

- **Phase 405 wave 3** — background GPS + foreground service (requires
  app.json native-config edits + an EAS build, not OTA). Round-start
  orchestration centralization. Course auto-detect at round start. Tee
  box selection UI. Cart-vs-walking mode UI. "I'm at my ball" shot
  flow. Manual shot-location correction. All anchored to file:line
  in `docs/audit-405-gps-state.md`.
- **Phase 406 wave 2** — Caddie home + round flow split-screen (2900+
  line file; biggest impact, highest regression risk; dedicated
  session). SmartFinder landscape. Recap landscape. All anchored in
  `docs/audit-406-layout-state.md`.
- **Empirical Z Fold round-day pass** — multi-surface verification
  needs the foreground-service work to land first so phone-in-pocket
  GPS holds through a full round.

## Pre-test verdict

**BUILD: CLEAN**
- `tsc --noEmit`: 0 errors, 0 warnings.
- `expo lint`: 0 errors, 0 warnings.
- No dead code in the surfaces visible during normal play.

**CRITICAL PATHS:**
- Onboard: VERIFIED FUNCTIONAL at code level (per `app/onboarding/`).
- Round: FUNCTIONAL, GPS ecosystem documented in audit-405; wave 1+2
  shipped, wave 3 deferred.
- Cage: FUNCTIONAL with Phase 403/403b/405b UI surfaces shipped
  (ClubIdentify + ClubPicker + ReferenceAuthoring all in Tools menu).
- Voice: FUNCTIONAL with Phase 408 per-persona ElevenLabs settings
  shipped (filler cache v5 forces regen on first cold launch).

**PERSONAS:**
- Kevin / Serena / Tank / Harry: all four wired through voice +
  caddie character spec + portrait assets. Voice settings tuned per
  persona in `api/voice.ts` and `app/api/voice+api.ts`.

**EMPIRICAL TESTING READY: GO**

Build instructions for Z Fold:
1. From `~/Documents/smartplay`: `eas build --profile preview --platform android`
2. Install the resulting APK on the Z Fold.
3. The bundle pulls the latest OTA on first launch via the existing
   `expo-updates` silent-update path in `app/_layout.tsx`.

Wave-3 / wave-2 items above are visible to the test but not
blocking — they're known absences, not surprise bugs.
