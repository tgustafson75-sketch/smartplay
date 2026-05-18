# Phase 413 — Wearable Verification Checklist

Code-side work is complete. Real verification requires Tim's device
because Health Connect can't be exercised on a simulator and depends
on Galaxy Watch + Samsung Health + Health Connect being paired on the
phone.

## Prerequisites on the Galaxy Z Fold

1. Galaxy Watch is paired and Samsung Health is the data source on
   the watch.
2. Samsung Health app on the Fold is set to sync to Health Connect:
   Samsung Health → Settings → Health Connect → "Allow" for Steps,
   Heart rate, Distance, Active calories, and Exercise.
3. Health Connect app installed (preinstalled on Android 14+,
   downloadable on Android 13). Open it once so the system finishes
   provisioning.

## EAS Android build

Native module install means OTA won't reach the device — needs a
fresh APK.

```
eas build --platform android --profile preview
```

(Tim runs this in his terminal since the EAS CLI prompts interactively.)

Once installed and launched, the React-side initialization happens
lazily on first round start.

## Verification matrix

### A. First round start (cold device)

Expected:
- Health Connect permission prompt appears with steps / HR / distance
  / exercise / active calories all listed as requested
- Granting all permissions returns control to SmartPlay
- `[roundStore] health-permission JIT ask` log line shows the result
- `hasAskedHealthPermission` is now persisted true; subsequent round
  starts skip the prompt

### B. Walking round (no cart, watch on wrist)

Expected:
- During the round, `[walkingDetector] tick` logs show step counts
  climbing every 30s
- `[orchestrator] auto-fire suppressed (cart mode effective)` does
  NOT appear when walking — shot detection fires as normal
- At round end, RoundRecord.health has totalSteps > 1000 (typical
  9-hole walk), distanceMeters > 4000, heartRateAvg in active range,
  hasWatchData=true
- Recap surfaces walked-distance / step count when present

### C. Cart round (manual cartMode=true)

Expected:
- handleShotEvent suppression fires as before
- RoundRecord.health.totalSteps still > 0 (player walks between cart
  and ball)

### D. Cart round (manual cartMode=false but actually riding)

Expected:
- Detector's `getCachedReading()` returns mode='cart' after 30s tick
- `[orchestrator] auto-fire suppressed (cart mode effective)` fires
  WITHOUT the user having flipped the manual toggle. False shots
  from cart movement are suppressed.

### E. Permission denied at first ask

Expected:
- Round proceeds normally, no errors
- `hasAskedHealthPermission` is still set to true (no nagging)
- End-round: snap.hasData=false → no enrichment, RoundRecord.health
  undefined
- Settings → Health Data → "Re-ask permission on next round" clears
  the flag; next round restarts the prompt

### F. Health Connect uninstalled / not paired

Expected:
- `isHealthAvailable()` returns false
- All health calls resolve cleanly with zero / empty values
- Round flow has no degraded experience

### G. iOS

Expected (deferred until iOS build):
- isHealthAvailable() returns false on iOS
- All health features degrade gracefully
- Settings → Health Data section copy notes Android-only

## Known follow-ups (out of scope this phase)

- HealthKit bridge for iOS (`react-native-health` install + Info.plist
  usage strings + parallel implementation behind the abstraction)
- Background workout-session start/stop detection (Phase 413 only
  reads steps + HR + distance + active calories on demand at round-end)
- Cross-device sync of health data (everything is local-only today)
- Custom watch companion app (Wear OS) — separate phase

## Files changed in Phase 413

- `package.json` — added `react-native-health-connect@^3.5.3`
- `app.json` — added Health Connect plugin + 5 health permissions
- `services/healthData.ts` — NEW, sensor-agnostic abstraction
- `services/walkingDetector.ts` — NEW, walking-vs-cart classifier +
  background ticker + sync-readable cached reading
- `store/settingsStore.ts` — added `healthDataEnabled` (default true)
  + `hasAskedHealthPermission` (default false) + setters
- `store/roundStore.ts` — `RoundRecord.health` optional field;
  `enrichLastRoundWithHealth()` method; JIT permission ask in
  startRound; walkingDetector ticker start/stop tied to round
  lifecycle; async health-snapshot read in endRound
- `services/conversationalLoggingOrchestrator.ts` — uses
  `isEffectiveCartMode()` to combine manual cartMode + detector
  signal for auto-shot suppression
- `app/settings.tsx` — new "Health Data" section with master toggle
  and re-ask button
- `docs/audit-413-wearable-state.md` — Component 1 audit (pre-work)
- `docs/phase-413-verification.md` — this file (Component 10)
