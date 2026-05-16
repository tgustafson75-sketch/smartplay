# Phase 405 Audit: GPS subsystem state

**Audit Date:** 2026-05-16
**Scope:** every GPS-dependent function in the app (hole detection,
hole transitions, shot tracking, course identification, foreground
service, battery management, cart/walking detection, off-course
handling, network-loss recovery, round lifecycle, tee selection, shot
attribution).
**Methodology:** read-only inspection of `services/gpsManager.ts`,
`services/holeDetection.ts`, `services/shotDetectionService.ts`,
`services/intents/logShotHandler.ts`, `services/courseGeometryService.ts`,
`services/batteryMonitor.ts`, `store/roundStore.ts`,
`app/(tabs)/play.tsx`, `app/_layout.tsx`, `app/(tabs)/caddie.tsx`,
`app/smartfinder.tsx`.

> Phase 400 / 400-followup already established that **gpsManager's
> math, polling adaptation, outlier rejection, smoothing, and
> foreground-resume kill detection are solid.** This audit is about
> the BROADER GPS ecosystem — everything that depends on the manager
> and orchestrates it.

---

## Verdict by component

| Component | State | Anchor |
|-----------|-------|--------|
| Hole detection + sustained-position transition | **REAL** | `services/holeDetection.ts:35-37, 217-222` |
| Hole re-entry / loop-back | **PARTIAL** | `services/holeDetection.ts:152-168` |
| Voice shot logging + GPS snapshot | **REAL** | `services/intents/logShotHandler.ts:61-67, 146-147` |
| Auto-shot detection from movement | **REAL** | `services/shotDetectionService.ts:30-37, 194-198` |
| "I'm at my ball" / next-position capture | **MISSING** | no flow exists |
| Manual shot-location correction | **MISSING** | no UI |
| Course identification at round start | **STUB** | `app/(tabs)/play.tsx` manual-only |
| Tee box selection (Blue/White/Red) | **MISSING** | no UI, no roundStore field |
| Tee-box confirmation (player at correct tee) | **MISSING** | not checked at round start |
| **Background GPS / foreground service** | **MISSING** | no `expo-task-manager.defineTask`; AppState restart only |
| Backgrounded round pause/resume | **MISSING** | round stays "active" while phone backgrounded |
| Battery saver implementation | **STUB** | `services/batteryMonitor.ts:17, 74` blocks 'active' only |
| Cart vs walking — speed suppression | **PARTIAL** | `services/shotDetectionService.ts:161-163` (used only to suppress shot detection; no UI surface) |
| Cart vs walking — UI / adaptive timing | **MISSING** | hole detection uniform thresholds |
| Off-course UI indicator | **MISSING** | yardages silently blank |
| Poor-GPS UX (recalibration) | **REAL** | `services/gpsManager.ts:414-469` |
| Poor-GPS caddie callout (sustained weak signal) | **MISSING** | no callout fires |
| Geometry pre-warm at round start | **MISSING** | SmartFinder cold-starts on first open |
| Network-loss mid-round geometry fallback | **PARTIAL** | `services/courseGeometryService.ts:103, 112` falls back to stale cache, no UX surface |
| Round-start GPS orchestration hook | **PARTIAL** | scattered across `caddie.tsx:1313`, `_layout.tsx:331-346`, `shotDetectionService.start()` |
| Round-end teardown | **PARTIAL** | only `shotDetectionService.stop()` calls `stopGpsManager` |
| Shot attribution to current hole | **PARTIAL** | `logShotHandler.ts:128-129` uses `round.currentHole`; hole-detection freezes during weak signal so currentHole can desync |

## State of GPS (1 sentence)

**The GPS subsystem has solid foundations (adaptive polling, outlier
rejection, hole detection with sustained-position logic, voice shot
logging) but the ecosystem is fragmented: no foreground service for
phone-in-pocket play, no course auto-detect at round start, no tee
selection UI, no off-course indicator, no centralized round-start
orchestration, and no geometry pre-warm — leaving several user-visible
gaps with what Golfshot / Arccos / Garmin Golf deliver today.**

## Prioritized "what needs work"

### CRITICAL (blocks parity)

1. **Background GPS + foreground service** — `services/gpsManager.ts:296-310`
   Add `expo-task-manager.defineTask` for `Location.startLocationUpdatesAsync`;
   register the task at round start with the foreground-service
   notification config; tear down at round end. Requires `app.json`
   updates for `expo-location` background mode + foreground-service
   permission (Android). Touches native config — schedule its own
   commit + EAS build, NOT an OTA.

2. **Round-start orchestration hook** — `store/roundStore.ts:316-395`
   New `useRoundStore.startRound()` post-action effect: sequentially
   (a) request foreground location permission, (b) await
   `fetchCourseGeometry(courseId)`, (c) `await startGpsManager()`, (d)
   `startHoleDetection()`, (e) `startShotDetection()`. Today these are
   scattered across `caddie.tsx:1313`, `_layout.tsx:331-346`,
   `shotDetectionService.start()`. A user could tap "Start Round"
   before the caddie-tab effect fires and miss the GPS.

3. **Round-end teardown guarantee** — `store/roundStore.ts:396-450`
   Mirror of (2): on `endRound`, tear down `stopGpsManager` +
   `stopHoleDetection` + `stopShotDetection` + foreground-service
   notification. Today only `shotDetectionService.stop()` calls
   `stopGpsManager`.

4. **Course auto-detect at round start** — `app/(tabs)/play.tsx:120-160`
   GPS-radius lookup against `golfcourseapi.searchCourses(coords)`
   before the user taps "Start Round". Show nearby courses as quick-pick
   chips. If a single course matches within 500m → auto-suggest. If
   multiple → user picks.

5. **Tee box selection** — `app/(tabs)/play.tsx` + `store/roundStore.ts`
   Add `selectedTee: 'blue' | 'white' | 'red' | 'gold'` to roundStore.
   Picker UI in play tab pre-Start. SmartFinder + hole detection use
   selected tee's coordinates for "closer to next hole" math (today
   they use `teeLat/Lng` regardless of tee selection).

### HIGH

6. **Geometry pre-warm at round start** — `store/roundStore.ts:startRound`
   `await fetchCourseGeometry(courseId)` so SmartFinder doesn't
   cold-start when the user first opens it mid-round. Cache survives
   network loss for 7 days (`courseGeometryService.ts:43`).

7. **Off-course UI indicator** — `app/smartfinder.tsx` empty state +
   `components/CaddieDataStrip.tsx`
   When player is >100y from all holes for >20s, show "Off course"
   badge + suppress yardages. Today yardages just go blank with no
   explanation.

8. **Cart vs walking mode UI** — `services/shotDetectionService.ts:161-163`
   speed data exists; expose `cartMode` state to roundStore. Adapt
   hole-detection sustained-time threshold (cart faster, walking
   slower). Show indicator in data strip.

9. **"I'm at my ball" shot flow** — `services/intents/logShotHandler.ts` +
   `app/(tabs)/caddie.tsx`
   After auto-shot detection fires, prompt "Where's your ball?". Capture
   ball location separately from swing-moment location so distance is
   honest.

10. **Manual shot-location correction** — recap or
    `app/hole-view.tsx`
    Let user tap map post-shot to override recorded position.

### MEDIUM

11. **GPS stale-fix caddie callout** — `services/gpsManager.ts:284-294`
    When accuracy stays >30m for >45s, fire a callback that
    `caddie.tsx` consumes to speak "GPS signal weak; tap Mark or step
    into open sky".

12. **Hole re-entry safeguard** — `services/holeDetection.ts:152-168`
    Loop-back detection: allow transition back to a previously-played
    hole if player is >50y from current hole and <20y from re-entry
    hole.

13. **Battery saver refinement** — `services/batteryMonitor.ts`
    When enabled, drop walking-mode accuracy `High → Balanced`, extend
    interval `10s → 15s`. Surface estimated drain.

---

## What ships in THIS commit (Phase 405 first wave)

Items 6 (geometry pre-warm) and 7 (off-course UI indicator) are
non-invasive, additive, and pay off immediately. The rest are tracked
in `docs/audit-405-gps-state.md` for follow-up phases.

Critical items 1-3 require careful work + native config + a build
(not an OTA) and should land in a dedicated Phase 405-follow-up. Items
4-5 require substantial new UI in the play tab. Items 8-13 are
polish that can be picked up incrementally.

Empirical Z-Fold round-day verification deferred to the post-follow-up
pass — verifying 18 holes + battery + phone-in-pocket needs the
foreground-service work to land first.
