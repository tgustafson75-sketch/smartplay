# Audit 107 — GPS Framework + SmartFinder Math

Phase 107 deliverable. Reads `services/gpsManager.ts`, `services/smartFinderService.ts`, `services/courseGeometryService.ts`, `services/holeDetection.ts`, `services/positionMarkBus.ts`, `utils/geoDistance.ts` and reports findings + fix decisions.

## Current architecture

**`gpsManager.ts`** — adaptive single-watch subscription. Three modes:
- `active` (1Hz, `BestForNavigation`) — bumped on shot intent for 60s
- `walking` (10s, `Balanced`) — default
- `stationary` (20s, `Low`) — after 90s of no >5m motion

`distanceInterval: 2` meters globally. Subscribers receive raw fixes via `subscribe(cb)`.

**`smartFinderService.ts`** — owns `lastFix` (player position cache). Provides:
- `refreshFix()` — calls `gpsManager.getOneShotFix()` and updates `lastFix`
- `setMarkedFix()` — Mark handler writes player coordinates
- `setSimulatedFix()` — test harness override
- `getGreenYardagesSync()` — reads `lastFix` + `roundStore.courseHoles[hole]` (front/middle/back coords) and returns yardages via `haversineYards`

**`utils/geoDistance.ts`** — Haversine implementation, M/Y conversion, bearing, axis projection.

## Findings

### B1 — BLOCKING: gpsManager subscribers not wired into smartFinderService

`gpsManager` publishes 1Hz fixes during active mode. `smartFinderService` does NOT subscribe to those updates — `lastFix` only refreshes on:
1. Mark handler (`setMarkedFix`) — user explicitly taps Mark
2. Explicit `refreshFix()` call (caddie.tsx open, etc.)
3. Simulated GPS test harness

**Result:** yardages don't auto-update as the user walks. The Phase 107 spec C7 says: *"yardages update on movement automatically (continuous subscription)"*. That's not currently true. Yardages only refresh on Mark or screen-open.

**Fix:** subscribe smartFinderService to gpsManager during round-active. Each fix updates `lastFix`. Yardage consumers (caddie.tsx data strip, SmartFinder card) re-render via the existing `markTick` mechanism extended to also tick on auto-update.

### B2 — SIGNIFICANT: no outlier rejection

Every GPS fix is accepted as-is and propagated to subscribers. A single bad reading (accuracy 30m+, position jump 100m+ between consecutive fixes) lands directly in `lastFix` → next yardage computation is wildly off.

**Fix:** in the gpsManager watch callback, reject fixes where:
- `accuracy_m > 15` (Phase 107 spec threshold)
- distance from previous accepted fix > 50m within 5s window (impossible motion)

Discarded fixes get a `[gps:outlier-rejected]` telemetry log so Tim can see them in Metro.

### B3 — SIGNIFICANT: no position smoothing

Each fix delivered raw. Even good GPS jitters by 2-5m at rest. A 3-fix rolling average reduces visible noise without meaningful latency cost.

**Fix:** maintain a 3-fix ring buffer of recently accepted fixes; published fix is the average. Bump-to-active resets the buffer. Mark forces a clean unsmoothed write (Mark wants the raw current position, not a smoothed history).

### B4 — MINOR: stationary mode doesn't auto-recover to walking

`evaluateMode` (every 5s) handles:
- `active` → `walking` after 60s of no shot intent
- `not stationary` → `stationary` after 90s of no >5m motion

But missing: `stationary` → `walking` when motion resumes. Once stationary, we poll at 20s with `Low` accuracy until something else (shot bump, Mark) wakes it. A mid-round walk between shots gets stuck on stale 20s polling.

**Fix:** in the watch callback, if a fix shows >5m motion and current mode is `stationary`, set mode `walking`.

### B5 — SIGNIFICANT: 'walking' mode uses `Balanced` accuracy

`Balanced` on Android is ~100m accuracy in practice. For golf yardages we need consistent <10m readings. Walking between shots is when the user studies their next club — the SmartFinder card on caddie home is most-glanced-at during this window.

**Fix:** change `walking` from `Balanced` to `High`. Battery cost is real but acceptable — the player's not stationary so they're already in active golf mode.

### B6 — WIN: Haversine vs Vincenty precision

`haversineYards` uses spherical Earth (R = 6,371,000 m). The actual Earth is an oblate spheroid; the spherical approximation introduces ~0.5% error in distance. At 200 yards that's ~1 yard error worst case. At 100 yards, ~0.5 yards. Within Garmin tolerance, but on the edge.

Vincenty's formulae use the WGS-84 ellipsoid for sub-millimeter precision over a few hundred miles. For golf yardages (a few hundred yards max), Haversine is already inside Garmin's typical 1-yard tolerance.

**Decision: KEEP Haversine.** The 0.5% error is below Garmin tolerance and below typical course-geometry error from golfcourseapi (which often has front/middle/back greens off by 5-10 yards). Adding Vincenty wouldn't move the needle. If empirical testing shows a consistent multi-yard delta vs Garmin, revisit.

### O1 — OBSERVATION: course geometry is the actual ceiling

golfcourseapi populates `frontLat/Lng`, `middleLat/Lng`, `backLat/Lng` per hole when available. When unavailable (the typical case per Phase B field findings), every yardage returns null and consumers render an empty state.

Course-geometry quality is the dominant accuracy ceiling. A perfectly precise GPS reading distance-d to a green-coord that's off by 5m is wrong by ~5y. Phase 107 fixes everything client-side; further accuracy gains beyond Garmin tolerance need course-geometry verification, which is a separate per-course audit (Tim hand-corrects via the courseGeometryOverride store).

### O2 — OBSERVATION: hole detection is a separate concern

`holeDetection.ts` tracks which hole the player is on (auto-advance based on proximity to next tee). Phase 107 doesn't touch this — it's already passing per Phase BG. The yardage path assumes hole detection is correct; if hole transitions misfire, yardages render against the wrong green.

## Fix sequence

1. **B1** — wire gpsManager subscriber → smartFinderService (BLOCKING for Phase 107's "real-time yardage update on movement" criterion)
2. **B2 + B3** — outlier rejection + 3-fix smoothing in gpsManager (SIGNIFICANT, prerequisite for trustworthy yardages)
3. **B4** — stationary → walking transition on motion (MINOR but real)
4. **B5** — walking accuracy `Balanced` → `High` (SIGNIFICANT)
5. **C2** — GPS quality telemetry: per-fix accuracy logged with color-coded debug overlay component (Tim sees green/yellow/red at a glance)
6. **C8** — edge case audit (GPS lost, missing geometry, off-course) — confirm existing handling is graceful; document gaps if any

## Empirical verification plan (Tim, Galaxy Z Fold + Garmin)

Phase 107 / Component 6 calls for the Garmin comparison test. After fixes ship:
1. Tee box: both Garmin and SmartFinder show distance to green centre. Delta target: ≤2-3 yards.
2. Mid-fairway: same comparison.
3. 100 yards from green.
4. 50 yards from green (where small errors matter most).
5. Around the green at various positions.

Document deltas in a follow-up file. Acceptable: ≤2-3 yards consistent. Unacceptable: 5+ yard variance or unpredictable variance.

If unacceptable, the failure mode tells us the fix:
- Course-geometry off (consistent delta same direction at every position) → manual override via courseGeometryOverrideStore
- GPS-quality intermittent (variance only at certain spots) → revisit accuracy mode + outlier threshold
- Math precision (consistent small under/over-read) → Vincenty becomes worth doing

## What this phase does NOT change

- Hole detection logic (Phase BG already verified)
- Foreground service for round mode (already in place per BA-FOUNDATION)
- Permission state handling (Phase 100 audit confirmed this is sound)
- SmartVision overlay (Phase 108)
- Shot tracking (Phase 109)
