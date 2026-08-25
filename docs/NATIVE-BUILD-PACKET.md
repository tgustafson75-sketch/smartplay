# NATIVE BUILD PACKET — everything that needs a rebuild, batched

Tim, 2026-08-25: *"this is all going towards a build... save everything to the end that we're gonna
have to build as a packet."* His standing rule: **plan as ONE build; three builds = three review
cycles.** Nothing here is OTA-safe. Nothing here is built until the packet is closed.

## In the packet

### 1. Apple Watch app (NEW) — Tim: "yardage on a watch is a minimum for most golf guys"
- `targets/watch/SmartPlayWatchApp.swift` — SwiftUI face, a deliberate mirror of the Wear OS one:
  brand · HOLE n · big middle yardage · F/B flanking · Ask-caddie button.
- `targets/watch/expo-target.config.js` — watch target, bundle `com.smartplaycaddie.app.watchkitapp`.
- `ios-native/WearSwingBridgeModule.swift` + `WearSwingBridge.m` — WCSession bridge, registered under
  **the same module name and event contract as Android**, so `services/watchCaddieBridge.ts` and
  `watchSwingBridge.ts` gained no platform branch beyond resolving the module.
- `plugins/withWatchSwingBridgeIOS.js` — copies the sources AND registers them in the app target's
  Sources phase (see below).
- `@bacons/apple-targets@5.0.0` added; plugin configured with `teamId B6KTPCWF7A`.
- Yardage is **pushed from the phone, never computed on the watch** — the phone owns GPS and the
  green geometry, and a watch doing its own maths would be a second owner of the one number the
  player trusts most.

### 2. Headset-CONNECTED detection (pre-existing, parked)
~10 lines of Kotlin + AVAudioSession. `AudioManager` is already imported and unused. Would retire the
`voiceOnPhoneSpeaker` / caption toggles. See `docs/NEEDS-A-NATIVE-BUILD.md`.

## Verified locally BEFORE spending a build cycle

Ran `npx expo prebuild --platform ios` and inspected the generated `project.pbxproj`:

- ✅ Watch target `SmartPlay Caddie` created alongside the app target.
- ✅ **`Embed Watch Content` phase present on the app target** and containing `SmartPlay Caddie.app`.
- ✅ Target dependency present (app → watch).
- ✅ The watch's `PBXFileSystemSynchronizedRootGroup` resolves through parent group `expo:targets`
  (`path = ../targets`) to `targets/watch` — where the SwiftUI sources actually live.
- ✅ `WearSwingBridgeModule.swift` registered in the app target's Sources phase (4 pbxproj refs).
- ✅ Both Swift files pass `swiftc -parse`.

**On EvanBacon/expo-apple-targets#175** (open since 2026-02-18: wrong dependencies, MISSING Embed
Watch Content phase, duplicate watch.app entries): **it did NOT reproduce** on `@bacons/apple-targets`
v5.0.0 + Expo SDK 54. No patch-package patch was needed. Re-check this after any bump of either — a
silent regression there yields an app with **no watch app embedded**, which builds and passes review
looking fine.

## Why the plugin registers sources instead of only copying them

`withBluetoothMediaButton` and `withMediaPipePose` copy their Swift/Obj-C into the prebuilt tree and
stop. Copying a file into a folder does **not** add it to a target's Sources phase. That pattern
happens to work here because the generated project uses synchronized groups — but relying on it
unverified is how a module ends up present in the repo and absent from the binary. This plugin does
both, idempotently.

## Still to confirm ON the build (cannot be checked from source)

1. The `.ipa` actually contains `Watch/*.app`.
2. `WCSession` activates and the watch shows live yardage on-course.
3. The Ask-caddie button round-trips into the existing hands-free pipeline.
4. Provisioning for the watch bundle id resolves under EAS credentials.

### 3. Permission changes (app.json — requires the rebuild to take effect)
- **REMOVED `android.permission.POST_NOTIFICATIONS`** — the app has no notification code and
  `expo-notifications` is not a dependency. It was asking players for something we cannot do, and it
  contradicts the standing "no push nagging, ever" rule.
- **Widened two iOS purpose strings to the truth.** The microphone string said "voice commands"
  while SmartMotion also records swing audio to grade the strike; the camera string said "in the
  practice cage" while the camera also reads the lie, scans the bag and looks down the hole. Apple
  requires the string to cover every use.

Both are inert until the rebuild — an OTA cannot change a manifest or an Info.plist.

## ⚠️ Play Console forms someone must complete (not a code task)

- **`ACCESS_BACKGROUND_LOCATION`** is genuinely used (`startLocationUpdatesAsync` during a round so
  hole transitions and yardages survive a locked screen). It is legitimate, but Play requires a
  background-location declaration form and a demo video, and it is a common cause of review delay.
- **Health Connect** — four permissions (steps, distance, heart rate, active calories), all really
  read and consumed by the walking detector. Play requires its own Health Connect declaration.

## Not in the packet

Meta glasses — shelved from 1.0 (`services/releaseSurface.ts`). No glasses profile build needed.
