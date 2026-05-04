# Research — Watch IMU integration (Phase BJ Component 2)

**Capability:** Apple Watch + Wear OS IMU data (accelerometer / gyroscope / heart rate) for swing tempo, wrist rotation through impact, transition timing, backswing length.

**Verdict: QUEUE — separate native build pipeline**

## Technical reason

A watch companion app is a fundamentally separate build target, not a feature of the phone app:

- **Apple Watch:** requires a WatchKit extension target compiled from Swift, signed with the same App Store Connect provisioning profile, distributed alongside the iPhone build via App Store Connect. Cannot be added to an Expo / React Native project as a JS module — it's a native Xcode target. The phone-watch communication path uses `WatchConnectivity` (Swift framework), with messaging buffered when the watch is off the wrist.
- **Wear OS:** requires a parallel Android Studio module with its own AndroidManifest, packaged inside the same APK / AAB but with `wear=true` feature flag and a separate JVM target. Communication via Wearable Data Layer (Java/Kotlin only).
- **No React Native abstraction** unifies these. There are libraries (`react-native-watch-connectivity` for iOS, less mature for Wear OS) that wrap the comms layer, but none of them give you a *cross-platform watch app*.

The phase prompt's framing ("watch companion app is separate build") is accurate.

## What would have to change for BUILD TODAY

Either:
1. Tim has a watch (Apple Watch on iOS, or a Wear OS device on Android) AND the project gets a native `watch/` directory with platform-specific module(s) AND we accept the separate-build complexity. Effort: 30-60+ hours minimum.
2. We accept a Bluetooth-LE peripheral pattern instead — a generic IMU peripheral (e.g., Garmin Approach pin, Arccos sensors, custom BLE wearable) that talks to the phone over BLE. That's still its own build but skips the watch ecosystem.

## Current project state

- No `watch/` directory exists.
- `watchConnected` is a flag in `store/settingsStore.ts` and is referenced by cage-mode UI ("Watch On / Watch Off" pill in `app/cage/index.tsx` legacy + current). It's a UI affordance for *future* IMU data — currently displays state but reads no real data.
- Watch IMU is a marquee 1.x or 2.0 feature, not a v1.0 candidate.

## Recommendation

**QUEUE** for the dedicated Watch Companion phase post-1.0 external beta, when there's at least one device the team can test against. Pair with the multi-player phase (player_id ⇄ wrist-IMU correlation makes voice biometric optional).
