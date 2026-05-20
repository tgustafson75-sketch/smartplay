# Phase 420 — Build Health Audit

**Audit date:** 2026-05-20
**Scope:** SmartPlay Caddie Pro production codebase at `/Users/timothyg/Documents/smartplay`
**Mode:** Investigation only — NO fixes applied.

## TL;DR

| Check | Result | Launch blocker? |
|---|---|---|
| `tsc --noEmit` (strict) | **0 errors, 0 warnings** | NO — clean. |
| `expo lint` | **5 errors, 12 warnings** | NO — all errors are JSX entity escapes; non-functional. |
| `expo-doctor` | **17/17 passed** | NO — clean. |
| Hermes bundle | **5.2 MB / platform** (iOS + Android) | NO — reasonable for this surface area. |
| `@ts-ignore` / `@ts-nocheck` suppressions | **0** | NO — tsc is honestly passing. |
| `: any` types | **7** | NO — extremely low. |
| `console.log` total (app source) | **355** | Soft yes — needs a sweep before public TestFlight; not a hard launch blocker. |
| `TODO`/`FIXME`/`HACK`/`XXX` markers | **5** | NO — all scoped. |

Build is in **legitimately good shape**. tsc strict passes with zero suppressions. Lint failures are cosmetic (apostrophes in JSX). Doctor is clean. The only quality concern is console.log pollution in services, which is hygiene, not correctness.

---

## 1. TypeScript — `npx tsc --noEmit`

```
$ cd /Users/timothyg/Documents/smartplay && npx tsc --noEmit
$ # (empty output, exit 0)
```

**Errors: 0. Warnings: 0.**

### Is tsc honestly passing?

`tsconfig.json` extends `expo/tsconfig.base` and adds `"strict": true`. No `"skipLibCheck"` override (inherited from Expo base — Expo's base does set `skipLibCheck: true`, which is standard and not a red flag). Confirmed:

```jsonc
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": { "strict": true, "paths": { "@/*": ["./*"] } },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.d.ts", "expo-env.d.ts", ".expo/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Sanity checks for hidden suppressions:

- `rg "@ts-ignore|@ts-nocheck|@ts-expect-error" --type ts` → **0 hits.**
- `rg ": any\b" --type ts` → **7 hits** total across the whole tree (extremely low).

**Verdict:** tsc is genuinely passing. Strict mode is on, no escape hatches are in use, no errors are being silenced. This is the strongest signal in the build-health audit.

**Launch blocker:** No.

---

## 2. ESLint — `npx expo lint`

```
✖ 17 problems (5 errors, 12 warnings)
  0 errors and 2 warnings potentially fixable with the --fix option.
```

### Error breakdown (all `react/no-unescaped-entities`)

| File:line | Issue |
|---|---|
| `app/mark-green.tsx:143` (3 instances) | Literal `"` and `'` characters in JSX text — needs `&quot;` / `&apos;`. |
| `app/settings.tsx:920` | Literal `'` in JSX text. |
| `app/swinglab/smartmotion.tsx:610` | Literal `'` in JSX text. |

**Interpretation:** These are cosmetic-only. They do not affect runtime behavior; React renders the characters fine. The rule exists because raw `'`/`"` in JSX *can* break under certain SSR/HTML escaping paths, but in our case they ship as plain text. **Effort to fix: trivial** — replace each with the HTML-entity form or wrap in `{"…"}`.

### Warning breakdown (12 total)

| Class | Count | Examples |
|---|---|---|
| `@typescript-eslint/no-unused-vars` | 9 | `RailButton`, `TabPill`, `BodyMechanicsCard`, `ShotTracerCard` defined-but-never-used inside `app/swinglab/smartmotion.tsx`; `setWatchConnected` (`app/settings.tsx`), `isRoundActive` (`app/smartvision.tsx`), `isSimulatedActive` (`app/gps-test.tsx`), `homeCourseName` (`components/caddie/L1HolePreview.tsx`), `dominantMiss` arg (`app/swinglab/smartmotion.tsx:589`). |
| `react-hooks/exhaustive-deps` | 1 | `app/swinglab/smartmotion.tsx:109` — useEffect missing `caddiePersonality`, `profile.dominantMiss`, `profile.handicap`, `profile.name`. |
| Unused `eslint-disable` directives | 2 | `app/gps-test.tsx:44, 46` — directives no longer suppress anything. |

### Is lint silent because the config is broken?

Confirmed it is **not.** `eslint.config.js` extends `eslint-config-expo/flat` (the official Expo flat-config) with one local override that tightens unused-var detection (`argsIgnorePattern: '^_'`, etc.). The config IS catching real findings — see above. It just isn't catching much because the codebase is reasonably clean.

**Worst-offender file:** `app/swinglab/smartmotion.tsx` (6 lint findings — 4 unused components, 1 unused arg, 1 exhaustive-deps). Effort to clean: < 30 minutes.

**Launch blocker:** No. Cosmetic.

---

## 3. expo-doctor — `npx expo-doctor`

```
Running 17 checks on your project...
17/17 checks passed. No issues detected!
```

**Launch blocker:** No. Cleanest signal in the audit.

---

## 4. Bundle size

Latest `dist/` export (built into `/Users/timothyg/Documents/smartplay/dist/`):

```
dist/_expo/static/js/ios/entry-79b5fba71583925246f0c89d3f2e5fed.hbc      5.2M
dist/_expo/static/js/android/entry-9cf5c74195bf3d439a8b7d19b78a3255.hbc  5.2M
```

**Interpretation:** 5.2 MB Hermes bytecode per platform. Reasonable for an app of this surface area (77 routes, 81 components, 132 services). Asset count is high (~210 JPG/PNG hole images bundled at app-install — these are NOT in the .hbc and don't bloat the JS bundle but do count toward APK / IPA size).

The dead-code removals in `audit-420-dead-code.md` (~3,400 LOC of orphans) would shrink the bundle by perhaps ~150-200 KB after Metro tree-shaking — not nothing, but not the biggest lever. Asset audit (the 210 bundled JPGs) would dwarf any JS savings.

**Launch blocker:** No.

---

## 5. console.log pollution

`rg -c "console\.log\(" services/ components/ app/ hooks/ store/` → **355 total occurrences** across 84 files.

### By directory

| Directory | console.log count |
|---|---|
| `services/` | 197 |
| `app/` | 92 |
| `store/` | 33 |
| `components/` | 17 |
| `hooks/` | 16 |
| **TOTAL** | **355** |

### Top 5 worst offenders by count

| File | console.log count |
|---|---|
| `store/roundStore.ts` | 29 |
| `services/simulatedGPS.ts` | 22 |
| `services/listeningSession.ts` | 16 |
| `app/(tabs)/caddie.tsx` | 13 |
| `hooks/useVoiceCaddie.ts` | 12 |

(Honorable mentions: `services/voiceService.ts` 11, `services/gpsManager.ts` 11, `services/fillerLibrary.ts` 10.)

**Interpretation:** Heavily concentrated in the round/voice/GPS lifecycle code — exactly the code paths Tim is debugging on every Mariners-range / Sunnyvale outing. The logs are diagnostic, not stray. But they DO ship to production and they DO show up in user-facing console output if the user ever sees a JS error overlay. They also burn CPU when running on Android Hermes (less so on iOS).

**Recommendation:** Wrap critical logs in a `__DEV__` guard or route through a single `logger` helper that no-ops in production. Not urgent, but worth doing before broad TestFlight distribution.

**Launch blocker:** Soft yes — not a *correctness* blocker, but a hygiene one for the public TestFlight rollout.

---

## 6. TODO / FIXME / HACK / XXX markers

`rg -c "TODO|FIXME|HACK|XXX" --type ts` → **5 markers total across 5 files.**

| File | Marker |
|---|---|
| `lib/pricing.ts` | TODO — align stripeProductId values with the real Stripe product (Phase 2B). |
| `components/CaddieAvatar.tsx` | TODO — re-crop `tank_v2_*.png` assets to 9:16. |
| `services/intents/queryStatusHandler.ts` | TODO — read driver yardage from accumulated club distances when wired. |
| `app/swinglab/smartmotion.tsx` | TODO — club tag sheet. |
| `app/_layout.tsx` | TODO — add `EXPO_PUBLIC_SENTRY_DSN` + Sentry org/project to `eas.json`. |

**Interpretation:** Five real, scoped, well-described TODOs across the whole codebase. No `FIXME`/`HACK`/`XXX` markers at all. This is unusually clean.

**Launch blocker:** No.

---

## 7. Type-system honesty cross-check

To verify tsc isn't lying:

- `tsconfig.json` has `"strict": true`. Confirmed.
- Zero `@ts-ignore`, zero `@ts-nocheck`, zero `@ts-expect-error`.
- Seven `: any` declarations app-wide — sample-inspected; they're isolated edge cases (string-keyed dynamic lookup tables, etc.), not strict-mode bypasses.
- No `*.d.ts` shims overriding types from real libraries (only `expo-env.d.ts` and `types/env.d.ts`).

**Verdict:** TypeScript is providing real safety in this codebase. The "0 errors" result reflects actual code quality, not configuration evasion.

---

## 8. Overall launch readiness from a build-health perspective

| Concern | Status |
|---|---|
| Code compiles cleanly | YES |
| Strict TypeScript catching real bugs | YES (no suppressions) |
| Lint passing | NO — but only 5 cosmetic errors (10 minutes to fix) |
| expo-doctor green | YES |
| Bundle size sane | YES (5.2 MB Hermes) |
| Hidden type/runtime debt | LOW (5 TODOs, 7 `any`s, 0 ignores) |
| Production logging hygiene | NEEDS WORK (355 console.logs ship to prod) |

**Nothing here is a launch blocker.** The lint errors should be fixed before App Store submission (Apple has flagged JSX entity escapes in metadata reviews in the past, though it's rare). The console.log pollution should be addressed as a pre-public-TestFlight hygiene pass.

The codebase is in noticeably better shape than the 2026-05-17 full-repo audit suggested it would be — Phases 415-420 appear to have done real cleanup work along the way.
