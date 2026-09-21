# Native-build packet — status 2026-09-10 (was 2026-08-29)

**Parked by Tim 2026-08-21; worked 2026-08-29 while the paid launch waits on an EIN.**
One build clears the list. Three builds is three review cycles.

> ⚠️ **This file was materially wrong before today, in the direction that costs time.** It said the
> headset work was unbuilt and ~10 lines away; most of it had shipped on 08-25. It did not mention
> 120fps at all, which the 08-28 handoff listed as part of this packet — and which turned out to need
> nothing. Re-read the code before trusting any "not built yet" line in a doc, including this one.

---

## 1. Headset-connected detection · **DONE 2026-08-29**

- `getAudioRoute()` on both platforms — shipped 08-25 (the old "AudioManager is imported and never
  used" line here was already stale when it was written).
- **What was actually missing: the change EVENT.** `detectRoute()` asked once, on first subscribe, so
  the app learned the route at app start and never again. Players put earbuds in on the first tee,
  not in the car park.
- Now: `startRouteWatch()` + `onAudioRouteChanged` on both platforms
  (AVAudioSession.routeChangeNotification / AudioManager.AudioDeviceCallback), bridged and
  subscribed. Guarded by `LOCK: the audio route is WATCHED, and every layer of the bridge agrees` —
  five layers have to line up and only one of them fails loudly.
- `services/audioRoutingService.ts`'s header used to describe 2-second polling and an expo-av
  abstraction. Neither existed. Rewritten to say what the file does.

**Still open (product, not build):** wire the live route to `voiceOnPhoneSpeaker` and caption auto-on
so the manual toggles can retire. The signal is now real; nothing consumes it to REPLACE a toggle
yet. Deliberately not done blind — it changes behaviour on a screen under the layout freeze.

## 2. Meta glasses · **needs a secret, not code**

- iOS: works via the `glasses` EAS profile (`MWDAT_IOS_ENABLED=1`), public SPM repo, no token.
- Android: the DAT SDK is in GitHub Packages, so the build needs **`GITHUB_TOKEN`** (a GitHub PAT
  with `read:packages`) in EAS env. Without it `withMetaWearablesDAT` skips the Android wiring and
  says so at build time.
- **Action: none for 1.x.** Adding `GITHUB_TOKEN` to EAS is a 2.0 task, since only the `glasses`
  profile sets the MWDAT flags. Tim or Cowork adds it when glasses ship; Claude Code must not hold it.

## 3. 120fps vision-camera · **already shipped — nothing to do**

`react-native-vision-camera` was in `app.json` plugins at the shipped commit `1b0ba0ad`, and
`SwingVisionCamera` already asks `useCameraFormat` for `PREFERRED_CAPTURE_FPS`. The 08-26 work
(`ce4ed588`) published the fps actually achieved and let `MIN_TRACE_FPS` decide. A 120fps-capable
phone gets 120fps on the CURRENT build. This was on the packet by mistake.

## 4. Wi-Fi / metered label · **skip, deliberately**

`services/connectionClass.ts` measures throughput and latency directly, which is a better signal —
weak hotel Wi-Fi is worse than good 5G and a flag would lie about exactly that case.

---

## 5. Watch command path · **UNBUILT, and the newest item on this list**

Added 2026-09-10. Tim, today: *"I thought all Kotlin builds were done."* Reasonably — the STORE
builds were done and submitted. This landed after them.

**Verified against EAS, not inferred:**

| Artifact | Commit | Built |
|---|---|---|
| Android versionCode 26 | `ebf26637` | 2026-09-04 |
| iOS 1.0.0 | `9fdeda03` | 2026-09-03 |
| **watch command path** | **`b893d5ad`** | **never — 5 days after the last build** |

It lives unmerged on `native/watch-command-and-capability` and changes Kotlin on BOTH ends:
`android-native/WearSwingBridgeModule.kt` and the watch app's `MainActivity.kt`. What it fixes:
`watchCaddieBridge` has routed `open_smartmotion` / `smartmotion_record` / `smartmotion_stop` /
`smartmotion_toggle` since 2026-08-07, and neither end existed — the phone's native module had no
command path and never emitted the event, and the watch's "Record swings" button only starts its own
sensor service. Both ends missing, only the middle written.

**Merge caution:** that branch also edits `services/watchCaddieBridge.ts`, and main changed the same
file on 2026-09-10 (fix-driven pin-yardage push on `subscribeFixChange`, plus the fan-out fix that
made it actually fire). Merge onto current main and re-read that file rather than taking either side
wholesale.

**Everything else shipped today is JS and went out by OTA — only this needs a build.**

---

## R8 / ProGuard is OFF — Google Play says 2% obfuscation · **added 2026-09-18, parked by Tim**

Play Console, release 25 (1.0.0): *"DEX code optimization is below our threshold — Obfuscation (2%).
Percentages under 25% in any category may impact your visibility and publishing capabilities. Fix by
Feb 2027."*

**Cause, exactly.** `app.json` → `expo-build-properties` sets `minSdkVersion`, `compileSdkVersion`
and `targetSdkVersion` for Android and nothing else, so `enableProguardInReleaseBuilds` keeps its
default of **false**. Nothing in the repo has ever turned R8 on — a repo-wide search for `proguard`,
`minify` and `R8` found no config, no keep-rules file, and no note. The 2% Play is measuring is
whatever Hermes and the AGP defaults happen to shorten; none of our Java/Kotlin is renamed.

**The change** (one block, `app.json`):

```json
["expo-build-properties", { "android": {
  "minSdkVersion": 29, "compileSdkVersion": 36, "targetSdkVersion": 36,
  "enableProguardInReleaseBuilds": true,
  "enableShrinkResourcesInReleaseBuilds": true
}}]
```

**Why it is not a one-line change.** R8 strips and renames anything it cannot see being used, and
this app reaches a lot of code by reflection and by JNI — the exact things it cannot see:

- `plugins/withMediaPipePose.js` — MediaPipe tasks-vision loads models and calls into native by name.
- `plugins/withWearSwingBridge.js` / `android-native/WearSwingBridgeModule.kt` — the Wear data-layer
  listener is resolved by class name from the manifest.
- `plugins/withBluetoothMediaButton.js` — a `BroadcastReceiver`/`MediaSession` callback, same story.
- `plugins/withMetaWearablesDAT.js` — the DAT SDK is third-party and ships its own rules only if the
  dependency is present.
- `@sentry/react-native` — needs its keep-rules or the stack traces we rely on come back mangled.

Each of those needs a `proguard-rules.pro` keep, and a stripped one fails **at runtime on a release
build only** — never in dev, never in Expo Go, and not necessarily on the first screen. That is why
this rides a build with a device pass, not a Friday config edit.

**Do it on the next native build**, with `npm run probe-tools`, a voice round, a SmartMotion capture,
a watch swing and an earbud tap re-verified on the release AAB before it goes to Play. Deadline is
Feb 2027; there is no reason to cut a build for it alone.

---

## NOBODY CAN READ A PRODUCTION CRASH · **added 2026-09-18 — do this before the next build**

A fatal native crash arrived from a real player today (EXC_BAD_ACCESS, KERN_INVALID_ADDRESS at 0x54,
route `/greeting`, iPhone18,1 on iOS 26.6.2, release 1.0.0+27) and its stack reads:

```
?, in <redacted>
?, in <redacted>
... (12 additional frames were not displayed)
```

**That is configuration, not Sentry being unhelpful.** Two switches, both off:

| Where | Setting | Effect |
|---|---|---|
| `app.json` → `@sentry/react-native` plugin | `"uploadSourceMaps": false` | every **JS** error arrives minified |
| `eas.json`, all five profiles | `SENTRY_DISABLE_AUTO_UPLOAD: "true"` | no **dSYMs** → every **native** crash arrives unsymbolicated |

So the app is live in both stores and *no crash it reports can be diagnosed*, JS or native. That is a
worse problem than any single crash: it is the instrument, not the reading.

`SENTRY_DISABLE_AUTO_UPLOAD` is not a mistake in itself — it stops a build failing when no auth
token is present, which is why it is on every profile. The missing piece is the token.

**What Tim has to do (2 minutes, only he can):** Sentry → Settings → Auth Tokens → create one with
`project:releases` and `org:read`, then `eas secret:create --name SENTRY_AUTH_TOKEN --value <token>`.
Claude Code must not hold it.

> **2026-09-19 — AND THE ORG SLUG WAS WRONG, WHICH WOULD HAVE BROKEN THIS ANYWAY.** `app.json` said
> `"organization": "smartplay"`. Tim's Sentry is **`smartplay-ai`** (his own issue links are
> `https://smartplay-ai.sentry.io/...`, and that subdomain is the slug). Events were never affected
> — the DSN addresses the org by numeric id (`o4511297513717760`), which is why crashes have been
> arriving all along — but sentry-cli uploads source maps and dSYMs **by slug**. The first build
> after the token was created would have failed to upload against an org that is not his, and the
> symbolication work would have looked broken for a reason nobody would have gone looking for.
> **PARKED, NOT FIXED — and app.json still says `smartplay` on purpose.** The correction was made
> and then reverted, because `scripts/ota-preflight.mjs` fingerprints app.json WHOLE: editing it
> reads as a native change and refuses *every* OTA until a store build ships. The slug cannot reach
> the installed binary — it addresses sentry-cli's upload target — but the guard cannot know that,
> and re-recording its baseline for a reason its own text does not cover is how a guard becomes a
> rubber stamp (Tim's call, 2026-09-19).
>
> **So it is one line, to make WITH the build, not before it:**
>
> ```json
> "organization": "smartplay"   →   "organization": "smartplay-ai"
> ```
>
> Do it in the same commit that cuts the native build, so the fingerprint moves once and the
> baseline is re-recorded straight after (`npm run ota:baseline`). Getting this wrong costs nothing
> until the auth token exists; after that, it silently breaks every symbol upload.

**Then:**
1. Flip `uploadSourceMaps` to `true` and drop `SENTRY_DISABLE_AUTO_UPLOAD` from the **production**
   profile only (leave it on development/preview so a local build never fails on a missing token).
   Do NOT flip it before the secret exists — the build will fail.
2. Source maps upload with each OTA from then on, so JS errors become readable **without a build**.
3. dSYMs come from the native build, so native crashes stay unreadable until the next one.

**For build 27 specifically:** EAS reports `Build Artifacts URL: null`, so the dSYMs were not kept
there. App Store Connect may still hold them (Xcode → Organizer → Archives → Download Debug Symbols,
or the ASC API — this repo already has ASC credentials wired for `scripts/asc-status.py`). If they
come down, `sentry-cli debug-files upload` makes today's crash readable retrospectively.

---

## Build checklist
- [x] `getAudioRoute()` both platforms
- [x] route-change event, both platforms, bridged and subscribed
- [x] RevenueCat / IAP (`f54432c2`) — the reason this build is being cut
- [x] ~~`GITHUB_TOKEN` in EAS env, for Android glasses~~ — **NOT THIS BUILD (2026-09-21).** `MWDAT_IOS_ENABLED`/`MWDAT_ANDROID_ENABLED` appear only in the `glasses` profile; production, preview and production-apk set neither. Glasses are 2.0. Cowork said this on 08-30 and the checklist never caught up.
- [x] ~~RevenueCat public SDK keys in `eas.json`~~ — **ALREADY SHIPPED (2026-09-21).** Both live as the defaults in `services/billing/purchases.ts:113-114`; the env vars still override, so a rotation needs no rebuild. Nothing owed in `eas.json`.
- [ ] Re-verify on device: `npm run probe-tools`, a voice round, earbud tap, headset plugged in
      MID-round, a sandbox purchase and a restore
- [ ] merge `native/watch-command-and-capability` (Kotlin both ends; re-read watchCaddieBridge.ts)
- [ ] **`app.json` Sentry `organization`: `smartplay` → `smartplay-ai`** — one line, in the build
      commit itself (parked 09-19 because editing app.json blocks every OTA; see above). Without it
      the token below uploads to an org that is not Tim's and the symbols never arrive
- [ ] SENTRY_AUTH_TOKEN in EAS secrets, `uploadSourceMaps: true`, and SENTRY_DISABLE_AUTO_UPLOAD
      dropped from the production profile — until then every production crash is unreadable
- [ ] R8/ProGuard on (`enableProguardInReleaseBuilds`) + keep-rules for MediaPipe, Wear bridge,
      Bluetooth media button, Meta DAT and Sentry — then re-verify each on the release AAB (Play
      obfuscation warning, fix by Feb 2027)
- [ ] runtimeVersion: leave at `1.0.0`. The billing code degrades safely on older binaries by
      design, so keeping the literal means existing testers keep receiving OTA fixes.
