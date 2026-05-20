# Phase 420 — Tool Verification Matrix

**Audit date:** 2026-05-20
**Bundle commit:** `e872f9b`
**Scope:** Eight core user-facing tools. Per-tool: code presence, UI wiring, on-device verification, known issues, and an honest trust level (1–5).

## Trust scale

- **5** — Verified working on a real Z Fold round within the last 7 days. No known open bugs.
- **4** — Code is canonical, no fabrication risk, last empirical pass was within 1–2 phases. Would bet on this holding up today.
- **3** — Structurally complete. Single recent regression risk, OR not empirically tested on the current bundle.
- **2** — Code complete but multiple known seams, placeholders, or unproven dependencies. Real possibility it falls over on first contact.
- **1** — Present but broken or wholly unverified. Don't put it in front of a tester.

---

## Matrix

| # | Tool                        | Code present | Wired to UI                                                   | Verified on device                                | Known issues / open bugs                                                                                                                       | Trust |
|---|----                         |---           |---                                                            |---                                                |---                                                                                                                                              |---    |
| 1 | **SmartFinder**             | YES          | Caddie tab More-menu (`app/(tabs)/caddie.tsx:3123`); rangefinder-button in caddie tools row (`:2285`); tool-action `open_smartfinder` from voice (`:885-890`); from L1HolePreview (`:1916`) | UNVERIFIED — pinch-zoom rewrite (`f1a9100`) not exercised on device  | Pinch-zoom regression risk on new Gesture API stack; non-curated courses' cart-marker direction untested            | 3     |
| 2 | **SmartVision**             | YES          | Tool-action `open_smartvision` (`app/(tabs)/caddie.tsx:797,809`); SmartVisionContext mounted in `app/_layout.tsx:8`                                  | UNVERIFIED on current bundle                       | 1351-line single screen; last hot-path read was Phase 108. Player-cart marker is harness-only verified.                                          | 3     |
| 3 | **Auto club detect**        | YES (vision + spoken parser) | Cage mode photo capture `components/cage/ClubIdentifyControls.tsx:146` → `recognizeClubFromUri`; voice intent via `services/intents/clubHandler.ts:52` → `parseSpokenClub`            | UNVERIFIED                                          | NO call site exists outside Cage Mode. Round-mode auto-club from a shot photo is NOT wired today. `services/clubRecognition.ts:97-139` tracks failure events but no UI surfaces them. | 2     |
| 4 | **SmartMotion**             | YES (Phase 416 + 418) | SwingLab tab; tool-action `record_swing` → `/swinglab/quick-record`; direct from `/swinglab/smartmotion`        | UNVERIFIED — Phase 418 validation gate untested on a real no-swing clip   | Pose-skeleton overlay is a documented SEAM (`smartmotion.tsx:14-21`, `services/poseInference.ts` scaffolded but unwired). "Tag Club" button is a no-op TODO (`smartmotion.tsx:225`). Shot Tracer overlay toggle is a placeholder. | 3     |
| 5 | **TightLie**                | YES          | Single launcher: Caddie tab tools row `app/(tabs)/caddie.tsx:2345-2360`. Old duplicates removed in Phase AU. Voice intent `tightlie` (`api/voice-intent.ts:27`) routes through `services/intents/openToolHandler.ts` | UNVERIFIED on current bundle           | Sonnet vision quality is photo-dependent; save-for-later path never empirically exercised with a real network outage.                              | 3     |
| 6 | **GPS**                     | YES          | `startGpsManager()` from round-active subscriber (`app/_layout.tsx:495-531`); subscribers in SmartFinder, holeDetection, shotDetectionService, manual-mark | PARTIAL — harness-verified (Phase AU.1 v2 `73b2f95`); on-course UNVERIFIED for current bundle  | Background-location task is now lazy-registered (`_layout.tsx:22-28`); fix is correct on inspection. Adaptive mode transitions (active/walking/stationary) untested on a current real round. | 4     |
| 7 | **Manual Mark**             | YES          | Caddie tab Mark button (`app/(tabs)/caddie.tsx:2313-2335`); More-menu (`:3140-3168`); voice intent in `useVoiceCaddie.ts` / `useKevin.ts`            | UNVERIFIED on current bundle                       | Single canonical entry `forceMarkPosition()` (positionMarkBus.ts:71-112); shot-location correction within 60s of last shot is structural but UNVERIFIED.                                              | 4     |
| 8 | **Health Connect motion (Phase 413)** | YES   | Used by `services/walkingDetector.ts` (steps); read in `store/roundStore.ts:476,974` for round-summary enrichment              | UNVERIFIED — needs Galaxy Watch + Health Connect grant flow on device   | iOS path is stubbed (every reader returns empty/zero on `Platform.OS !== 'android'`). `react-native-health-connect` requires an EAS Build, not OTA (per user-memory `beta-wearables-sdk-access`). | 2     |

---

## Per-tool detail

### 1. SmartFinder

- **Code:** `app/smartfinder.tsx` (1323 LOC), `services/smartFinderService.ts` (469 LOC), `services/courseGeometryService.ts`, `services/courseGreenOverrides.ts`.
- **Recent commits touching it:** `f1a9100` pinch-zoom rewrite to Gesture API, `2fd7f4d` voice callout + yardage sanity clamps, `a88336f` Standard mode F/M/B strip + pinch zoom, `21ac303` seed F/M/B offsets so distances differ along bearing axis.
- **Trust 3** because the pinch-zoom rewrite is recent and unproven. Math + GPS plumbing inherits Phase 400 sign-off.

### 2. SmartVision

- **Code:** `app/smartvision.tsx` (1351 LOC), `services/smartVisionOverlay.ts`, `data/palmsImages.ts`, `data/localCourseImages.ts`.
- **Recent commits:** `62acc2f` cart marker direction-correct on curated photos; `f6f3b34` reactive run state + live player dot on companion preview; `46fd9b1` persona handoff welcome + L1HolePreview cart direction fix.
- **Trust 3** — code path is reasonable but last empirical sweep was Phase 108 / 401.

### 3. Auto club detect

- **Code:** `services/clubRecognition.ts:71-220`, `services/intents/clubHandler.ts:52`, `components/cage/ClubIdentifyControls.tsx:146`, `components/cage/ClubPickerModal.tsx`.
- **API:** `api/club-recognition.ts`.
- **Trust 2** — recognised primarily in Cage Mode photo flow. No round-flow auto-detection from a shot capture today. Telemetry exists for failure modes (`services/clubRecognition.ts:97,121,135,139`) but no UI surfaces it.

### 4. SmartMotion (Phase 416 + 418)

- **Code:** `app/swinglab/smartmotion.tsx` (1127 LOC), `services/swingValidity.ts` (69 LOC), `services/poseDetection.ts` (484 LOC, cloud path), `services/poseInference.ts` (140 LOC, MoveNet SEAM), `api/swing-analysis.ts`.
- **Phase 418 validation gate:** Single source of truth at `services/swingValidity.ts:47-64`. Consumed at `smartmotion.tsx:116-119` and gates overlays at `:291`.
- **Trust 3** — Phase 418 gate is correct on inspection; "Tag Club" is TODO; pose-skeleton is a placeholder. Phase 418 fix is good but unverified on a real no-swing capture.

### 5. TightLie

- **Code:** `app/lie-analysis.tsx` (433 LOC), `services/lieAnalysisService.ts` (141 LOC), `services/lieAnalysisContext.ts`, `api/lie-analysis.ts`.
- **Single entry path:** `app/(tabs)/caddie.tsx:2345-2360`. Phase AU removed duplicates.
- **System-prompt threading:** `pendingLieAnalysis` flows from roundStore through `useKevin.ts:139-143` to `api/kevin.ts:148-217`. Phase 409.
- **Trust 3** — vision quality bottleneck is the model, not code.

### 6. GPS

- **Code:** `services/gpsManager.ts` (604 LOC), `services/simulatedGPS.ts` (784 LOC), `services/backgroundLocationTask.ts` (lazy-registered), `services/gpsAudit.ts`, `app/gps-test.tsx`.
- **Adaptive subscription:** `startGpsManager()` at `gpsManager.ts:387-416`. Modes at lines 343-379. Outlier rejection at `processFix` (line 128).
- **Harness:** `73b2f95` Phase AU.1 v2 (12 scenarios), `8f8add2` Test Bench live + stall watchdog.
- **Trust 4** — harness gives me higher confidence here than other tools.

### 7. Manual Mark

- **Code:** `services/positionMarkBus.ts` (112 LOC) — single entry point `forceMarkPosition()` at line 71.
- **Subscribers wired in `app/_layout.tsx:448-489`** — SmartFinder seeding, shot-location correction, hole-detection nudge.
- **Trust 4** — small, well-instrumented (`[path2:round] mark`, `[audit:mark]`, `[audit:gps]` telemetry breadcrumbs), single canonical entry.

### 8. Health Connect motion (Phase 413)

- **Code:** `services/healthData.ts` (251 LOC). Lazy import of `react-native-health-connect`. iOS path stubbed.
- **Wired into:** `services/walkingDetector.ts:27,62` for steps; `store/roundStore.ts:476,974` for round-summary enrichment.
- **Trust 2** — wearables SDK changes need an EAS Build (not OTA) per `~/.claude/projects/-Users-timothyg-smartplaycaddie/memory/beta-wearables-sdk-access.md`. Permission flow is wired but never empirically exercised end-to-end on a Galaxy Watch.

---

## Trust totals

- **Trust 4+:** 2 of 8 (GPS, Manual Mark)
- **Trust 3:** 4 of 8 (SmartFinder, SmartVision, SmartMotion, TightLie)
- **Trust 2:** 2 of 8 (Auto club detect, Health Connect motion)
- **Trust 1:** 0 of 8

**Net read:** the round-critical bedrock (GPS + Mark) is the most trustworthy thing in the app. The five tools that wrap that bedrock (SmartFinder, SmartVision, SmartMotion, TightLie) are structurally complete but **none has a fresh on-device sign-off in the current bundle.** Auto club detect and Health Connect motion are the two tools you should NOT lean on for a tester demo until they get their MIN VERIFY pass.

---

## Single highest-leverage action

A 60–90 minute Z Fold session running PATH 1-4 MIN VERIFY (per `docs/audit-100-critical-paths.md`) + a 10-minute Phase 418 no-swing fabrication test would convert four Trust 3 entries to Trust 4. No code change required.
