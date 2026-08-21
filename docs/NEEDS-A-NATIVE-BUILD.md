# Parked — requires a new native build (cannot ship OTA)

**Parked by Tim, 2026-08-21.** Testers are frozen on TestFlight bn12 / runtime 1.0.0, so anything
here is blocked until a build is cut. Nothing in this file is a bug — each is a capability that needs
native code, which an OTA update cannot add.

**These should be planned together.** One build clears the whole list; three builds is three review
cycles.

---

## 1. Headset-CONNECTED detection  ·  small  ·  highest daily value

**Not the same as earbud TAP, which already works and ships** (see `services/mediaKeyBridge.ts`
header — corrected 2026-08-21 — and `services/voiceTriggers.ts`).

What is missing is knowing a headset is *plugged in / paired*, so the app can adapt without the
player touching a toggle:
- `voiceOnPhoneSpeaker` could stop being a manual switch
- captions could auto-enable on Bluetooth audio (the settings copy already promises this)
- the caddie could stop asking whether to talk out loud

**Why it needs a build:** `services/audioRoutingService.detectRoute()` detects nothing — it
configures the audio mode and returns, and the only writer of the route is the manual Settings
toggle. `android-native/BluetoothMediaButtonModule.kt` already **imports
`android.media.AudioManager` and never uses it**.

**Size:** ~10 lines of Kotlin (`AudioManager.getDevices(GET_DEVICES_OUTPUTS)`, filter for
`TYPE_BLUETOOTH_A2DP` / `TYPE_WIRED_HEADSET`) plus an `AVAudioSession.currentRoute` equivalent in
`ios-native/BluetoothMediaButtonModule.swift`, exposed as `isHeadsetConnected()` and a change event.
The JS side already has a subscriber shape to feed (`subscribeRouteChanges`).

## 2. Meta glasses  ·  already staged

`isMetaWearablesAvailable()` returns true only when the native DAT module is present. Registration
and AASA are live; the code is staged. This needs a glasses-profile build to become real.

## 3. Wi-Fi / metered-connection LABEL  ·  optional, probably skip

A true "is this Wi-Fi" flag needs NetInfo or expo-network, neither installed.
**Deliberately not needed:** `services/connectionClass.ts` measures throughput and latency directly
in JS, which is a better signal anyway — weak hotel Wi-Fi is worse than good 5G and the flag would
lie about exactly that case. Only revisit if a metered-data warning is wanted.

---

## Build checklist when one is cut
- [ ] `isHeadsetConnected()` + route-change event, both platforms
- [ ] Wire it to `voiceOnPhoneSpeaker` and caption auto-on, replacing the manual toggles
- [ ] Meta glasses profile
- [ ] Re-verify: `npm run probe-tools` (both brains), a voice round on device, earbud tap
- [ ] Bump runtimeVersion only if native deps changed — see `ota-must-work-on-the-shipped-ios-build`
