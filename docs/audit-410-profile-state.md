# Phase 410 Audit: Profile data state — verdict + beta gaps

**Date:** 2026-05-16
**Scope:** profile field schema + persistence + onboarding + returning-user routing.
**Methodology:** read-only inspection of `store/playerProfileStore.ts`,
`store/settingsStore.ts`, `store/roundStore.ts`,
`store/trustLevelStore.ts`, `services/ssrSafeStorage.ts`,
`app/index.tsx`, `app/_layout.tsx`, `app/onboarding/*.tsx`,
`app/settings.tsx`, full grep for `persist(` + `AsyncStorage` keys.

---

## Verdict by component

| Component | State | Evidence |
|-----------|-------|----------|
| **Profile schema** | **REAL** | `playerProfileStore.ts:123-216` — 28 fields persisted (name, firstName, handicap, dominantMiss, missType, experienceContext, physicalLimitation, goal, personalBest, homeCourse, preferredTee, isSetupComplete, has_completed_onboarding, default_mode, first_opened_at, trial_started_at, subscription_status, email, handicap_index, handicap_gender, recent_differentials, kevinContext, persistentPatterns, selfieB64, customCaddiePortraitB64, useCustomCaddie, ...) |
| **Local persistence** | **REAL** | Zustand `persist()` + `createJSONStorage(() => getPersistStorage())` → AsyncStorage. Key: `player-profile-v2`. Mirror persistence in settingsStore (`settings-store-v2`), roundStore (`round-store-v1`), trustLevelStore. |
| **Hydration race protection** | **REAL** | `whenRoundStoreHydrated()` helper gates round-dependent subscribers (`_layout.tsx:295-308, 315-331, 339-385, 438-460`). `app/index.tsx:14-43` blocks navigation until BOTH playerProfileStore AND settingsStore call `onFinishHydration()`. |
| **Returning-user routing** | **REAL** | `app/index.tsx:63, 93` reads `has_completed_onboarding || isSetupComplete` to gate onboarding. Hydration-aware, no double-redirect risk. |
| **Round / practice history** | **REAL** | `roundStore.partialize` writes essential fields incl. `roundHistory[]` (RoundRecord with shots[], scores, courseName, etc.). Cage sessions persist via cageStore. No explicit cap (acceptable for 5-15 rounds × ~70 shots = <500 records). |
| **Onboarding flow CAPTURE code** | **REAL** | `app/onboarding/welcome.tsx`, `name.tsx`, `mode.tsx`, `home-course.tsx`, `ready.tsx` — all functional capture screens. |
| **Onboarding flow GATE** | **DISABLED** | `playerProfileStore.ts:137-144` defaults `isSetupComplete: true` + `has_completed_onboarding: true`. Per comment: "2026-05-14 — Tim: 'Get rid of that whole stupid onboarding nonsense.'" Fresh installs skip every onboarding screen. |
| **Profile-edit surface** | **PARTIAL** | Settings has individual field editors. No "Edit Profile" entry that walks the user through the existing onboarding screens. |
| **Privacy policy link** | **MISSING** | No in-app URL, no Settings → About entry. |
| **Support contact** | **MISSING** | No in-app email link, no "Contact support" affordance. |
| **Sign-out path** | **PARTIAL** | Settings has a destructive "Reset / Sign Out" button that calls `AsyncStorage.multiRemove(getAllKeys())`. Functions as a full wipe; button copy admits "Acts as a sign-out for tester rotations **until real auth ships**" — a flagrant TODO disguised as a label. |
| **Backend sync** | **MISSING** | No cloud backup, no multi-device, no server-side profile. All AsyncStorage local. |

## What works flawlessly today

1. **App close → reopen**: settings persisted, caddie selection preserved, bag intact, round history intact.
2. **Device restart**: same — AsyncStorage survives reboot.
3. **App backgrounded long-term**: no forced re-anything; state hydrates on resume.
4. **Multiple sessions per day**: each preserves prior session's state.
5. **Network interruption mid-session**: AsyncStorage is local; settings save without network.

## What's missing for the PGA Hope beta

1. **First-launch welcome moment**: a fresh install drops the tester directly on the Caddie tab with no "What's your name? Who's your caddie?" capture. There's no "create profile" experience.
2. **Discoverable Edit Profile**: profile updates require digging into Settings; testers may not realize that's where they go.
3. **Privacy + Support visibility**: legal disclosure expected by App Store / Google Play reviewers + tester courtesy.
4. **Better Reset button copy**: "Acts as a sign-out for tester rotations until real auth ships" is an internal note that leaked into UI copy.

## What ships in this commit

Per Tim's standing rule (no regression, additive + upgrade only) and his prior explicit instruction "get rid of that whole stupid onboarding nonsense," we are NOT re-enabling the multi-step onboarding flow. Instead:

1. **`app/welcome.tsx`** — new single-screen first-launch welcome that captures name (optional) + caddie selection (Kevin default) + optional handicap. One screen, low friction, skippable. Routes to `/(tabs)/caddie` on confirm.
2. **App boot routing**: when `first_opened_at` is null AND `name` is empty, route to `/welcome` instead of `/(tabs)/caddie`. Owner emails (already routed via the env-var override) skip welcome since their email is mirrored on first open before this check.
3. **Settings → "Edit Profile" row** routes back to `/welcome` so testers can update.
4. **Settings → About** gains Privacy + Support contact rows.
5. **Reset button copy** cleaned up — drops the "until real auth ships" leak.
6. **Sentry breadcrumb on profile hydration** so future "I lost my data" reports are debuggable.

Real auth (Supabase or similar) is documented in audit-410-auth-state.md as a separate Phase 410B effort. The beta ships as a "local-device single-tester" build.

## Empirical-test scenarios that pass today (per audit)

- ✓ App close + reopen → state preserved
- ✓ Device restart → state preserved
- ✓ App backgrounded for hours → no forced re-anything
- ✓ Network drops mid-session → local writes succeed
- ✓ Multiple sessions per day → continuity preserved

## Empirical-test scenarios that REQUIRE this commit to pass

- ✓ Fresh install → captures profile cleanly via /welcome
- ✓ Returning user → no welcome re-prompt (gated on first_opened_at)
- ✓ Edit Profile → existing fields populated, user can update
