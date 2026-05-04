# Research — iOS Live Activities + Dynamic Island (Phase BJ Component 9)

**Capability:** iOS 16+ Live Activities for lock-screen and Dynamic Island display of in-round state — current hole, yardage to pin, last shot. Glance-without-unlock UX during a round.

**Verdict: QUEUE — iOS-only, Tim doesn't have an iOS device**

## Technical reason

Live Activities are an iOS-only platform feature, available iOS 16.1+. The Android equivalent is a persistent foreground notification, which is structurally different and would need its own implementation.

The phase prompt itself notes: *"Tim doesn't have iOS device per project history."* That's the blocker — Live Activities can be coded but not empirically verified without an iPhone running iOS 16+. Per `docs/critical-paths.md` line 14, *"empirical behavior on real device"* is the verification bar for SmartPlay; code-level checks are explicitly insufficient.

## Implementation cost (when Tim does have iOS)

The integration is moderately involved:
1. **Native Swift extension** — Live Activities require an ActivityKit widget extension target (Swift / SwiftUI). Cannot be implemented in JS only. Existing RN libraries:
   - `react-native-live-activities` — community library, last reviewed in 2024. Quality / maintenance unverified.
   - `expo-modules-core` allows custom native modules, but ActivityKit specifically still needs a SwiftUI widget target.
2. **EAS prebuild + custom config plugin** — non-trivial setup; once shipped, the dev-client workflow stays clean.
3. **Push token management** — Live Activities can be updated from the server via APNs Live Activity push tokens, separate from regular APNs tokens. SmartPlay would need a small backend hook (Vercel API route) to push round-state updates.

Effort estimate (when iOS test device available): 6-12 hours for a basic "current hole + yardage" Live Activity.

## Android equivalent

A persistent foreground notification with `MediaStyle` or `BigTextStyle` can show:
- Current hole + par
- Yardage to pin (live-updating via foreground service tick)
- Last shot summary

Android already has `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION` permissions in `app.json`. A new foreground service for round-state notifications would be additive. Effort estimate: 3-5 hours.

## Recommendation

**QUEUE** the iOS Live Activity work until either Tim has an iPhone or external testers do. **Consider building the Android-equivalent persistent notification as a separate, focused phase** — it's smaller scope, ships value to the actual primary user (Tim on Galaxy Z Fold), and would be a reasonable BUILD-CANDIDATE if Tim wants glanceable round state on the lock screen. That's a question to ask separately, not a Phase BJ output.

## What would have to change for BUILD TODAY

- For iOS Live Activities: an iOS device + at least 1-2 hours of native Swift/SwiftUI work + EAS native config. Probably out of scope today.
- For Android persistent notification: nothing major. ~3-5 hours. **If Tim wants glanceable round state on the Z Fold lock screen, this is a candidate.**
