# Device & OS Compatibility Matrix

**Established 2026-08-19.** Supersedes nothing — this did not exist before. It is the
companion to [critical-paths.md](critical-paths.md) (*what* to test) and
[QA-CHECKLIST.md](QA-CHECKLIST.md) (*how* to run a pass). This one answers **where**, and —
just as important — **where we cannot**.

---

## 0. The honest headline: one platform is device-testable

The current test fleet is **iPhone via TestFlight only**.

That single fact should shape how every readiness claim in this repo is worded. Android is not
a secondary platform here — it is the platform the app was primarily *developed* on, it is the
only platform where several features exist at all (health data, watch, glasses), and it has
**no device in the fleet**.

Using the standing verification tiers:

| Tier | Meaning | Available on |
|---|---|---|
| **A** | Compiles / typechecks / lints | all platforms |
| **B** | Code-traced source → UI by reading the code | all platforms |
| **C** | Verified on a real device by Tim | **iOS only** |

So: *"verified on Android"* is a sentence this project currently cannot truthfully write. Say
"code-traced" and mean it. The gap is recorded in §6 with what it would take to close.

---

## 1. Platform floor and ceiling

| | iOS | Android |
|---|---|---|
| **Minimum OS** | **iOS 15.1** (Expo SDK 54 / `ExpoModulesCore.podspec`) | **Android 10** (API 29, `minSdkVersion` in `app.json` → `expo-build-properties`) |
| **Target / compile** | current Xcode SDK | **API 35** (Android 15) |
| **Framework** | Expo SDK ~54.0.33, React Native 0.81.5, React 19.1.0 | same |
| **Runtime engine** | Hermes | Hermes |
| **Store identity** | `com.smartplaycaddie.app`, ASC app `6772344465`, team `B6KTPCWF7A` | `com.smartplaycaddie.app` |
| **Tablet** | **`supportsTablet: false`** | no tablet-specific config |
| **Distribution** | TestFlight (production channel) · App Store (target Oct 1) | preview APK (internal) · AAB for Play |

**iOS 15.1 is the floor that matters for `AbortSignal.timeout`.** `services/polyfills.ts` exists
because the Hermes runtime on the Fold dev-client predates the static factory, and 12 fetch call
sites depend on it. It is imported as the **first line** of `app/_layout.tsx`. Any device old
enough to need it will hard-fail every timed fetch — weather, course content, course geometry,
golfcourseapi, cage upload, pose detection, CV scoring, context synthesis — if that import is
ever reordered. Treat "old device, everything network times out" as a polyfill-ordering
symptom, not a connectivity one.

---

## 2. Native module × platform grid

This is the part that generates real per-platform behaviour differences. A feature is not
"broken on iOS" if it appears here as absent — it was never built there. Test accordingly.

| Capability | Module / plugin | iOS | Android | Notes |
|---|---|---|---|---|
| Camera (swing, scans) | `react-native-vision-camera`, `expo-camera` | ✅ | ✅ | |
| On-device pose | `plugins/withMediaPipePose.js` | ✅ | ✅ | Both branches copy native sources; **requires a native build** — not OTA-shippable. Active in the 07-21 build. |
| Location + background | `expo-location` | ✅ | ✅ | Android also declares a foreground service; iOS piggybacks on `UIBackgroundModes:location`. |
| Bluetooth media button (earbud tap) | `plugins/withBluetoothMediaButton.js` | ✅ | ✅ | Both platforms have native sources. |
| Wear OS watch bridge | `plugins/withWearSwingBridge.js`, `services/watchSwingBridge.ts` | ❌ **absent** | ✅ | Hard-gated `Platform.OS === 'android'`. There is **no Apple Watch equivalent**. |
| Watch caddie bridge | `services/watchCaddieBridge.ts` | ❌ **absent** | ✅ | Same gate. |
| Health data (steps, HR, distance, calories) | `react-native-health-connect` via `services/healthData.ts` | ⚠️ **stub** | ✅ | iOS returns empty/zero from every export by design. HealthKit was deferred ("don't send ios build yet") and that deferral has outlived its reason. **Consumers affected: walking detector, shot-detection enhancement, round-summary enrichment.** |
| Meta glasses (DAT) | `plugins/withMetaWearablesDAT.js` | ✅ | ✅ | Was `Platform.OS === 'android' && loaded`, which hard-disabled iOS; corrected. Needs the `glasses` EAS profile (`MWDAT_IOS_ENABLED=1`). |
| On-device speech recognition | `expo-speech-recognition` | ✅ | ✅ | Android pins `com.google.android.googlequicksearchbox`; iOS uses `iosTaskHint: 'dictation'`. Different engines → **different transcription characteristics**; do not assume voice accuracy transfers between platforms. |
| Crash reporting | `@sentry/react-native` | ✅ | ✅ | `uploadSourceMaps: false` — stack traces arrive minified. |

**The asymmetry that matters most for this fleet:** the three capabilities that are Android-only
or iOS-stubbed (watch, watch caddie, health data) are invisible on the *only* platform we can
device-test. Their entire verification story is Tier B.

---

## 3. Permissions matrix

Android declares 18 permissions in `app.json`. Each one is a runtime prompt that can be denied,
and a denial path that must degrade honestly rather than go dark.

| Permission | iOS | Android | Denied → expected behaviour |
|---|---|---|---|
| Camera | `NSCameraUsageDescription` | `CAMERA` | SmartMotion / Cage / scans blocked with a spoken reason, never a silent no-op |
| Microphone | `NSMicrophoneUsageDescription` | `RECORD_AUDIO` | Voice unavailable; touch fallback still works; cage mode drops to manual-only |
| Location (in use) | when-in-use string | `ACCESS_FINE_LOCATION` / `COARSE` | **User-visible toast** ("GPS off — enable Location…"), not console-only. Yardages honest-blank. |
| Location (background) | `UIBackgroundModes:location` | `ACCESS_BACKGROUND_LOCATION` + `FOREGROUND_SERVICE_LOCATION` | Round tracking pauses when pocketed; must not silently lose holes |
| Notifications | — | `POST_NOTIFICATIONS` (13+) | `backgroundLocationTask.ts` early-returns `true` on iOS by design |
| Media read | photo-library read string | `READ_MEDIA_IMAGES` / `VIDEO` / `READ_EXTERNAL_STORAGE` | Upload/library flows blocked with a reason |
| Health | — (**stubbed**) | 4 × `android.permission.health.*` | Zeroes; consumers skip rather than fabricate |
| Bluetooth | added by `withMetaWearablesDAT.js` | — | Glasses/earbud features unavailable |

**Standing rule that applies here:** an over-strict gate should *degrade and flag*, never go
dark. A denied permission that produces a blank screen with no explanation is a defect, not
correct behaviour.

---

## 4. Form factors

| Form factor | Width class | Status | Evidence |
|---|---|---|---|
| Standard phone (portrait) | < 540dp | ✅ primary | |
| iPhone with notch / Dynamic Island | < 540dp | ✅ | The hardcoded `top: 84` badge collision (PLATFORM-QA-AUDIT P1.3) is **fixed** — re-verified 2026-08-19 |
| Galaxy Z Fold — closed | narrow | ✅ | |
| Galaxy Z Fold — open | ≥ 540dp | ⚠️ **partial** | Caddie + Scorecard adapt. `dashboard.tsx` now adapts (fixed since the May audit). **`play.tsx` and `swinglab.tsx` still have zero `useWindowDimensions` subscription** — they do not adapt at all, and do not re-evaluate on fold/unfold. |
| Tablet | ≥ 540dp | ❌ not supported | `supportsTablet: false`. iPad can still run it in compatibility mode; layout will be phone-shaped. |
| Landscape | — | mixed | `expo-screen-orientation` is a plugin; capture screens use it deliberately. Not a general layout target. |
| Wear OS (Galaxy Watch 4+) | — | ✅ companion | Separate app, `minSdk 30` / `targetSdk 33` / `compileSdk 34`. **No device in fleet.** |

**Kevin's portrait is canonically LOCKED** across every one of these (CLAUDE.md, Phase AU). If he
looks off-centre on a new device, the fix is in the parent container in `caddie.tsx` — never a
transform inside `CaddieAvatar`. Move the other element, not Kevin.

---

## 5. Test fleet

| Device | OS | Channel / build | Tier | Covers |
|---|---|---|---|---|
| **iPhone (Tim)** | iOS 15.1+ | **TestFlight, production channel**, build 12 / runtime `1.0.0` | **C** | Paths 1–6, iOS layout, notch/Island, voice, camera, GPS |
| Galaxy Z Fold | Android 10+ | preview APK, dev-client | — *no device* | would cover: fold layout, watch, health, Android voice |
| Standard Android | Android 10+ | preview APK | — *no device* | would cover: non-fold Android layout |
| Galaxy Watch 4+ | Wear OS 3 | `~/Downloads/smartplay-watch-signed.apk` | — *no device* | would cover: watch reps, IMU calibration, club tagging |

### The TestFlight constraint governs what can ship between builds

Testers are frozen on **build 12 / runtime `1.0.0`** and are not downloading a new binary. So an
OTA update must not introduce:

- a new native module, plugin, or native dependency;
- a change to `runtimeVersion` (it stays a literal `"1.0.0"`);
- anything requiring a `package.json` dependency the shipped binary does not contain.

Before any OTA, verify all three: `runtimeVersion`, `package.json` deps, `app.json` plugins.
**And note `api/*` changes are not covered by OTA at all** — those need a Vercel deploy, which is
a separate step that has been forgotten before.

---

## 6. Known coverage gaps, and what closes each

| Gap | Consequence | To close |
|---|---|---|
| **No Android device in fleet** | Every Android claim is Tier B. Android is where watch, health and (historically) glasses live. | One Android phone on the preview channel. Highest-value single addition. |
| **No Fold in fleet** | `play.tsx` / `swinglab.tsx` non-adaptation is unverifiable, and fold/unfold mid-round is untested. | The Fold dev-client, or an emulator at ≥ 540dp for layout only (emulator cannot verify GPS/camera/sensors). |
| **No watch in fleet** | Watch reps, IMU calibration and club tagging are Tier B only. | Galaxy Watch + the signed APK. |
| **iOS health data is a stub** | Walking detection, shot-detection enhancement and round-summary enrichment are degraded on the *only* device-testable platform. | HealthKit bridge (`react-native-health` or custom native module) + Info.plist strings. **Requires a native build — not OTA.** |
| **`play.tsx` / `swinglab.tsx` no dimension subscription** | No fold/tablet adaptation on two primary tabs (PLATFORM-QA-AUDIT P1.1, still open since 2026-05-24). | `useWindowDimensions()` + a `W >= 540` branch on each tab's top-level container. |
| **Sentry source maps not uploaded** | Production crash reports arrive minified — a real crash may be unreadable at the moment it matters most. | Flip `uploadSourceMaps` and wire the auth token in the build profile. |

---

## 7. How to phrase a readiness claim

> ✅ "Paths 1–6 verified Tier C on iPhone/TestFlight build 12. Android, Fold and Wear OS are
>    Tier B (code-traced) — no device in fleet."

> ❌ "Verified working on iOS and Android."

The second sentence is not currently possible to earn. Per the verification-claim discipline:
never say clean/done/works from gates alone, and never let a code-traced platform borrow the
confidence of a device-verified one.
