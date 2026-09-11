# Launch reconcile — can the cleanup ship as an OTA?

**Date:** 2026-09-11 · **HEAD:** `87b0c293` · **Working tree:** clean
**Mode:** read-only diagnosis. No source or config file was modified. No `eas update`, no `eas build`.

> ## VERDICT
> ```
> OTA-SAFE — cleanup can ship as an EAS Update to build 21
> ```
> **With one correction to the premise, stated up front because it changes what "build 21" means:**
> the binary in Apple review is **build 26**, not build 21, and build 21 is provably not submittable.
> The verdict holds — and holds *more* strongly for 26 than it would have for 21. See §0.

---

## 0. PREMISE CORRECTION — the binary in review is build 26

This was checked rather than assumed, because the answer changes the diff base for every other check.

**Evidence it is build 26:**

- `_handoff/from-cowork.md:133` — *"Build 26 selected on iOS App Version 1.0 (build 22 removed)."*
- `_handoff/from-cowork.md:44` (Play) — *"Version codes: 26  <-- the bundle in review is 26, correct"*,
  with `Status: In review` at line 47. The release is *named* "25 (1.0.0)" because Play names a
  release at creation and the bundle was swapped inside it; the payload is 26.

**Evidence build 21 could not be the reviewed binary:**

| Build | Commit | Icon declared in `app.json` | Actual asset |
|---|---|---|---|
| **21** | `d5ff81a9` | `./assets/images/icon.png` | **892×892, hasAlpha: yes** |
| 22 | `684e0bc6` | `./assets/images/icon-1024-appstore.png` | 1024×1024, hasAlpha: no |
| 23 | `39f82bba9` | `./assets/images/icon-1024-appstore.png` | 1024×1024, hasAlpha: no |
| **26** | `9fdeda03` | `./assets/images/icon-1024-appstore.png` | 1024×1024, hasAlpha: no |
| HEAD | `87b0c293` | `./assets/images/icon-1024-appstore.png` | 1024×1024, hasAlpha: no |

App Store Connect requires exactly 1024×1024 and rejects any alpha channel, so **build 21 would have
failed at upload** — it could never have reached review. Build 22's own commit message says so
explicitly: *"The shipped icon was 892×892 WITH an alpha channel … submission would have failed at
upload regardless of anything else in the build."* Build 21's commit message, written 2026-08-31,
also says *"nothing has been submitted yet."*

**This matters a great deal.** Had build 21 actually been the target, the answer would have been
`NATIVE-BUILD-REQUIRED`: between `d5ff81a9` and HEAD the native surface changed in six files (190
insertions) including a **brand-new config plugin** (`withHealthConnectRationale.js`), the
`expo-media-library` plugin entry, two new iOS usage-description strings, added and removed Android
permissions, and `compileSdk`/`targetSdk` 35 → 36. Shipping today's JS to build 21 would have been
unsafe. It is safe to build 26 precisely because build 26 already contains all of that.

Builds 22 and 23 would *also* have been unsafe bases (§1). Only 26 is clean.

---

## 1. Native-change audit — **PASS**

Base: **`9fdeda03`** (iOS build 26) and **`ebf26637`** (Android versionCode 26, built 34 minutes later).

`ios/` and `android/` are **not tracked in git** — this is a managed / prebuild (CNG) project, so the
native projects are generated at build time from `app.json` + `plugins/`. Verified:
`git cat-file -e HEAD:ios` and `HEAD:android` both fail.

> **Stated precisely, because a bare `ls` is misleading here.** Both directories *do* exist on disk
> (`ios/` holds only a `Podfile`; `android/` a partial gradle tree), left over from a local prebuild
> on **2026-09-03** — a week before this audit and not produced by it. They are excluded twice over:
> `.gitignore:54-55` keeps them out of the repo, and **`.easignore:35-36` keeps them out of the
> tarball uploaded to EAS**. Cloud builds therefore still regenerate the native projects from config,
> and these leftovers cannot influence build 26 or any future build. Worth deleting locally so a
> `expo run:ios` never picks up a stale Podfile, but they are not a native change and not a risk.

### Changes to native-affecting paths, `9fdeda03` → HEAD

| File | Change | Binary-affecting? |
|---|---|---|
| `app.json` | `ios.buildNumber` 25→26, `android.versionCode` 25→26 | **No** — build metadata. EAS `autoIncrement` produced 26 in the artifact itself; HEAD merely records what shipped. |
| `eas.json` | `submit.production.android.track` `internal` → `production` | **No** — submission config, never compiled into a binary. |
| `plugins/withMediaPipePose.js` | `MP_VERSION` `0.10.14` → `0.10.29` | **No, for iOS.** Android-only. |

Nothing else. Verified with an explicit pathspec over every directory the project's own native
fingerprint watches — `app.json eas.json android-native ios-native plugins targets wear-os-app patches`:

```
9fdeda03 -> HEAD :  app.json | 4 ++--   eas.json | 2 +-   plugins/withMediaPipePose.js | 29 +++++-
ebf26637 -> HEAD :  app.json | 2 +-     eas.json | 2 +-
```

> **Methodology note, because it nearly produced a false PASS.** The first run of this diff returned
> "no change" for *every* commit including build 21 — which contradicted an `app.json` diff I had
> already seen. Cause: the pathspec list included `app.config.js`, `ios` and `android`, which do not
> exist, and the variable holding it was unquoted under zsh (which does not word-split). Both made
> git match nothing and exit quietly. An empty diff is only evidence when the paths are known to
> exist. Re-run with existing paths inlined; that is the output above.

### The MediaPipe bump is already in the Android binary

`MP_VERSION 0.10.29` was introduced by commit **`ebf26637`** — which *is* the Android build-26
commit. So the Android bundle in Play review already contains it. iOS build 26 (`9fdeda03`) was cut
34 minutes earlier and does not, but the plugin's own header states why that is irrelevant:

> *"ANDROID ONLY in effect. The iOS mod below writes a `pod 'MediaPipeTasksVision'` line, but that
> pod is not present in the generated Podfile and the iOS pose path was never finished (its sources
> are not registered with the Xcode target), so no iOS binary is affected by this number."*

### Dependencies — **no native module added, removed or bumped**

Computed across all three candidate bases:

| Base | Added | Removed | Version-bumped |
|---|---|---|---|
| `d5ff81a9` (21) | **none** | `nodemailer`, `@types/nodemailer` | **none** |
| `9fdeda03` (iOS 26) | **none** | `nodemailer`, `@types/nodemailer` | **none** |
| `ebf26637` (AND 26) | **none** | `nodemailer`, `@types/nodemailer` | **none** |

`nodemailer` is **server-side only** — its sole importer is `api/issue-report.ts:159`, a Vercel
route. It has never been in the React Native bundle, so its removal cannot affect an OTA payload.
Confirmed with `git grep nodemailer d5ff81a9 -- '*.ts' '*.tsx'`: three hits, all in `api/`.

**No new native module import in JS.** Since zero dependencies were added since even build 21, there
is no module HEAD's JS can import that build 26 lacks.

### EAS fingerprint — MISMATCH, fully attributed, non-blocking

Reported as a fact rather than glossed, because it is the one signal that disagrees:

```
EAS-recorded fingerprint, iOS build 26 : 63e11599219f7baaaadb28cdd1cbfa3065cc7913
Computed at HEAD (expo-updates)        : de36e4373649dd9fbcc1758145d18e554f7455c7
                                          -> DIFFERENT
```

Every contributing source was enumerated (270 sources; 14 repo files outside `node_modules`) and
diffed individually against `9fdeda03`. **Exactly four differ, and all four are inert for the binary:**

| Fingerprint source | What changed | Binary-affecting? |
|---|---|---|
| `expoConfig` (contents) | `buildNumber` 25→26, `versionCode` 25→26 | No — build metadata |
| `packageJson:scripts` (contents) | `ota:*` scripts now call `scripts/ota-preflight.mjs` | No — dev tooling |
| `eas.json` (file) | submit track `internal` → `production` | No — submission config |
| `plugins/withMediaPipePose.js` (file) | `MP_VERSION` | No for iOS; already in the Android binary |

The other 10 repo files in the fingerprint — `.easignore`, `.gitignore`, both image assets, and seven
other config plugins including `withWatchSwingBridgeIOS.js`, `withWearSwingBridge.js`,
`withMetaWearablesDAT.js` and `targets/watch/expo-target.config.js` — are **byte-identical**.

**Crucially, the fingerprint is advisory here, not a gate** — see §2. No native module, permission,
entitlement, plugin entry or SDK level differs.

### The repo's own preflight passes, but its baseline is weaker than this audit

`scripts/ota-preflight.mjs` reports `native unchanged since the store build (runtimeVersion 1.0.0). OK
to publish.` That agrees with the conclusion, but note **how** it agrees:
`.ota-native-baseline.json` records `"recordedAt": "2026-09-09T21:18:24.522Z"` — **five days after the
builds were cut.** It therefore certifies the Sep-9 source tree, not the shipped binary. Had a native
change landed between Sep 4 and Sep 9, the baseline would have blessed it and the preflight would
still say "unchanged."

It happens to be sound here: `904f491c` (the baseline commit) → HEAD shows **no change** to any
watched path, and `ebf26637` → HEAD shows only `app.json` and `eas.json`. The conclusion in this
report rests on the direct build-commit diffs above, not on that baseline.

---

## 2. runtimeVersion reconciliation — **PASS**

| Item | Value | Source |
|---|---|---|
| Policy | **none — a literal string, not a policy object** | `app.json` → `expo.runtimeVersion` |
| Resolves at HEAD | `"1.0.0"` | `app.json:169` |
| iOS build 26 shipped | `1.0.0` | `eas build:list --json` → `runtimeVersion` |
| Android build 26 shipped | `1.0.0` | `eas build:list --json` → `runtimeVersion` |
| **Match?** | **YES** | — |

Every one of the last 20 finished builds carries `runtimeVersion: "1.0.0"`.

**This is what makes the §1 fingerprint mismatch harmless.** `runtimeVersion` is the hardcoded
literal `"1.0.0"`, so update matching is by that string alone. Had the project used
`runtimeVersion: { "policy": "fingerprint" }`, the mismatch in §1 would have meant **the OTA
publishes successfully and silently never reaches a single user** — the exact failure mode worth
shouting about. It does not apply here. No loud call-out warranted; the literal is doing its job.

One consequence worth knowing: because the literal is shared by *every* build ever cut, an update
published to `production` reaches builds 17, 18, 19, 21, 22, 23 and 26 **simultaneously**. Any
TestFlight tester still on an older binary receives this JS too. Nothing in the current cleanup
requires native code, so that is safe today — but it is the reason the §0 build-21 analysis is not
merely academic.

---

## 3. Channel / branch mapping — **PASS**

| Item | Value | Source |
|---|---|---|
| Channel declared by the `production` build profile | `production` | `eas.json` → `build.production.channel`; confirmed on every build row as `channel: production` |
| Branch mapped to that channel | **`production`** | `eas channel:view production` → `updateBranches[0].name` |
| Mapping logic | `{"data":[{"branchId":"019e51a1-e558-…","branchMappingLogic":"true"}],"version":0}` — single unconditional branch | same |
| Channel paused? | `isPaused: false` | same |

> ### Publish to the branch named **`production`**.
> `eas update --branch production` (or `npm run ota:production`, which additionally runs the native
> preflight — see §6 note). That is the branch, and the only branch, that reaches build 26.

The most recent update already on it is `runtimeVersion 1.0.0`, group `63842e76-bef2-4424-a14a-976fbe2c89c6`,
confirming the path is live and correctly matched.

---

## 4. First-launch behaviour — **PASS**

**A day-one installer runs the EMBEDDED (build 26) JS on first launch and picks up the update on a
later launch. The app does NOT block at startup to fetch.**

| Config value | Value in iOS build 26 (`9fdeda03`) | Value at HEAD | Source |
|---|---|---|---|
| `updates.fallbackToCacheTimeout` | **`0`** | `0` | `app.json` → `expo.updates` |
| `updates.url` | `https://u.expo.dev/60b7ee0e-0165-4971-a9c8-219960fed645` | identical | same |
| `updates.checkAutomatically` | **not set** → SDK default `ON_LOAD` | not set | `grep checkAutomatically app.json` → no match |
| `expo-updates` installed | `29.0.18` (declared `~29.0.17`) | same | `node_modules/expo-updates/package.json` |

`fallbackToCacheTimeout: 0` is unambiguous: expo-updates does not wait for a remote update at
startup. It launches the embedded bundle immediately, downloads any matching update in the
background, and applies it on the **next** launch.

**Not a guess, and worth stating precisely because the value changed:** build 21 (`d5ff81a9`) had
`fallbackToCacheTimeout: 10000` — a 10-second startup block. That is what build 21's own commit
message describes (*"fallbackToCacheTimeout is 10s, after which the embedded bundle runs — so on a
slow network the first session of a fresh install is build 19's JS"*). It was changed to `0` before
build 26. **The reviewed binary has `0`.**

**Practical consequence for launch:** a brand-new App Store or Play installer's **first session runs
build 26's embedded JS**, not the OTA. Whatever is wrong in build 26 is what a day-one user sees
once. Anything shipped as an OTA today reaches them on their second launch. That is the correct
trade (no startup stall), but it means the OTA is not a substitute for build 26 being right on its
own for first-run-critical behaviour.

---

## 5. Launch-consistency checks

### 5a. `SUBSCRIPTIONS_ENABLED` — **PASS (value), FAIL (documentation)**

**Current value: `true`.** `services/featureAccess.ts:92` — `export const SUBSCRIPTIONS_ENABLED = true;`
Pinned by `__tests__/logic/edition-matrix.test.ts:45` — `expect(SUBSCRIPTIONS_ENABLED).toBe(true)`.

> ⚠️ **The file's own header contradicts its code.** `services/featureAccess.ts:14-23` still reads:
> *"⚠️ NOTHING IS GATED TODAY, AND NO CLOCK IS RUNNING. ⚠️ … `SUBSCRIPTIONS_ENABLED` stays false, so
> canAccess() returns true for every feature … the paywall route renders nothing."*
> **That is false as of line 92.** Subscriptions are ON, the paywall renders, and trial clocks run.
> The same stale claim is repeated in `app/tutorials.tsx:27`, `app/swinglab/smartmotion.tsx:1214`,
> `services/intents/openToolHandler.ts:576`, `components/caddie/CockpitCaddieScreen.tsx:82` and
> `scripts/simulations/run-sim.ts:14982`. No behaviour is wrong; the prose is. Flagged because a
> stale header is a source someone trusts — and this one says the paywall is off on the day it ships.

**Every code path gated on it:**

| Path | Behaviour when `true` |
|---|---|
| `services/featureAccess.ts:151` `editionFor()` | returns `pro`/`lite` by status instead of always `pro` |
| `services/featureAccess.ts:162` `canAccess()` | enforces `FEATURE_EDITION` instead of always `true` |
| `services/featureAccess.ts:175` `trialDaysLeft()` | returns real days instead of `null` — **the trial clock runs** |
| `services/paywallGuard.ts:55, 78` | paywall interception active |
| `app/paywall.tsx:82, 105` | route renders instead of returning `null` |
| `app/_layout.tsx:572` | subscription bootstrap runs |
| `app/_layout.tsx:704` | promo-expiry handling runs (absolute `promo_expires_at`) |
| `app/_layout.tsx:671` | `subscriptionsEnabled` reported in telemetry |
| `app/(tabs)/caddie.tsx:3718, 3727` | trial-ending and expired banners can render |
| `app/tutorials.tsx:192` | the `trial` tutorial is included |
| `app/invite.tsx:88` | referral reward line switches to the real reward |

**Related, and clean:** `services/billing/purchases.ts:114-115` use real store keys — `appl_…` (App
Store) and `goog_…` (Play). **No `test_` RevenueCat key is present**, which matters because
`scripts/simulations/run-sim.ts:4338-4346` locks "a test-store key may exist only while
SUBSCRIPTIONS_ENABLED is false". With the switch on, a `test_` key would mean every purchase
transacts against a test store, appears to succeed, and no money moves.

### 5b. `EXPO_PUBLIC_OWNER_EMAIL` not set in any production build — **PASS**

| Location | Result |
|---|---|
| `eas.json` | **not present** — `grep OWNER_EMAIL eas.json` → no match |
| `eas.json` env blocks, all 5 profiles | `development`, `preview`, `production`, `glasses`, `production-apk` each declare only `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_MAPBOX_TOKEN`, `SENTRY_DISABLE_AUTO_UPLOAD` (+ `MWDAT_*` on `glasses`) |
| Committed `.env` files | only `.env.example` and `pipecat-server/.env.example` are tracked; neither contains an `OWNER` key |
| `.env*` on disk | only `.env.example`. No `.env.local`. |

This is the right answer, and the failure mode is severe: `app/_layout.tsx:672` computes
`isOwner: isOwnerEmail(ownerEmail) || (process.env.EXPO_PUBLIC_OWNER_EMAIL ?? '').trim().length > 0`
— a **non-empty value of any kind** makes **every install** an owner, regardless of the email. A
regression test exists for exactly this
(`__tests__/regression/a-single-owner-email-would-make-every-install-an-owner.test.ts`).

**`OWNER_EMAILS` is the only active allow-list** (`store/playerProfileStore.ts:18-30`). Current
contents — 4 entries:

```
t.gustafson75@gmail.com
t.gustafson@hotmail.com        # Tim's iOS test device (added 2026-06-09)
support@smartplaycaddie.com    # Google Play / App Review sign-in
tim@smartplaycaddie.com        # Google Play / App Review sign-in
```

Matching is case-insensitive on the trimmed profile email (`isOwnerEmail`, line 32). The two
`@smartplaycaddie.com` addresses are declared in Play Console → App content → Sign in details;
removing either without updating that declaration breaks reviewer access to paid features.

### 5c. `lib/pricing.ts` — **PASS on all four values**

| Expected | Found | Location | |
|---|---|---|---|
| $9.99 / month | `price: 9.99`, `displayPrice: '$9.99'`, `period: 'month'` | `lib/pricing.ts:20-22` | ✅ |
| $79 / year | `price: 79`, `displayPrice: '$79'`, `period: 'year'` | `lib/pricing.ts:56-58` | ✅ |
| 14-day trial | `trialDays: 14` | `lib/pricing.ts:62` | ✅ |
| entitlement `smartplay_caddie_pro` | `export const ENTITLEMENT_ID = 'smartplay_caddie_pro';` | `services/billing/purchases.ts:75` | ✅ |

**No value deviates.** The entitlement id is additionally pinned by
`__tests__/regression/entitlement-mapping.test.ts:170`.

Store product ids alongside the prices: `com.smartplaycaddie.app.full.monthly` and
`com.smartplaycaddie.app.full.annual` (`lib/pricing.ts:23, 59`). These must match App Store Connect
and Play Console exactly — **not verifiable from this repo** (see §7).

Context, not a defect: `lib/pricing.ts:26-53` records that **$79 is a founding price** intended to
rise to $99 at 250 paying annual subscribers or annual exceeding ~40% of new subscriptions.

---

## 6. Summary table

| # | Check | Result | Evidence |
|---|---|---|---|
| 0 | Binary in review is build 26, not 21 | **CORRECTED** | `_handoff/from-cowork.md:44,133`; build 21 icon 892×892 + alpha |
| 1 | Native-affecting changes since build 26 | **PASS** — none found | `app.json` (version bookkeeping), `eas.json` (submit track), `withMediaPipePose.js` (Android-only) |
| 1b | Dependencies added / bumped | **PASS** — none | only `nodemailer` removed; server-only (`api/issue-report.ts:159`) |
| 1c | `ios/` or `android/` in tree | **PASS** — untracked (CNG) | `git cat-file -e HEAD:ios` fails; on-disk leftovers from 2026-09-03 excluded by `.easignore:35-36` |
| 1d | New native module import in JS | **PASS** — none possible | zero deps added since build 21 |
| 1e | EAS fingerprint HEAD vs build 26 | **MISMATCH, attributed** | 4 sources, all non-binary-affecting; advisory only (§2) |
| 2 | runtimeVersion match | **PASS** | literal `"1.0.0"` at HEAD and on both build-26 artifacts |
| 3 | Channel → branch | **PASS** | channel `production` → branch **`production`**, unpaused |
| 4 | First-launch behaviour | **PASS** | `fallbackToCacheTimeout: 0` in build 26 and HEAD; `checkAutomatically` unset → `ON_LOAD` |
| 5a | `SUBSCRIPTIONS_ENABLED` | **PASS** (value `true`) / **FAIL** (6 files document it as `false`) | `services/featureAccess.ts:92` vs `:14-23` |
| 5b | `EXPO_PUBLIC_OWNER_EMAIL` unset | **PASS** | absent from `eas.json`, all 5 env blocks, all committed `.env`, disk |
| 5c | Pricing + entitlement | **PASS** | `lib/pricing.ts:20,56,62`; `services/billing/purchases.ts:75` |

---

## 7. What I could not determine

**Which iOS build App Store Connect currently holds — not verified against Apple directly.**
There is no App Store Connect API key (`.p8`) on this machine: `~/.config/smartplay/` contains only
`play-service-account.json`, and `credentials.json` holds a distribution certificate and provisioning
profile, not an ASC key. `eas submit:list` does not exist in the installed `eas-cli@16.x`.

The build-26 conclusion therefore rests on `_handoff/from-cowork.md` (Cowork's own console-side
verification, quoted in §0) plus the icon-compliance proof that excludes build 21. That is strong,
and it is consistent — but it is second-hand. **To close it first-hand**, either an ASC API key
(`.p8` + key id + issuer id) or a browser session on App Store Connect is needed; the latter is
Cowork's lane.

**Store-side product configuration is out of reach from this repo.** Whether App Store Connect and
Play Console actually list $9.99 / $79 / 14-day trial against
`com.smartplaycaddie.app.full.monthly` and `.annual`, and whether the RevenueCat dashboard maps them
to entitlement `smartplay_caddie_pro`, can only be confirmed in those consoles. §5c verifies the
**code side** only.

---

## 8. Verdict

```
OTA-SAFE — cleanup can ship as an EAS Update to build 21
```

Restated accurately: **the cleanup can ship as an EAS Update, and it will reach the binaries actually
in review — iOS build 26 and Android versionCode 26 — because both carry `runtimeVersion 1.0.0` and
the channel `production` maps to the branch `production`.** Nothing between those build commits and
HEAD requires a new native binary: no dependency added or bumped, no plugin added or removed, no
permission, entitlement, SDK level, icon or scheme change. The only native-path deltas are build
metadata, a submission-config field, and an Android-only constant already present in the Android
bundle.

**Publish to branch `production`.** Preview and production must be published sequentially, never in
parallel. Prefer `npm run ota:preview` / `npm run ota:production` over a bare `eas update` — those
scripts run `scripts/ota-preflight.mjs` first, which refuses an OTA whose native fingerprint moved
while `runtimeVersion` stayed `1.0.0`. A bare `npx eas update` skips that check entirely.

**Two things this verdict does not cover:**

1. **Build 26's embedded JS is what a day-one installer sees on first launch** (§4). The OTA arrives
   on their second launch. First-run-critical behaviour must be right in build 26 itself.
2. **The `SUBSCRIPTIONS_ENABLED` documentation is wrong in six files** (§5a) — harmless to the OTA,
   but it tells the next reader the paywall is off on the day it goes live.

**Nothing was fixed and nothing was published. Read-only, as scoped.**
