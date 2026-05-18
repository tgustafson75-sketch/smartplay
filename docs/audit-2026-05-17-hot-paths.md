# Hot-Path Audit — Round Flow + Render Paths

The functions called every round / every shot / every render. Five
files own the live state machine plus two screens own the live
render. Per-file function inventory + concerns; cross-cutting issues
at the bottom.

## Round lifecycle overview

```
User picks course on Play tab
  ↓
roundStore.setPendingStartCourse(id)
  ↓
Caddie tab consumes pendingStart → roundStore.startRound()
  ↓
  ├─ shotDetectionService.start()
  │     └─ gpsManager.startGpsManager()  (subscribes to expo-location watch)
  │     └─ smartFinderService.startSmartFinderGpsTracking()  (subscribes to gpsManager)
  ├─ holeDetection.startHoleDetection()  (4s poll timer, gated on isRoundActive in _layout)
  ├─ walkingDetector.startActivityTicker()  (30s poll, reads Health Connect + gpsManager)
  └─ Health Connect JIT permission ask (first round only)
  ↓
Round-active loop:
  gpsManager.subscribe(fix) → shotDetectionService.ingest(sample)
                            → smartFinderService.lastFix mirror
                            → smartFinderService notifies fixChangeListeners
  gpsManager.subscribe(fix) → holeDetection.tick (every 4s)
                              └─ may emit auto-transition to next hole
  shotDetectionService.evaluate(samples) → ShotEvent emit
                                          → orchestrator.handleShotEvent()
                                          ├─ isEffectiveCartMode gate
                                          ├─ getPromptDelayMs() (random 5–15s)
                                          └─ runFlow() → parseUtterance() → logShot()
  ↓
endRound:
  ├─ closeHoleEndLocation(finalHole, green)
  ├─ build RoundRecord
  ├─ push to roundHistory (persisted)
  ├─ push score differential, recompute handicap_index
  ├─ async readHealthSnapshot → enrichLastRoundWithHealth()  (fire-and-forget)
  ├─ async generateRecap()                                    (fire-and-forget)
  ├─ shotDetectionService.stop()
  │     └─ stopSmartFinderGpsTracking()
  │     └─ gpsManager.stopGpsManager()
  ├─ holeDetection.stopHoleDetection()  (via _layout subscription)
  └─ walkingDetector.stopActivityTicker()
```

## `store/roundStore.ts` (1356 lines)

The single source of truth for an active round. Zustand store +
persisted history. Hosts ~30 setters + a dozen derived getters.

### Round lifecycle methods
| Method | Signature | What |
|---|---|---|
| `startRound` | `(course, holes, options) => void` | Sets active flags, generates `roundId`, carries plans matching `courseId`, fires JIT health permission ask, fires geometry pre-warm, GPS + shot-detection orchestration. Called from Play tab, briefing, Caddie tab. |
| `endRound` | `() => string` | Closes final shot end_location, builds RoundRecord, full state reset, fires recap generation, handicap diff push, points emit, fires-and-forgets health enrich + activity-ticker stop. Returns record id. |
| `discardRound` | `() => void` | State reset without persist/recap/handicap; tears down shotDetection. |
| `enrichLastRoundWithHealth` | `(health) => void` | Patches the most recently saved RoundRecord with health snapshot. No-op when `hasWatchData=false`. Called from `endRound`'s own async block. |

### Hole / shot state methods
| Method | Signature | What |
|---|---|---|
| `setCurrentHole` | `(hole) => void` | Clamps 1..maxHole; closes previous hole's end_location to green centroid; notifies `holeDetection.noteManualOverride` + `gpsManager.bumpToActive('hole_change')`. |
| `logShot` | `(shot) => void` | Enriches with start/end location back-fill, indices, copies pendingLieAnalysis, clears the pending slot if consumed. |
| `editShot` / `deleteShot` / `bulkLogShots` | | Post-hoc shot management; `deleteShot` re-numbers `shot_in_hole_index`. |
| `closeHoleEndLocation` | `(hole, endLoc) => void` | Sets `end_location` on the last shot of `hole` if not already set. Called from `endRound` and `setCurrentHole`. |
| `addPenalty` | `(hole) => void` | Builds synthetic `ShotResult` w/ `outcome: 'manual_penalty'` and calls `logShot`, then bumps scores[hole]+1. |
| `logScore` / `logPutts` | `(hole, n) => void` | Score/putts map setters. |

### Derived getters
| Getter | What |
|---|---|
| `getCurrentPar` | Par for the current hole from `courseHoles`. |
| `getTotalScore` | Sum of `scores`. |
| `getHolesPlayed` | `Object.keys(scores).length`. |
| `getScoreVsPar` | Sum of `score - par` over holes with score > 0. |
| `getCurrentHoleData` | The CourseHole for `currentHole`. |

### Concerns (real)

1. **`endRound` computes `scoreVsPar` twice differently.** Lines
   721–725 build the record's `scoreVsPar` by summing `score - par`
   over *all* holes in `scores`. The `getScoreVsPar()` getter does
   the same calc but gates on `score > 0`. The record's value
   includes 0-scores against par, which inflates over-par when a
   hole has been logged with score `0` (e.g. an in-progress hole
   that was never finalized). **Where this matters:** the
   handicap differential push downstream uses the record's value.
2. **`partialize` is incomplete.** Comment at line 1301 admits five
   fields were previously missing from persist; still missing:
   `pendingLieAnalysis`, `selectedTee`, `goal`. Crash mid-round
   loses these. Easy fix: add to the partialize object.
3. **`addPenalty` calls `logShot` which consumes
   `pendingLieAnalysis`.** A penalty shot will steal the
   pending-lie slot. Probably not desired — penalties aren't
   really shots. Recommend: write penalty shot directly to the
   array without routing through `logShot`.
4. **`bulkLogShots` triggers N store updates** instead of one.
   Cheap today; could become an issue if the recap import path
   ever bulk-loads 100+ shots.
5. **Hardcoded handicap fallback values** (line ~850):
   `courseRating = 72.0`, `slopeRating = 113`. The "neutral
   baseline" comment is accurate but a course harder than neutral
   pulls a player's differential toward 0 bias.
6. **Round-state survives across rounds in module-level
   singletons.** holeDetection's `lastTransitionAt`, gpsManager's
   `poorAlertedAt`, smartFinder's `calcLog` all carry over. Not
   bugs, but the first action of round N+1 sees state from round
   N. Worth tracking when chasing intermittent bugs.

### Concerns introduced by this session

7. **`startRound` fires THREE async fire-and-forget blocks**
   (geometry pre-warm + JIT health permission ask + activity
   ticker start). None error-bubble. If the health import path
   throws for a reason we haven't seen, only console output flags
   it. Probably fine in practice — these are best-effort.
8. **`endRound`'s health enrich is gated on
   `settings.healthDataEnabled`** via a dynamic `require` inside
   the async block. If the require throws, the enrich silently
   skips. Acceptable.

## `services/gpsManager.ts` (560 lines)

Singleton wrapping `expo-location` watch + a state machine with
three modes (`active` / `walking` / `stationary`). Adaptive polling
to balance battery vs accuracy.

### Public API
| Function | What |
|---|---|
| `startGpsManager` / `stopGpsManager` | Lifecycle; idempotent. Called by `shotDetectionService.start/stop`. |
| `subscribe(cb)` | Per-fix listener. Used by `shotDetectionService.ingest`, `smartFinderService.lastFix mirror`, `holeDetection.tick`. |
| `bumpToActive(reason)` | Force 'active' mode for 60s; resets smoothing buffer. Called on hole change, smartFinder refresh, marker drop. |
| `getCurrentMode` / `getLastFix` / `getLastBump` | Read-only state accessors. |
| `getOneShotFix(opts?)` | Returns cached fix if <10s, else `getCurrentPositionAsync`. |
| `setBatterySaverFloor(floor)` | Clamps mode so 'active' is blocked under battery saver. |
| `recalibrateGps()` | Tears down + re-prompts permission + Highest-accuracy oneshot + restart. |
| `subscribePoorSignal(cb)` | Fires once when accuracy >15m for ≥45s; rearms after recovery. |
| `ingestExternalFix(fix)` | Public ingest entry for the background-location TaskManager. |
| `getGpsStats()` | Debug overlay. |

### Concerns

1. **State NOT reset on `stopGpsManager`.** `mode`, `lastFix`,
   `lastActiveBumpAt`, `lastMotionAt`, `poorSinceTs`,
   `poorAlertedAt`, `lastBumpReason`, `lastBumpAt` all carry
   over. `poorAlertedAt` carrying over means the first poor-signal
   callout of the *next* round may be suppressed.
2. **`subscribers.clear()` in `stopGpsManager`.** Anything that
   subscribed via `subscribe()` is silently dropped.
   `shotDetectionService.stop()` already unsubs itself, but a
   future subscriber that survives a stop/start (e.g. a
   long-lived smartFinder watcher) would be dead.
3. **Module-level mutable state is not race-protected.**
   Concurrent `recalibrateGps` + `startGpsManager` would
   interleave; idempotence guard comments exist but no lock.
4. **Hardcoded magic numbers**:
   `OUTLIER_ACCURACY_M = 15`, `OUTLIER_JUMP_M = 50`,
   `SMOOTHING_WINDOW = 3`, `FIX_STALENESS_MS = 30_000`,
   `POOR_SIGNAL_SUSTAINED_MS = 45_000`. Comments say "field-tuned"
   but nothing surfaced in settings or owner tools.
5. **`recalibrateGps` partial state:** when
   `getCurrentPositionAsync` throws, it falls back to
   `startWatchInternal()` but doesn't reset `mode='active'` — the
   watch will still be configured for active even though no fresh
   fix landed.
6. **`getOneShotFix` mutates `lastFix`** with the fresh fix but
   doesn't update `lastTickAt` or notify subscribers — diverges
   from how `watchPositionAsync` ticks flow.

## `services/shotDetectionService.ts` (255 lines)

Singleton consuming `gpsManager` fixes, evaluating against the
180-second sample buffer, emitting `ShotEvent` when a stationary→
displacement→stationary pattern is detected.

### Public API
| Function | What |
|---|---|
| `shotDetectionService.start` | `async () => boolean` — wires `startGpsManager` + `startSmartFinderGpsTracking`, subscribes to `gpsManager` for fix ingestion. |
| `.stop` | Unsubs, clears samples, stops smartFinder gps + gpsManager. |
| `.on(listener)` | Subscribe to `ShotEvent`. Used by orchestrator. |
| `.ingest(sample)` | Internal entry, public for tests. Pushes sample, trims to 180s, calls `evaluate`. |
| `.configure(partial)` | Merges config; applies CART/WALK overrides when settings.cartMode toggles. |
| `.triggerManual(location?)` | Synthetic ShotEvent at last known sample (or `{lat:0,lng:0}` sentinel). |
| `getPromptDelayMs()` | Random 5–15s for orchestrator prompt timing. |

### Concerns

1. **`triggerManual` fallback to `{lat:0,lng:0}`** as a sentinel —
   then orchestrator's `resolveStartLocation` re-detects it and
   refetches. Brittle convention, three files now agree on this
   sentinel.
2. **`evaluate()` mixes `Date.now()` and `latest.timestamp`** for
   time math. On Android these can differ by tens of ms; the
   stationary-window calc is sensitive to that.
3. **`EMIT_COOLDOWN_MS = 30_000`** — two real shots within 30s
   (chip + tap-in, hurried second shot) cannot both auto-fire.
4. **`stop()` calls `stopGpsManager()`** — kills GPS for all other
   consumers. Centralization but no isolation; if a future consumer
   needs GPS without shot detection, the API doesn't allow it.
5. **`subscription` field is dead code** — `Location.LocationSubscription
   | null`, never assigned (legacy direct-Location path was
   removed). `stop()` still references it.
6. **No watchdog around `evaluate` errors** — every subscriber call
   is wrapped in try/catch with `console.log`, but if `evaluate`
   itself throws on a malformed sample, the subscriber never knows
   and the sample is silently discarded.

## `services/conversationalLoggingOrchestrator.ts` (359 lines)

State machine that turns a `ShotEvent` into a logged shot via TTS
prompt → mic capture → parse → log.

### Public API
| Member | What |
|---|---|
| `conversationalLoggingOrchestrator.start` | Subscribes to `shotDetectionService.on`. |
| `.stop` | Unsubs, clears timer, resets to idle. |
| `.configure(deps)` | Stores deps for `runFlow` (captureUtterance, apiUrl, fallback, voice config). |
| `.setSuspended(bool)` | Pauses handling without unsubbing. |
| `.triggerManual()` | Synthetic 0,0 ShotEvent + runs flow. |
| `.getState` / `.getCadenceLog` | Debug. |

### Concerns

1. **`handleShotEvent` early-returns on `state.kind !== 'idle'`.**
   If a previous flow hangs in `listening` (captureUtterance never
   resolves, no timeout), all subsequent auto-fires drop. No
   watchdog that forces state back to idle after N seconds.
2. **`captureUtterance` errors caught + treated as silence**
   (line ~182). User has no signal that mic failed.
3. **`parseUtterance` returns null on any error / non-200** →
   `logUntagged` fires. A 500 from `/api/parse-shot` produces an
   untagged shot indistinguishable from real silence.
4. **`SKIP_PHRASES` substring match.** "I had to skip the chip"
   contains "skip" → flow aborts.
5. **`resolveStartLocation` couples to the 0,0 sentinel** in
   `shotDetectionService.triggerManual`. Three files now share
   this convention.
6. **Weather attach race.** `fetchWeatherAt(...).then(updateShotWeather)`
   reads state after a network delay. If the user has ended the
   round and started a new one before the weather lands, weather
   attaches to a stale shot id (no-op by id, but the round-end
   summary already shipped without weather).
7. **`finalParsed` is dead** — the lie-followup mutation path
   referenced in comments isn't implemented; `lieQuality` is
   captured but only passed to `logParsed`/`logUntagged` as a
   trailing arg that gets ignored.

### Concerns introduced this session

8. **`isEffectiveCartMode` via dynamic require with NO try/catch**
   around the require itself (line ~132). If `walkingDetector`
   module throws on require, the shot event is lost. Wrap the
   require.

## `services/holeDetection.ts` (300 lines)

4-second polling timer that watches `smartFinderService.getLastFix()`
against the active course's per-hole tee+green coords and emits
`hole_transition` events.

### Public API
| Function | What |
|---|---|
| `startHoleDetection` / `stopHoleDetection` | Lifecycle; gated by `_layout.tsx` on `isRoundActive`. |
| `subscribeToHoleDetection(cb)` | Add listener for auto-transition events. |
| `noteManualOverride()` | Stamp manual-override time + clear position history. Called from `roundStore.setCurrentHole`. |
| `detectCurrentHole(...)` / `handleSustainedPosition(...)` | Pure-fn cores; public for tests. |

### Concerns

1. **Module-level state never reset on round start.**
   `positionHistory`, `lastTransitionAt`, `candidateHole`,
   `candidateSince` all carry across rounds within one process.
2. **`scoresByHole[N] != null` to skip "already played"** —
   `scores` only populates on `logScore`. A player who logs shots
   on hole N but no score wouldn't have hole N marked played, so
   the detector could re-recommend it.
3. **`MAX_TRANSITION_LOOKAHEAD = 2`** + hardcoded `>18` cap. 9-hole
   courses still work (sequence 1→9 advances normally) but the
   cap isn't course-aware.
4. **`handleSustainedPosition(candidateHole, windowStartMs)`** —
   `candidateHole` param is unused. Misleading API.
5. **`tick()` is `async`** but called via `void tick()` from both
   `setInterval` and `positionMarkBus`. Two interleaved ticks
   would race on `candidateHole`/`candidateSince` module vars.

## `services/smartFinderService.ts` (399 lines)

Render-path GPS + green-yardage calculator. Mirrors `gpsManager.lastFix`
locally so screens can render synchronously without async.

### Public API
| Function | What |
|---|---|
| `startSmartFinderGpsTracking` / `stopSmartFinderGpsTracking` | Lifecycle; subscribes to `gpsManager`. |
| `getLastFix` | Sync accessor. |
| `subscribeFixChange(cb)` | Listener for lastFix updates. |
| `setMarkedFix(lat, lng, accuracy_m)` | Force lastFix from Mark bus. |
| `setSimulatedFix(loc, accuracy_m=3)` / `clearSimulatedFix` / `isSimulatedActive` | Test harness. |
| `refreshFix()` | `bumpToActive` + `getOneShotFix` → update lastFix. |
| `classifyAccuracy(accuracy_m)` | strong<5, moderate<15, weak otherwise; null→none. |
| `getGreenYardages(hole?)` / `getGreenYardagesSync(hole?)` | Async / sync variants returning F/M/B yardages. |
| `distanceToPoint(target)` | Yards from current fix to arbitrary point. |
| `getYardageCalcLog()` / `clearYardageCalcLog()` | Telemetry ring buffer. |

### Concerns

1. **Two parallel `lastFix` caches** (gpsManager + smartFinder).
   Diverge when (a) `startSmartFinderGpsTracking` not running,
   (b) `setMarkedFix`/`setSimulatedFix` is called (intentionally),
   (c) `getOneShotFix` directly (only gpsManager.lastFix updates).
2. **`getGreenYardages` checks `hData` first.** If `courseHoles`
   has no record for the hole, returns `no_hole` even when
   `geometryCache` has data. Real gap for golfcourseapi-only
   courses where `courseHoles` is empty.
3. **`safeLoc` treats exact `0,0` as missing.** A course on the
   equator is unreachable; industry-standard sentinel so OK.
4. **`refreshFix` bumps GPS to active every call.** Opening
   SmartFinder + reading yardages is treated as shot intent; if
   any UI polls `refreshFix` on a timer, every poll bumps GPS
   (battery cost).
5. **`gpsUnsub` re-entry stale state.** `startSmartFinderGpsTracking`
   guards on `gpsUnsub` truthiness. If `gpsManager.stopGpsManager`
   ran without `stopSmartFinderGpsTracking`, the local `gpsUnsub`
   reference is stale-truthy and start becomes a no-op even
   though the underlying subscription was cleared.
6. **`distanceToPoint` logs a YardageCalcEntry with
   `hole_number: -1`** as a sentinel mixed into the same buffer
   as real readings.
7. **`calcLog`, `fixChangeListeners` not reset on round-end.**

## `app/smartfinder.tsx` (render path)

Reads via `getLastFix()` + `getGreenYardagesSync(hole)`. Re-renders
on `subscribeFixChange`. SVG overlay for distance arc + target
crosshair. No polygon overlay (that's SmartVision's territory).

Hot path:
1. mount → `useEffect` → `subscribeFixChange(setTick)`.
2. each fix → `setTick(t=>t+1)` → re-render.
3. `useMemo` recomputes yardages, target px coords, distance arc
   geometry.
4. user-drag on target → updates `target` state in pixels →
   `pixelsToLatLng` (in component) → new haversine yards.

Notable: the existing `rangefinder.ts` STANDARD-mode `unmeasurable`
flag (when pitch is near level) was added this session per Tim's
"every tap shows 250" finding. That fix surfaces an alert instead
of locking on the fake 250yd.

Concerns: same fix-cache duality as smartFinderService. Rapid
drag-target events at 60Hz could trigger getYardageCalcLog entry
spam.

## `app/smartvision.tsx` (render path)

Documented in detail in `docs/audit-2026-05-17-recent-changes.md`
§11. Hot-path summary:

1. mount → resolve `courseId`, `courseName` (id-first cascade
   added this session) → `useMemo` for `geometry` from
   `fetchCourseGeometry`.
2. `geometry` arrives → `computeFitView(tee, green, w, h)` →
   projection (center / zoom / bearing).
3. Mapbox satellite tile URL built with projection → fetched via
   `<Image>`.
4. SVG overlay draws (this session): fairway polygons → water →
   bunkers → tee box → green outline → tee→target line →
   target→pin line → running yardage labels → T / Y / P markers.
5. Draggable T/Y/P markers (PanResponder) update component
   pixel state, which feeds `pixelsToLatLng` for live yardage
   recomputation.
6. Side panel (landscape) renders F/M/B yardages + new
   YardageBookPanel (this session).

Hot-path concerns: yardages compute every drag tick (raf-style),
re-runs `pixelsToLatLng` + multiple haversines. Cheap per-call but
the chain is on the render path.

## Cross-cutting issues

### A. Module-level singletons carry state across rounds
- `gpsManager.poorAlertedAt`, `lastBumpReason`, `lastBumpAt`
- `holeDetection.lastTransitionAt`, `positionHistory`,
  `candidateHole`, `candidateSince`
- `smartFinderService.calcLog`, `fixChangeListeners`
- `walkingDetector._cached`, `_tickerHandle` (this session;
  `stopActivityTicker` does reset these — OK)
- `conversationalLoggingOrchestrator.cadenceLog`

Effect: the first action of round N+1 sees stale state from round
N. No race-condition severity, but worth tracking when debugging
intermittent first-shot issues. **Recommend:** dedicated
`onRoundStart` / `onRoundEnd` reset hooks on each singleton, wired
from `roundStore.startRound` / `endRound`.

### B. `{lat:0, lng:0}` sentinel for "missing location"
Three files agree on this convention:
- `shotDetectionService.triggerManual` produces it
- `conversationalLoggingOrchestrator.resolveStartLocation` detects
  it + refetches
- `smartFinderService.safeLoc` treats it as null

A course actually located at (0,0) on the equator would be
silently unreachable. Industry standard, low risk.

### C. Heavy use of `require()` for lazy / cycle-avoidance
- `roundStore` lazy-requires `toastStore`, `settingsStore`,
  `gpsManager`, `holeDetection`, `pointsStore`,
  `playerProfileStore`, `walkingDetector`, `healthData`
- `conversationalLoggingOrchestrator` lazy-requires `walkingDetector`

All wrapped in `try/catch` with console-only logging. A misnamed
import would fail silently. **Recommend:** ESLint rule against
`require()` outside of explicitly-allowed cycle-break sites; the
allowed ones get a comment annotation.

### D. Silent error swallowing
- `gpsManager`: 3+ catch-empty around subscription removal,
  every subscriber fanout, Sentry breadcrumb attach
- `holeDetection`: similar
- `conversationalLoggingOrchestrator`: capture errors → silence
- `mediaCapture`: ingestion errors → console only

Every "the round just stopped working" bug Tim has reported
ultimately traced to one of these. Not a single bug; a *pattern*.
**Recommend:** sentinel pattern — when a catch fires in a hot path,
emit a one-shot toast for owner-email accounts even if `__DEV__`
is false. Tim sees the failure in the field instead of console-only.

### E. Hot-path consumers read `useRoundStore.getState()` (not
reactive subscribe)

`smartFinderService.getGreenYardagesSync`, `holeDetection.tick`,
`shotDetectionService.evaluate` all read state imperatively. Fine
in service code but means hole-transition decisions read a
possibly-stale `currentHole` / `scores` if state was mutated
mid-tick. Probably OK in practice given setInterval timing, but
worth knowing.

### F. Hardcoded magic numbers without settings exposure

| Service | Constant | Value |
|---|---|---|
| gpsManager | `OUTLIER_ACCURACY_M` | 15 |
| gpsManager | `OUTLIER_JUMP_M` | 50 |
| gpsManager | `SMOOTHING_WINDOW` | 3 |
| gpsManager | `POOR_SIGNAL_SUSTAINED_MS` | 45_000 |
| shotDetectionService | `EMIT_COOLDOWN_MS` | 30_000 |
| shotDetectionService | sample buffer | 180s |
| holeDetection | `SUSTAINED_TRANSITION_MS` | 10_000 (implied) |
| holeDetection | poll interval | 4_000 |
| walkingDetector (new) | `WINDOW_MS` | 300_000 |
| walkingDetector (new) | `STEPS_WALK_THRESHOLD` | 200 |
| walkingDetector (new) | `STEPS_LIGHT_THRESHOLD` | 40 |
| walkingDetector (new) | `GPS_MOVE_MPS` | 0.3 |
| walkingDetector (new) | `CART_MIN_MPS` | 1.2 |

None of these are user-tunable. For an owner-only debug surface,
exposing them via a single "GPS Tuning" panel would let Tim
field-tune without rebuilds.

## Open items for your call

1. **State reset hooks** — wire `onRoundStart`/`onRoundEnd` reset on
   each singleton (gpsManager, holeDetection, smartFinder,
   orchestrator) so module-level state doesn't carry across rounds.
   Scope: ~1-2 hours.
2. **Sentinel-pattern owner-toast** for hot-path silent catches.
   Scope: ~1 hour.
3. **`scoreVsPar` double-compute fix** in `endRound` (record uses
   `score - par` including zero-scores, getter gates on score > 0).
   Scope: 10 min.
4. **`addPenalty` should not route through `logShot`** (steals
   pendingLieAnalysis slot). Scope: 15 min.
5. **`partialize` completion** — add `pendingLieAnalysis`,
   `selectedTee`, `goal`. Scope: 5 min.
6. **Wrap orchestrator's `isEffectiveCartMode` require in
   try/catch.** Scope: 5 min.
7. **Owner-only GPS tuning panel** — surface the magic numbers
   above for field tuning. Scope: ~2 hours.
8. **`recalibrateGps` mode reset** when the highest-accuracy fix
   fails — currently leaves `mode='active'` orphaned. Scope: 10 min.
