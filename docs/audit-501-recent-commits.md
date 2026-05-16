# Audit 501 — Recent Commits (Phase 500 baseline → HEAD)

**Scope:** 14 non-merge commits between `3a5714a` (Phase 500 baseline, lint-clean) and `4814a18` (HEAD as of 2026-05-16). Walk in chronological order. Pull commit message intent against actual diff, flag any technical debt added (TODO/FIXME markers, side-effect imports, dynamic require, try/catch swallows, deferred markers), and end with cross-cutting observations + a beta-tester-readiness verdict.

Range command of record: `git log --no-merges 3a5714a..HEAD --reverse`.

---

## 1. `d9e9ff3` — Phase 405 wave 3: round-start orchestration, tee selection, cart/walk mode, background-GPS native config

**Files touched:** 7 (`store/roundStore.ts`, `app/(tabs)/play.tsx`, `services/movementModeDetector.ts` [new], `components/CaddieDataStrip.tsx`, `app/_layout.tsx`, `app.json`, `services/gpsManager.ts`).

**Scope vs Phase 405 spec.** Commit message explicitly enumerates "Phase 405 audit's prioritized list except the items deferred for dedicated sessions." Three items deferred up front (course auto-detect, "at my ball" flow, manual shot correction) are listed in-message — i.e. self-flagged, not snuck. Native config (app.json) is correctly called out as build-not-OTA. **Within scope.**

**Debt incurred.**
- One genuine TODO added in `services/gpsManager.ts:startGpsManager`:
  `// Phase 405 wave 3 — TODO: wire Location.startLocationUpdatesAsync ...`
  Commit message acknowledges it explicitly ("TODO marker added in services/gpsManager.ts:startGpsManager pointing to the wire-up site"). This marker is **subsequently removed in `757572e`** (Phase 405 wave 4), so it lived ~hours in the tree.
- New service file `movementModeDetector.ts` is well-bounded — single responsibility, subscribes to gpsManager, no global side effects.
- `app/_layout.tsx` gains lifecycle wiring (movementModeDetector start/stop on isRoundActive transitions). Clean subscription pattern; no boot-time side effects added here.

**Verdict:** scoped, self-honest, one TODO added and later resolved.

---

## 2. `9ffcba9` — Phase 406 wave 2: SmartFinder graceful landscape

**Files touched:** 1 (`app/smartfinder.tsx`, +9/-1 lines).

**Scope.** Single-purpose: `maxWidth: 720` + `alignSelf: center` on the ScrollView contentContainer for non-camera SmartFinder modes. Camera/Putt modes intentionally exempt. **Within scope.** Commit message explicitly notes zero portrait risk (cap only fires >720dp).

**Debt incurred.** None. Tiny, surgical layout change.

---

## 3. `37e6c98` — Phase 405 wave 3 + 406 wave 2: course auto-detect banner, at-ball flow, Recap landscape

**Files touched:** 5 (`api/voice-intent.ts`, `app/(tabs)/play.tsx`, `app/recap/[round_id].tsx`, `services/intents/atBallHandler.ts` [new], `services/intents/index.ts`).

**Scope.** Knocks out three of the items the prior Phase 405 wave 3 commit explicitly deferred (course auto-detect banner, at-ball voice intent, Recap landscape). Same spec anchor; **within scope.** Commit message still lists the remaining deferred items (background-GPS task wiring, manual shot correction, SmartFinder landscape, caddie home split-screen) — honest carry-forward.

**Debt incurred.**
- `atBallHandler.ts` has an explicit "Honest behavior" enumeration in the commit body covering five failure modes (no active round, no GPS fix, no shot logged, already closed, success). This is a feature, not debt — denial paths are spelled out instead of stubbed.
- Recap landscape change is the same 720dp pattern as commit #2.

**Verdict:** clean delivery of deferred items.

---

## 4. `b928f28` — GPS dev overlay extended with Phase 405 wave 3 state

**Files touched:** 1 (`components/dev/GpsQualityOverlay.tsx`, +42/-3).

**Scope.** Diagnostic-only. Adds a second row to the existing dev overlay (already gated on `settingsStore.gpsQualityDebugOverlay`). Renders off-course state + movement mode + tee color + current hole. **Within scope** — pure read-only render of existing Zustand state.

**Debt incurred.** None. No behavior change, no new subscriptions, no new state.

---

## 5. `f085ad6` — Round start/end toasts

**Files touched:** 1 (`store/roundStore.ts`, +12).

**Scope.** Two Toast.show calls inside startRound/endRound for empirical-pass visibility. Commit message is one line, but the diff is 12 added lines doing exactly what the subject says. **Within scope.**

**Debt incurred.** None. Worth noting these are user-visible toasts — if Tim wants them gone post-empirical-pass they'll need a follow-up, but they're not debt as written.

---

## 6. `a797be9` — Session summary doc for Z Fold empirical pass reference

**Files touched:** 1 (`docs/session-summary-2026-05-16-night.md`, +150).

**Scope.** Pure documentation. **Within scope.**

**Debt incurred.** None — the doc itself flags that Phase 405 wave 4 is still deferred and references the TODO marker in gpsManager, which is appropriate disclosure.

---

## 7. `757572e` — Phase 405 wave 4: background-GPS code wiring (TaskManager + foreground service + dual-source ingest)

**Files touched:** 6 (`app/_layout.tsx`, `package.json`, `package-lock.json`, `services/backgroundLocationTask.ts` [new, 125 lines], `services/gpsManager.ts` [+155/-... refactor], `store/roundStore.ts`).

**Scope.** Closes the CRITICAL deferred item from Phase 405 audit. Commit explicitly removes the d9e9ff3 TODO marker (verified: `-  // Phase 405 wave 3 — TODO: wire Location.startLocationUpdatesAsync` appears in the diff). Adds the `expo-task-manager` dep (~14.0.9). Refactors `gpsManager.ts` to extract `processFix` as the shared foreground/background ingest path — net positive refactor (single source of truth). **Within scope.**

**Debt incurred — and this is the load-bearing one for the window.**
- `app/_layout.tsx` adds a **side-effect import** of `services/backgroundLocationTask` at boot so `TaskManager.defineTask` runs before any background delivery. The commit message even calls this pattern out by name ("Side-effect import 'services/backgroundLocationTask' so TaskManager.defineTask runs at app boot").
- The new `backgroundLocationTask.ts` runs `TaskManager.defineTask` at **module load time**. No try/catch wrap on the registration when this commit landed (later added in `fa0f4ed`, then restructured in `faff1d9`).
- **This combination is the direct cause of the `faff1d9` hot-fix.** The boot path now imports a module whose top-level evaluation can throw, with no isolation. Phase 411 added a try/catch; the hot-fix went further and removed the side-effect import entirely.

**Verdict:** scope was right, but the side-effect-import-at-boot pattern was the latent bug.

---

## 8. `e6bc92a` — Manual shot-location correction via Mark button (60s post-shot window)

**Files touched:** 1 (`app/_layout.tsx`, +27).

**Scope.** Reuses the existing Mark My Spot button as a manual shot-correction affordance within a 60s window of a logged shot. Commit message is explicit that this is **NOT** the full map-drag recap UI (deferred), but the lower-friction equivalent via existing UI. Honest framing. **Within scope.**

**Debt incurred.** None — but worth noting this is the second consecutive commit adding logic to `app/_layout.tsx`. That file is becoming the dumping ground for global lifecycle wiring. Not yet a problem; flagging for a future "extract a useRoundLifecycle hook" follow-up.

---

## 9. `f6551ac` — Phase 409: TightLie substantial integration (persistence + caddie brain)

**Files touched:** 5 (`app/api/kevin+api.ts`, `app/lie-analysis.tsx`, `docs/audit-409-tightlie-state.md`, `hooks/useKevin.ts`, `store/roundStore.ts`).

**Scope.** Adds `pendingLieAnalysis` state slot to roundStore, threads it through `logShot`, extends Kevin's system prompt with a CURRENT LIE block. Documented audit (`audit-409-tightlie-state.md`) anchors the work. **Within scope.**

**Debt incurred.**
- One try/catch added in `app/lie-analysis.tsx` around `setPendingLieAnalysis`. The commit message says: "Wraps in try/catch so a store-unavailable edge case doesn't break the dismissal flow." This is a defensive swallow, but it's local to a UI dismissal path (button tap to navigate back), not a critical correctness path. **Acceptable scope for a swallow** — the worst case is a missed lie persistence; the user can still dismiss the screen.
- `ShotResult` type gained `lie_analysis?: LieAnalysis | null`. Backward-compatible (optional) — old shots are explicitly handled per the inline comment "shots logged before Phase 409 shipped."

**Verdict:** clean, honest integration.

---

## 10. `ff2f8e7` — Phase 410: user profile storage + login audit and hardening for beta tester ready

**Files touched:** 8 (`app/_layout.tsx`, `app/index.tsx`, `app/settings.tsx`, `app/welcome.tsx` [new, 218 lines], 3 audit docs, `store/playerProfileStore.ts`).

**Scope.** Adds first-launch welcome screen, profile-edit route, privacy policy link, Sentry-breadcrumb-on-hydration, and cleans up the "until real auth ships" leak in the Reset App Data button copy. The commit is **explicit** that real auth is out of scope ("Ship in this commit (real auth deferred to Phase 410B — that's 3-5 focused sessions of Supabase setup + RLS + UI + sync)"). **Within scope, and the deferred chunk is properly anchored as Phase 410B with a size estimate.**

**Debt incurred.**
- `store/playerProfileStore.ts` adds a `dynamic require('@sentry/react-native')` inside `onRehydrateStorage` wrapped in `try { ... } catch { /* Sentry unavailable — non-fatal */ }`. This is a documented pattern (commit message: "Dynamic require avoids pulling Sentry at module-eval time before Sentry.init has wired the DSN"). Empty-catch swallow is bounded — Sentry is observability infra, missing breadcrumbs are recoverable.
- Net debt of this dynamic-require pattern: low. It's intentional avoidance of a worse pattern (module-eval-time Sentry pull).
- Welcome screen is 218 lines, single-file, no shared dependencies — easy to evolve when 410B replaces the local-only flow.

**Verdict:** beta-targeted hardening, deferred work clearly labeled and sized.

---

## 11. `fa0f4ed` — Phase 411: in-app Quick Start Guide + harden background-task module-load

**Files touched:** 5 (`app/_layout.tsx`, `app/quick-start.tsx` [new, 255 lines], `app/settings.tsx`, `app/welcome.tsx`, `services/backgroundLocationTask.ts`).

**Scope.** Two distinct concerns shipped together — both touch beta-tester first-launch. The Quick Start Guide is straightforward. The second piece "harden services/backgroundLocationTask.ts" wraps `TaskManager.isTaskDefined` + `TaskManager.defineTask` in try/catch so a module-load throw is logged and swallowed instead of crashing the render tree. This is a **direct preemptive response** to suspected boot fragility — and indeed the very next commit confirms the suspicion was correct. **Within scope** but combining two unrelated concerns in one commit is a minor process smell.

**Debt incurred.**
- The defensive try/catch around defineTask is a swallow (`'[bgLocation] defineTask threw at module load (non-fatal)'`). Justified because background GPS is optional and foreground GPS keeps working. **Acceptable swallow.**
- But — critically — the try/catch alone did NOT save the boot path, because the side-effect import in `app/_layout.tsx` was still present and module-evaluation of `backgroundLocationTask.ts` could throw **before** entering the try block (e.g. at the `import { TaskManager } from 'expo-task-manager'` resolution). Hence the need for `faff1d9`.

**Verdict:** good intent, incomplete fix.

---

## 12. `faff1d9` — HOT FIX: boot white-screen crash from backgroundLocationTask module-load side-effect

**Files touched:** 2 (`app/_layout.tsx`, `services/backgroundLocationTask.ts`).

**Scope.** Pure hot-fix targeting the white-screen on EAS build `b7675302`. **Within scope.** Two changes:
1. **Removes** the side-effect import `import '../services/backgroundLocationTask'` from `app/_layout.tsx` entirely.
2. Moves `TaskManager.defineTask` from module-load to a lazy `ensureTaskDefined()` function called inside `startBackgroundLocation()`. Uses **dynamic require** of `expo-task-manager` so any native-binding throw is caught locally.

**Debt incurred.**
- A dynamic `require('expo-task-manager')` was added. This is the second dynamic-require in the window (after `ff2f8e7`'s Sentry pattern). Both are justified — module-load isolation from native-binding flake — but the pattern is now established and worth watching.
- A documented tradeoff is called out in the commit message: "if the OS resurrects the app from a background task delivery while the JS bundle is unloaded, defineTask won't be registered and the delivery drops silently. For v1.1 beta this is acceptable — foreground GPS via watchPositionAsync remains the primary fix source." Self-flagged. Not hidden.
- The `taskDefined` module-level flag for idempotence is a small piece of module-level mutable state, but it's bounded to this file.

**Verdict:** the fix is the right shape and the tradeoff is documented. The fact that a hot-fix was needed at all is the debt entry, not the fix itself.

---

## 13. `78e0fb2` — Phase 411 followup: swap Quick Start content to canonical PDF version

**Files touched:** 1 (`app/quick-start.tsx`, +85/-43).

**Scope.** Renderer extension (`Card.named`, `Card.footer`) + content swap to match Tim's polished PDF verbatim. **Within scope.** Pure content + small renderer additions.

**Debt incurred.** None.

---

## 14. `4814a18` — Add Sunnyvale Golf Course: 18 bundled hole images for tomorrow's round

**Files touched:** 20 (1 code + 1 data + 18 JPGs). `app/(tabs)/play.tsx` +16, `data/localCourseImages.ts` +29/-1.

**Scope.** Course-content add following the San Jose Muni image-only pattern. No new code paths, no new dependencies. **Within scope.**

**Debt incurred.** None. The commit notes "No COURSES entry / yardage table needed — the Golfshot stills carry the yardages visually" — that's an honest tradeoff disclosure (Sunnyvale won't have programmatic yardages), not hidden debt.

---

## Cross-cutting observations

1. **One TODO marker added, one TODO marker removed.** `d9e9ff3` added the `// Phase 405 wave 3 — TODO: wire Location.startLocationUpdatesAsync` marker in `services/gpsManager.ts`. `757572e` (Phase 405 wave 4) explicitly removed it. Net TODO/FIXME/HACK count delta across the window: **0**. No "Phase 5XX" or "Phase 4XXB" markers left in source — Phase 410B and recap-map-drag are anchored in audit docs, not source comments.

2. **One side-effect import introduced, one removed.** `757572e` added `import '../services/backgroundLocationTask'` to `app/_layout.tsx`. `faff1d9` (hot fix, less than a day later) removed it. The whole class of "module-load side-effect that can throw" debt was identified, hot-fixed, and the lazy-init replacement pattern is now in the codebase as a model. **Standing rule:** future native-module side-effect imports at boot need to be flagged — this pattern cost a white-screen on a tester APK.

3. **Two dynamic `require()` calls added.** Both intentional and isolated:
   - `store/playerProfileStore.ts` — `require('@sentry/react-native')` inside try/catch on rehydrate, to avoid pulling Sentry before init.
   - `services/backgroundLocationTask.ts` — `require('expo-task-manager')` inside try/catch inside `ensureTaskDefined`, to isolate native-binding throws.
   Both are documented in commit messages with reasoning. Neither is a code smell on its own; together they establish "dynamic require for native-module isolation" as a pattern. Worth a CLAUDE.md note if it keeps recurring.

4. **Three try/catch swallows added.** All bounded to non-critical paths:
   - `app/lie-analysis.tsx` — store-unavailable on dismissal (`f6551ac`).
   - `store/playerProfileStore.ts` — Sentry-unavailable on hydrate (`ff2f8e7`).
   - `services/backgroundLocationTask.ts` — native-binding-throw on registration (`fa0f4ed` + `faff1d9`).
   None silently swallow business logic. All have explanatory comments. **Not a concern.**

5. **`app/_layout.tsx` is becoming a hub.** Touched by 6 of 14 commits: lifecycle wiring (d9e9ff3), background side-effect import (757572e, then removed in faff1d9), Mark-button correction handler (e6bc92a), welcome route (ff2f8e7), quick-start route (fa0f4ed), hot-fix (faff1d9). It hasn't crossed into "too big" yet, but two more lifecycle features and it should get split (e.g. `useRoundLifecycle` hook).

6. **Honest deferral discipline is strong across the window.** Every commit that defers something names what it's deferring and where the anchor lives (audit doc, Phase 410B label, etc.). `f6551ac` defers prompt-tuning to empirical pass. `ff2f8e7` defers real auth to Phase 410B with a 3-5 session estimate. `757572e` calls out the v1.1-acceptable tradeoff for cold-bundle background delivery. `4814a18` discloses the missing yardage table.

7. **One commit combined unrelated concerns.** `fa0f4ed` shipped Quick Start Guide AND defensive backgroundLocationTask hardening together. The hardening turned out to be the more important change but was buried under the more visible feature. Minor process note — future hardening commits warrant their own SHA for traceability.

8. **Zero regressions on the lint-clean Phase 500 baseline detected in commit messages.** No commit reports new lint warnings. The standing-rule TS-check requirement appears to have been respected (no commit acknowledges a TS error being suppressed or `@ts-ignore` added).

---

## Verdict

**Debt held steady to slightly shrank across the 14-commit window.** One TODO was added and removed inside the window. One side-effect-import-at-boot anti-pattern was introduced and removed inside the window. The dynamic-require + try/catch pattern that emerged is intentional native-module isolation, not laziness. Honest deferral is consistently anchored in audit docs rather than left as orphan source comments. The hot fix (`faff1d9`) is the one entry that would have blocked a tester send if it hadn't been caught — and it was caught, OTA'd, and a fresh EAS build kicked off behind it.

**Beta tester readiness:** the window finishes in a sendable state. The hot-fix is in, the Quick Start Guide matches Tim's canonical PDF, the welcome screen captures profile data honestly, privacy disclosure is in Settings, the Sunnyvale content for tomorrow's round is loaded. The one residual operational risk is the `faff1d9`-documented edge case where the OS delivers a background task while the JS bundle is unloaded and `defineTask` hasn't run — but that requires the app to be cold-killed AND the OS to deliver before round-start, which is unlikely on first-tester rounds. No blocking debt identified.
