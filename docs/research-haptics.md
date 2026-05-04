# Research — Background haptics for course navigation (Phase BJ Component 3)

**Capability requested:** Phone vibration when the app is *not in the foreground active state* (locked screen, in pocket) — for yardage-threshold alerts, hole-transition confirmations, ambient mark events.

**Verdict: QUEUE the literal request, BUILD-TODAY-CANDIDATE the equivalent-utility pivot via local notifications**

---

## Why "background haptics" as literally requested is QUEUE

### iOS — platform-prohibited

Per multiple Apple Developer Forums threads:

- `UIFeedbackGenerator` (the framework `expo-haptics` uses) does **not** produce haptics when the app is not in the foreground active state. Confirmed by Apple engineers in [thread 681512](https://developer.apple.com/forums/thread/681512).
- Core Haptics calls its `stoppedHandler` automatically when the app is sent to background — playback halts. [Thread 676629](https://developer.apple.com/forums/thread/676629) confirms.
- **No background-mode entitlement exists** that enables haptics. There is no `UIBackgroundModes` value for haptics. Apple has consistently refused to expose this.
- The only iOS-supported way to vibrate a backgrounded device is via **a local notification with a haptic-enabled sound**. The system controls the haptic, not Core Haptics.

This is a platform policy, not a library limitation. No third-party RN library can fix it.

### Android — possible but heavy

Background `Vibrator` calls work *only* from a running foreground service with a persistent notification:

- `Vibrator` API works from a foreground service even when screen is locked.
- `VibrationAttributes.USAGE_ALARM` / `USAGE_NOTIFICATION` required for reliable background invocation.
- The project already has `FOREGROUND_SERVICE` and `FOREGROUND_SERVICE_LOCATION` permissions in `app.json` — necessary, not sufficient.
- **A foreground service with persistent notification must actively be running** for the vibrator calls to fire. SmartPlay doesn't run a foreground service today (the in-round Mark / Caddie tab work happens while the app is foregrounded).
- `expo-haptics` does NOT manage foreground services — it's a thin wrapper over `Vibrator`. Calling it from background JS while no FG service runs likely fails silently.

So Android-only ambient haptics is achievable, but it requires standing up a foreground service for round-active state — and even then it's still asymmetric (works on Android, dead on iOS).

## The pivot — local-notification haptics (cross-platform, BUILD-TODAY candidate)

A local notification fires haptics on **both** iOS (locked screen, system-controlled) and Android (notification channel-driven). This achieves the actual user-experience goal — *"Tim's phone in his pocket vibrates when he passes a target distance"* — without trying to fight platform restrictions.

### Implementation shape

| Step | Effort | Notes |
|---|---|---|
| Install `expo-notifications` + permissions plumbing in onboarding | 1.5h | New dep. Privacy policy already covers notifications generically. |
| Threshold-watcher integrated into existing GPS subscriber | 2h | Listens to `gpsManager` updates, fires on threshold cross. Files: new `services/proximityNotifier.ts`, integrate from `app/_layout.tsx` |
| Custom vibration patterns per event type (yardage / hole / mark) | 1.5h | iOS uses notification sound, Android uses notification channel `vibrationPattern` |
| Dedupe logic (don't spam-fire on repeated threshold cross / GPS jitter) | 1h | Hysteresis band ±5 yards |
| Galaxy Fold + iOS Simulator empirical verification | 1-2h | Tim opens app, walks past threshold simulated-GPS, confirms phone buzzes through pocket |
| **Total** | **6-9h** | Inside the prompt's <4h BUILD-TODAY bar? **No** (~50-100% over). Inside what's reasonable for a focused phase? **Yes.** |

### Privacy / permission considerations

- `expo-notifications` registers for notification permission with the OS. Tim approves once, Android channel-based granularity available.
- No new third-party processor — notifications are local, OS-fired. No update needed in `docs/privacy-policy.md` §4.
- Add a new `Settings → Notifications` toggle (yardage alerts / hole transitions / mark confirmations independently) for users who don't want them.

### Edge cases

- **iOS Focus mode / Do Not Disturb** silences notifications, including their haptics. Acceptable — that's the user's explicit choice.
- **Battery cost** — fairly low; notifications fire only on threshold cross, not continuously. The GPS subscriber already runs during active rounds anyway.
- **Hole transition double-fire** — needs the same dedupe logic as the existing hole-transition voice opener.

## Foreground haptic state — already correct

The existing Mark button haptic in `app/(tabs)/caddie.tsx` (Phase AL) is foreground-only and works fine. `expo-haptics` is the right call there. Don't touch it.

## Decision

**For the literal "background haptic" feature: QUEUE** (no path on iOS, partial path on Android, asymmetric and fragile).

**For the equivalent-utility goal "phone alerts during round when in pocket": BUILD-TODAY CANDIDATE** via `expo-notifications` + threshold watcher + custom vibration patterns. **Scope: 6-9 hours.** This is moderate scope, additive, and adds a real user-facing capability before next round attempt.

Awaiting Tim's go/no-go before this becomes a build phase. If yes, it gets queued as a separate phase (e.g., "Phase BO — Round-state haptic notifications") rather than rolled into BJ output.
