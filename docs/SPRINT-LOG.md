# SmartPlay Caddie — Consolidation Sprint Log

**Sprint goal:** clean, consolidate, kill duplication, make it intuitive, prove it works on device. Target: app ready by June.
**Sprint start date:** 2026-05-20

The full sprint plan lives in [docs/audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md). This log is the running daily record. The short "where are we right now" pointer is [docs/SPRINT-RESUME.md](SPRINT-RESUME.md).

---

## Day 1 — 2026-05-20

### Shipped today (Day 1 / Fix 1 addendum)
- **End Round "Maximum update depth exceeded" crash — FIXED** ([app/recap/[round_id].tsx:172](../app/recap/[round_id].tsx#L172)). Root cause: the `useRoundStore` selector for `roundPhotos` used an inline `?? []` fallback. When `round_photos` was `undefined` (every round without photos — Tim's synthetic rounds in particular), the selector returned a FRESH `[]` literal each evaluation. Zustand's `useSyncExternalStore` saw the new reference as a snapshot change, re-rendered, re-ran the selector, got yet another fresh `[]`, looped forever → crash. Fix: extracted `const EMPTY_PHOTOS: RoundPhoto[] = []` at module scope and use it as the fallback so the reference is stable. Same pattern Tim already fixed in `components/dev/GpsQualityOverlay.tsx` (2026-05-16 — see in-file comment there).

### Day 1 / Fix 8 — Diagnosis pass (NO FIX applied tonight)
Two harness findings investigated; both reports below. Tim verifies real-device behavior tomorrow before any fix is applied.

#### Finding 1 — Simulator stalls (1931s + 87s pauses on the latest harness log)
**Verdict: SIM-TIMER ARTIFACT. Real GPS would NOT die under the same conditions, *provided* the user has granted background location permission AND the OEM hasn't killed the foreground service.**

The sim uses a plain JS `setInterval` ([services/simulatedGPS.ts:148](../services/simulatedGPS.ts#L148)) — pure JS timer with no native anchor. Android's Doze + app-background throttling pauses JS timers; the watchdog at [services/simulatedGPS.ts:163-175](../services/simulatedGPS.ts#L163-L175) detects the gap and logs `[stalled]` but cannot prevent it. The 1931s gap is exactly this.

Real GPS path is engineered to survive Doze:
- **Foreground watch:** `Location.watchPositionAsync` in [services/gpsManager.ts startWatchInternal](../services/gpsManager.ts) — JS-callback path, foreground-only. Would also lose ticks when the app backgrounds.
- **Background path:** `Location.startLocationUpdatesAsync` registered via TaskManager in [services/backgroundLocationTask.ts:106-140](../services/backgroundLocationTask.ts#L106-L140), with `foregroundService` notification + `pausesUpdatesAutomatically: false` + `activityType: Fitness`. Task callback flows back into `gpsManager.ingestExternalFix` (same processFix pipeline as foreground).
- **Permission flow:** `Location.requestBackgroundPermissionsAsync` at [store/roundStore.ts:575](../store/roundStore.ts#L575) on round start.

Real risks on a pocketed phone:
1. **Background permission denied** → foreground service config is moot. `startLocationUpdatesAsync` won't deliver while backgrounded → phone-in-pocket goes dark.
2. **OEM battery-optimization** (Samsung One UI, Xiaomi MIUI) can kill foreground services not on the OS whitelist. Z Fold Samsung skin is aggressive — Tim has previously hit this class.
3. **Foreground watch dies** when app backgrounds — only the background task delivers fixes once the app's not in focus. Fix cadence drops from 1Hz (active) to 10s (background config).

Proposed minimal hardening (do not apply tonight — needs real-device verification first):
- **Tomorrow's verification step:** Tim starts a round on the Z Fold, grants background permission when prompted, pockets the phone for 10-15 min, then opens to confirm continuous fix cadence in the GPS Test Bench timeline (no `[stalled]` events, no large gaps in the ring buffer).
- If that passes: no app-side change needed. Sim stall is a harness-only artifact.
- If that fails (Doze killed the foreground service despite the notification): add Samsung-specific battery-optimization opt-out prompt (`PowerManager.requestIgnoreBatteryOptimizations` via a small native module or `expo-intent-launcher` deep-link to the OS settings screen).
- Sim-side hardening optional regardless: replace `setInterval` with a wake-aware ticker (`expo-keep-awake` + `AppState` listener that resyncs `lastTickMs` on foreground), so harness runs don't lose visibility to a "real" issue while the simulator is silent.

#### Finding 2 — Off-course flip at end of round (3461y from nearest hole, after H18 walk_complete)
**Verdict: HARMLESS HARNESS TEARDOWN. Not a round-end state bug; not what the End Round crash (Fix 1, `2801bf9`) was masking.**

Sequence:
1. Sim reaches final waypoint → [services/simulatedGPS.ts:322-326](../services/simulatedGPS.ts#L322-L326) logs `walk_complete` → calls `stopSimulatedWalk()`.
2. `stopSimulatedWalk()` ([services/simulatedGPS.ts:177-184](../services/simulatedGPS.ts#L177-L184)) calls `clearSimulatedFix()` — which (per Day 1 / Fix 4) flips `gpsManager.simulatedActive = false` and nulls `lastFix`.
3. The round is **still active** at this point — `walk_complete` does not call `endRound`. The off-course detector keeps polling ([services/offCourseDetector.ts:147+](../services/offCourseDetector.ts#L147)).
4. With `simulatedActive = false`, the foreground `watchPositionAsync` subscription (still alive) starts delivering real-device GPS fixes → `processFix` → `lastFix` becomes the device's actual coordinates (Tim's living room).
5. Off-course detector reads `gpsManager.getLastFix()` → haversines to every course-hole green/tee/front/back → minimum is 3461 yards because the device is 1.97 miles from the simulated course. Sustained-window threshold elapses → `setOffCourse(true)` → log fires.

This is the detector behaving correctly given the device's true location. Not a bug. Specifically:
- It is **not** state corruption left by round-end — round-end hasn't fired yet.
- It is **not** what the End Round crash was masking — the crash fired on `/recap/[round_id]` mount (`useRoundStore` selector returning a fresh `[]`), a completely different code path and trigger.
- The 3461y reading is genuine: device is 3461 yards from the nearest point of the synthetic course's geometry.

No fix needed. Optional cosmetic: `stopSimulatedWalk` could also suppress off-course logging for a few seconds after teardown (the user obviously doesn't need "off course" telemetry during the brief gap between sim end and End Round). Not worth the surface area unless it's user-visible noise — and the off-course pill on the Caddie tab is only shown during an active round AND with telemetry tab open, so it's almost certainly invisible to Tim. Defer indefinitely.

### Shipped today (Day 1 / Fix 7 addendum)
- **Hole-transition GPS refresh seam** (`app/(tabs)/caddie.tsx`, new useEffect keyed on `[currentHole, isRoundActive]`). Tim hit 2-5y upward yardage drift on holes 13/16/17 of the synthetic round; the value self-corrected within ~1 sim tick and corrected immediately on navigate-away/back. Root cause: when `holeDetection` fires → `setCurrentHole(next)` → `fmb` memo re-runs with the new hole's green coords against a `gpsManager.lastFix` from one sim-tick ago. Memo correct, fix correct, but the position lag = a small drift. Option A fix: on hole change, `await gpsManager.getOneShotFix()` (pulses real GPS if cache >10s; no-op on sim) then bump `markTick` to force the memo to recompute against whatever's freshest. Closes the seam without touching haversine, yardage math, or the GPS quality classifier. Symptoms 2 (no caddie hole announcement on harness) and 3 (stroke never exceeds 2 on harness) confirmed expected harness behavior — documented in the diagnosis, not fixed.

### Shipped today (Day 1 / Fix 5 addendum)
- **Cockpit-mode SHOTS cell ticks during the hole** (`components/caddie/CockpitCaddieScreen.tsx`). Tim flagged: "since cockpit has its own scoring and not the bottom data bar, strokes are not changing in cockpit mode." Root cause: cockpit's `useShallow` selector only watched `scores` (the final hole-score map). Harness shots write to `shots` via `logShot()` but don't touch `scores` until hole completion → SHOTS displayed "—" the whole hole. Fix: added `shots` to the selector; derived a `runningStrokeCount` mirroring the data-bar's STROKE calc; passed `scores[currentHole] ?? runningStrokeCount` to StepperPair so manual stepper edits still win (existing behavior) but the cell ticks with every logged shot when no manual override exists.

### Shipped today (Day 1 / Fix 4 addendum)
- **Collapsed 3 GPS-fix caches to a single owner in `services/gpsManager.ts`.** Root divergence: `setSimulatedFix()` and `setMarkedFix()` lived in `services/smartFinderService.ts` and only updated that file's local `lastFix`. `services/shotLocationService.ts` (via `gpsManager.getOneShotFix()`) read the canonical `gpsManager.lastFix`, which still held whatever real-device fix existed before the simulator started. Two consumers asking "where am I" got different answers — root cause of the 629,441y off-course reading and the "yardages drift up" symptom. Fix: gpsManager now owns `setSimulatedFix` / `clearSimulatedFix` / `setMarkedFix` and the `simulatedActive` flag; `processFix()` drops real GPS while sim is active; `getOneShotFix()` short-circuits to the cached fix in sim mode; `stopGpsManager()` clears `simulatedActive` on round-end. `services/smartFinderService.ts` and `services/shotLocationService.ts` became thin readers — no local cache. Existing public APIs (smartFinderService.setSimulatedFix / setMarkedFix / isSimulatedActive / getLastFix) preserved as proxies so the 7-ish call sites across `services/simulatedGPS.ts`, `app/_layout.tsx`, `services/audit/scenarioRunner.ts`, etc. don't need to change. Haversine math, yardage calc, GPS quality classifier, and adaptive subscription modes all untouched.

### Shipped today (Day 1 / Fix 3 addendum)
- **Central debug-route gate** (`app/_layout.tsx`). Single `usePathname()` watcher inside `AppNavigator` redirects non-owner (and non-`__DEV__`) access away from 11 gated routes: `/gps-test`, `/acoustic-test`, `/api-debug`, `/battery-debug`, `/cage-debug`, `/ghost-debug`, `/patterns-debug`, `/plan-debug`, `/smartfinder-debug`, `/subscription-debug`, `/voice-debug`. Reuses existing `isOwnerEmail` from `store/playerProfileStore`. Per-screen `useDebugRouteGate()` calls left in place as defense in depth.

### Shipped today (Day 1 / Fix 2 addendum)
- **Arena 404 card — REMOVED + Range Mode isolated to library** (`app/(tabs)/swinglab.tsx`, `app/swinglab/range.tsx`).
  - Arena card pulled from the SwingLab launcher entirely. The route it pointed at (`/arena/practice`) has no `app/arena/` directory — was a user-visible 404 on the SwingLab tab. Verified no remaining `/arena` references anywhere in source.
  - Range Mode's `Start Session` CTA was routing to `/cage/session` (one of the 5 duplicated swing-capture surfaces flagged in the Phase 420 duplication audit). Severed that link; Start Session now routes only to the Swing Library (`/swinglab/library`). Range Mode's UI, inputs, and pre-flight planning behavior are unchanged.

### Shipped today
- **Phase 416 cleanup** (`77014bb`) — SmartMotion direct camera, overlay toggles, integrated record button. Earlier today.
- **Tools FAB + persona-aware Kevin TTS** (`a63d1b3`) — Caddie tab giant green pill replaced with small right-side chevron that expands left into tool icons. `/api/kevin` no longer hardcodes Kevin's voice for every persona (Tim flagged: "motherfucking Kevin keeps talking for Serena too"). ElevenLabs persona routing + OpenAI gender-mapped fallback (nova for Serena).
- **Phase 418 — SmartMotion validation gate** (`3cf8d11`) — Single source of truth for "is there an analyzable swing." Pose overlay, metrics, and Insight card now share one gate; floor footage no longer produces fake skeleton or fake "82 mph club speed." Added `services/swingValidity.ts`, framing tips + retake CTA, pre-record framing guide.
- **Bundle hash bump** (`e872f9b`) — trivial change to bypass an Expo asset processor that kept timing out on the prior bundle id.
- **Phase 420 — full state-of-codebase audit** (`bb3db35`) — 12 audit docs covering structure, routes, duplication, dead code, pillars, caddie, tools, recent phases, data models, build health, UX walk, and the synthesized SPRINT MAP.
- **Phase 421 — sprint context infrastructure** (this commit) — `SPRINT-LOG.md`, `SPRINT-RESUME.md`, CLAUDE.md discipline section.

### Verified on device (Z Fold)
- **Nothing this session.** All work today is "git-diff verified" / Vercel-deploys-itself. The Tools FAB layout change and the Phase 418 client-side gating are on `main` but the OTA push to preview did not land (see Notes).

### Open / carried to tomorrow
- **OTA push for `e872f9b`** failed five times with Expo asset processor timeouts on `entry-*.hbc`. Vercel will pick up the server-side validation prompt automatically; the client-side gating is in the next EAS push (or the next APK).
- **End-Round crash** ("Maximum update depth exceeded") was flagged in the prior session and is still unverified on the current bundle. P0-4 in the Sprint Map.
- **Empirical verification debt** — Phase 416, 418, the persona TTS fix, and the Tools FAB are all unproven on a real Z Fold. Day 2 should start with on-device confirmation before any new code lands.

### Notes
- **Date drift mid-session:** the conversation began on 2026-05-19 and rolled over to 2026-05-20 mid-work. Both the persona-aware Kevin fix and Phase 418/420/421 are 2026-05-20 work; SmartMotion Phase 416 was earlier (2026-05-19).
- **Phase 418 ground truth (per request):** validation gate IS in. Files present:
  - `services/swingValidity.ts` — client-side evaluateSwingValidity() with server `valid_swing` + observation-text heuristic fallback
  - `api/swing-analysis.ts` — server emits `valid_swing` + `validity_reason`, system prompt requires validity decision FIRST
  - `app/swinglab/smartmotion.tsx` — wired to gate pose skeleton, shot tracer, metrics, and Insight card
  - `app/swinglab/quick-record.tsx` — added pre-record framing dashed-rectangle guide
  - Commit: `3cf8d11`. NOT verified on device. Server fix deploys via Vercel automatically; client fix needs an OTA or next APK build.
- **Audit headline blockers** (P0 from Sprint Map):
  1. `/arena/practice` is a 404 from the SwingLab Arena card
  2. `/swinglab/range` likely also missing — verify
  3. Two parallel SmartMotion UIs still reachable via voice-intent / Tools menu / Library
  4. End-Round crash unverified on current bundle
  5. `speaker_id` declared on Shots but never written — multi-player blocker
  6. Placeholder buttons in SmartMotion (Tag Club / Compare / View Full Data)
  7. 10 debug routes ungated for non-owners
- **One audit-agent calc error caught:** the routes audit claimed `scorecard.tsx` was 35,210 LINES. It is 772 lines (35,210 BYTES). Fixed in `docs/audit-420-routes.md` before commit. The real refactor target is `app/(tabs)/caddie.tsx` at 3,870 lines.
- **A new chat resuming tomorrow should:** read [SPRINT-RESUME.md](SPRINT-RESUME.md) first, then [audit-420-SPRINT-MAP.md](audit-420-SPRINT-MAP.md). The full audit evidence is in `docs/audit-420-*.md`.

---

## Template for future days

```
## Day N — YYYY-MM-DD

### Shipped today
- [phase / change, commit hash]

### Verified on device (Z Fold)
- [empirically confirmed]

### Open / carried to tomorrow
- [unfinished]

### Notes
- [decisions, gotchas, what a fresh chat needs to know]
```

---

## Post-Launch Tooling Ideas

Captured to clear them off the active sprint. **Not sprint work — do not build during the consolidation sprint.** Re-evaluate after 1.0 ships.

### Club-distance-aware synthetic round (harness v2)
**What:** Upgrade the synthetic round generator so it plays golf instead of walking a path. Instead of interpolating position along fractional waypoints (tee → 1/3 → 2/3 → green) per [services/simulatedGPS.ts](../services/simulatedGPS.ts), the harness steps by realistic shot distances: tee shot ~driver carry, lands at a real position, next shot the appropriate club distance, etc., until on the green. Mock round JSON carries a shot sequence per hole (club, expected carry, resulting position) with realistic dwell at each.

**Why:** Lets the FULL interconnected round system be desk-verified in one run — club selection, club yardages, stroke count, shot logging, hole transitions, and caddie club-recommendation logic all reacting to realistic shots together. The cross-component dynamics (how these pieces talk to each other) are exactly what's hard to verify piece-by-piece. Today the harness caps observed strokes at ~2 and can't exercise shot sequencing (see Day 1 / Fix 7 diagnosis Symptom 3 — the cap is the harness emitting 1 shot at mid-fairway + a burst at the green). Harness v2 fixes that.

**What it does NOT do:** Still feeds SIMULATED position, so it still cannot exercise real-GPS hardware behavior (accuracy, signal, the `getOneShotFix` pulse that the sim guard short-circuits per Day 1 / Fix 4). Real-device round remains the only proof of GPS hardware behavior. This is a logic-coverage tool, not a GPS hardware test.

**Priority:** Post-1.0. Good debugging investment, not launch-critical. Sits with the video content engine and other post-launch tooling.
