# Native-build packet — status 2026-08-29

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
- **Action: Tim or Cowork adds GITHUB_TOKEN to EAS.** Claude Code must not hold it.

## 3. 120fps vision-camera · **already shipped — nothing to do**

`react-native-vision-camera` was in `app.json` plugins at the shipped commit `1b0ba0ad`, and
`SwingVisionCamera` already asks `useCameraFormat` for `PREFERRED_CAPTURE_FPS`. The 08-26 work
(`ce4ed588`) published the fps actually achieved and let `MIN_TRACE_FPS` decide. A 120fps-capable
phone gets 120fps on the CURRENT build. This was on the packet by mistake.

## 4. Wi-Fi / metered label · **skip, deliberately**

`services/connectionClass.ts` measures throughput and latency directly, which is a better signal —
weak hotel Wi-Fi is worse than good 5G and a flag would lie about exactly that case.

---

## Build checklist
- [x] `getAudioRoute()` both platforms
- [x] route-change event, both platforms, bridged and subscribed
- [x] RevenueCat / IAP (`f54432c2`) — the reason this build is being cut
- [ ] `GITHUB_TOKEN` in EAS env, for Android glasses
- [ ] RevenueCat public SDK keys in `eas.json`
- [ ] Re-verify on device: `npm run probe-tools`, a voice round, earbud tap, headset plugged in
      MID-round, a sandbox purchase and a restore
- [ ] runtimeVersion: leave at `1.0.0`. The billing code degrades safely on older binaries by
      design, so keeping the literal means existing testers keep receiving OTA fixes.
