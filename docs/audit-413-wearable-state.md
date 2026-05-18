# Phase 413 — Wearable Integration Audit (state on 2026-05-17)

## TL;DR

**Nothing real is wired.** The codebase has scaffolding that *looks* like
watch integration but it's all designed around a hypothetical future
native module that doesn't exist yet. No step count, heart rate,
activity, or workout data ever reaches the app from any wearable.

## What exists today

### `services/watchService.ts`
Pure-function analysis helpers (no I/O):
- `analyzeTempoRatio(backswing, downswing)` → ratio + verdict
- `estimateClubSpeed(peakWristSpeed)` → mph estimate
- `getKevinTempoLine(metrics, club)` → tempo coaching line

Takes `SwingMetrics` as input. Doesn't fetch from any wearable. The
expected source is a future Galaxy Watch / Wear OS / Apple Watch
companion app that streams the metrics in — that app doesn't exist.

### `store/watchStore.ts`
Zustand store keyed on swing tempo:
- `isConnected: boolean` — never set to true in practice
- `deviceName: string | null`
- `lastHeartbeat: number | null` — wall-clock connection probe, not HR
- `sessionSwings: SwingMetrics[]` — populated by `recordSwing()` from
  manual entry / debug flows only
- Persisted via AsyncStorage

The `recordSwing` mutator is called by `cage-debug.tsx` and a few
synthetic-data paths. No real device writes to it.

### `app/settings.tsx` — Connected Hardware
Three rows, all explicit "not wired" stubs:
- Samsung Galaxy Watch · Not wired
- Earbud / BT remote tap · Not wired
- Ray-Ban Meta temple tap · Blocked

Settings copy is honest: "Samsung Health SDK integration is a native
module that ships in a future APK build. The toggle is parked in
simulation mode for dev testing only — it does not pull real tempo /
club-speed data from your watch today."

### Sensors available
`expo-sensors` is installed. The only consumer is
`services/rangefinder.ts` for `DeviceMotion` pitch (phone tilt for the
SmartFinder rangefinder). No Pedometer / Accelerometer / Gyroscope
usage in the round flow.

## What's missing (everything)

1. No `react-native-health-connect` (Android Health Connect bridge)
2. No `react-native-health` (HealthKit bridge)
3. No permission flow for health data anywhere
4. No step-count subscription
5. No heart-rate subscription
6. No walking/cart detection (cart mode is a manual settings toggle)
7. No automatic shot detection from step+GPS combination
8. No round-context enrichment from health data
9. No privacy controls for health data

## Permission/data flow (current)

There is NO health permission flow. Round start asks for:
- Location (foreground)
- Microphone (for voice + acoustic detector)
- Camera (for SmartVision / capture)

These are batched in `app/permissions.tsx` (one-time at first launch).
No health categories are requested or stored.

## Implementation reality check

This phase requires:

1. **Native module install.** `react-native-health-connect` + iOS
   counterpart. Both are native modules that need to be linked into
   the build — they cannot ship via EAS Update (OTA). An Android EAS
   build is required to get the new APK on Tim's Galaxy Z Fold.

2. **Health Connect setup on device.** Galaxy Watch must be paired
   with Samsung Health on the phone, and Samsung Health must sync
   into Health Connect. (Health Connect is the Android-wide health
   data store; Samsung Health bridges into it.) If Tim hasn't done
   this setup before, that's a separate ~5 min on-device step.

3. **Permission grant.** Health Connect uses a custom permission
   activity — the app launches a Health Connect intent that lets the
   user grant per-data-type access (Steps, Heart Rate, Distance,
   Active Workouts, etc.).

4. **iOS deferred.** Tim's primary device is Galaxy Z Fold. iOS path
   can be stubbed/parallel and built later once Android works.

## Recommended split

| Block | Owner | ETA | What ships via |
|---|---|---|---|
| A. Install native module + scaffold | Code | 1-2h | EAS Android build |
| B. Permission flow + permissions screen | Code | 1h | EAS Android build |
| C. Step + HR + distance subscriptions | Code | 2h | EAS Android build |
| D. Walking vs cart detection | Code | 1-2h | EAS Android build |
| E. Shot-to-shot enhanced detection | Code | 2-3h | EAS Android build |
| F. Round context enrichment | Code | 1-2h | EAS Android build |
| G. Privacy controls in Settings | Code | 1h | EAS Android build |
| H. Verification on Tim's device | Tim | 30 min | — |

Total: 9-13h code + 30 min Tim hands-on. None of A-G ships via OTA;
all require an Android EAS build to land on Tim's device.

## Open questions before starting block A

1. Confirm Tim wants to install `react-native-health-connect` as a
   dependency. Once added, every future build pulls it in (it's a
   small lib, no major bloat — but worth the explicit call).
2. Confirm Galaxy Watch is paired to Samsung Health on the Fold and
   Samsung Health is syncing into Health Connect. If not, that's a
   prerequisite Tim handles before testing.
3. Cart-mode toggle in Settings stays as a manual override even
   after auto-detection ships — yes/no? (Recommend yes; auto-detect
   is enhancement, not replacement.)

## Files that will change in subsequent components

- `package.json` (add deps)
- `app.json` / `eas.json` (Android permissions in manifest)
- `app/permissions.tsx` (Health Connect grant step)
- `app/settings.tsx` (Connected Hardware row goes live; Privacy section
  for health data)
- `services/healthData.ts` (NEW — sensor-agnostic abstraction)
- `services/walkingDetector.ts` (NEW — walk vs cart logic)
- `services/conversationalLoggingOrchestrator.ts` (incorporate watch
  signal into shot detection)
- `store/roundStore.ts` (round summary fields: totalSteps, distanceWalked,
  averageHR, durationMin)
- `store/watchStore.ts` (extend for health data, or split into a new
  store; existing swing-tempo plumbing stays alongside)
