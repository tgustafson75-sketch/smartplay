# Phase 420 — Pillars State of the Union

**Audit date:** 2026-05-20
**Bundle commit:** `e872f9b` (Bump bundle hash to bypass stuck EAS asset processor)
**Scope:** ROUND (1.0 critical path), PRACTICE / SwingLab, PLAY (1.1)
**Methodology:** Read-only code inspection of pillar files, services, and recent git history. No on-device verification was performed for this audit — empirical status is inherited from prior audits and flagged UNVERIFIED otherwise.

## Status legend

- **SOLID** — code path inspected and complete; either recently exercised in audit-100/200/400/500 series, or a single canonical implementation with no obvious fabrication risk.
- **ROUGH** — code is present and structurally complete, but unproven in the field or carrying known seams / placeholders.
- **UNVERIFIED** — code present, looks correct on inspection, no recent on-device confirmation. Needs a real-device pass before claims of "works."
- **NOT IN SCOPE** — explicitly deferred per spec.

---

## 1. ROUND pillar — 1.0 critical path

The cohort of features the user touches between "Start Round" and "End Round." SmartFinder, SmartVision, TightLie, GPS, Manual Mark, hole rendering, caddie voice flow.

### 1.1 SmartFinder (Tap-to-lock rangefinder)

- **Status:** SOLID on the math + GPS plumbing, UNVERIFIED on the latest pinch-zoom rewrite.
- **Solid:**
  - `services/smartFinderService.ts:1-469` computes F/M/B yardages with three-source fallback: `getGreenOverride` → roundStore `courseHoles` → `getHoleGeometry` cache (refresh of stale golfcourseapi coords). Phase 400 audit signed this off as real data.
  - GPS quality classifier + accuracy-banded rendering — `services/gpsManager.ts:341–379` adaptive modes (active 1Hz / walking 10s / stationary 20s) with outlier rejection (>15m accuracy or >50m jump in 5s).
  - Voice callout + yardage sanity clamps: commit `2fd7f4d` (recent).
- **Rough:**
  - `f1a9100` — SmartFinder pinch-zoom rewrite to Gesture API + GestureHandlerRootView landed in the active bundle. Visual gesture flow is **UNVERIFIED on device** since the rewrite.
  - Curated photo cart-marker direction-correctness shipped in `62acc2f`; correctness on non-curated courses (Mapbox tiles) is still untested.
- **Unverified:**
  - Phase AU.1 GPS Test Harness v2 (12 scenarios, JSON export — `73b2f95`) is the canonical verification path, but harness runs are not the same as a true on-course session. No on-device cage of pinch-zoom + new gesture stack in production.
- **Key files:**
  - `app/smartfinder.tsx` (1323 LOC, Standard + Camera modes)
  - `app/smartfinder-debug.tsx`
  - `services/smartFinderService.ts`
  - `services/gpsManager.ts`
  - `services/courseGeometryService.ts`
  - `services/courseGreenOverrides.ts`
  - `services/positionMarkBus.ts` (manual mark feeds setMarkedFix here)
  - `components/smartfinder/*`

### 1.2 SmartVision (overhead hole layout)

- **Status:** SOLID code path, UNVERIFIED on phones outside the Z Fold.
- **Solid:**
  - Direction-correct cart marker on curated photos (`62acc2f`), Mapbox imagery fallback (`services/mapboxImagery.ts`), measure-yards calculation derived from same haversine util as SmartFinder.
  - Routing from `app/(tabs)/caddie.tsx:794–810` (tool-action `open_smartvision`) lands cleanly on `app/smartvision.tsx`.
- **Rough:**
  - 1351-line single screen — long render tree. Phase 108 audit (`docs/audit-108-smartvision-rendering.md`) was the last hot-path read.
  - Player-cart marker on companion preview (`f6f3b34`) ships but is reactive only inside the harness — production round flow still needs verification.
- **Unverified:** real-device SmartVision call from a current-bundle round.
- **Key files:**
  - `app/smartvision.tsx`
  - `services/smartVisionOverlay.ts`
  - `services/mapboxImagery.ts`
  - `data/palmsImages.ts`, `data/localCourseImages.ts`
  - `contexts/SmartVisionContext.tsx`

### 1.3 TightLie (camera-driven lie analysis)

- **Status:** SOLID server + client cycle, UNVERIFIED on actual on-course capture.
- **Solid:**
  - Single-flight cancel-and-replace controller on Sonnet vision (`services/lieAnalysisService.ts:30-141`). Cancellations breadcrumb to Sentry.
  - `pendingLieAnalysis` threads from `roundStore` → `useKevin.ts:139–143` → `api/kevin.ts:148-217` system prompt. Persists across mount/unmount per Phase 409.
  - Launched only from `app/(tabs)/caddie.tsx:2345-2360` "TightLie camera" button — phase AU removed the duplicated entry points so there's a single launcher.
- **Rough / Unverified:**
  - Vision call is real but quality of `situation_description` / `tactical_advice` is bottle-necked on the model's photo-interpretation. Phase 409 audit (`docs/audit-409-tightlie-state.md`) is the last full read.
  - Save-for-later path (`app/lie-analysis.tsx:169`) is wired but never empirically tested with a network outage.
- **Key files:**
  - `app/lie-analysis.tsx` (433 LOC)
  - `services/lieAnalysisService.ts`
  - `services/lieAnalysisContext.ts`
  - `api/lie-analysis.ts`

### 1.4 GPS

- **Status:** SOLID adaptive subscription, SOLID simulator, harness-verified, on-course UNVERIFIED for the current bundle.
- **Solid:**
  - `services/gpsManager.ts:387-416` startGpsManager + 5s evaluateMode tick.
  - Cart-mode threshold shortening (`shotDetectionService.configure({ cartMode })` wired from `_layout.tsx:495-531`).
  - `services/simulatedGPS.ts:1-784` drives every consumer via the same setSimulatedFix interface; consumers never know they're simulated.
  - GPS Test Harness v2 — `73b2f95`, `25eceb0` — 12 scenarios with JSON export. Live GPS subscription + sim stall watchdog at `8f8add2`.
  - Battery-saver floor (`setBatterySaverFloor`) wired from `services/batteryMonitor.ts`.
- **Rough:**
  - `8f8add2` GPS Test Bench fixed a stall in the sim — production stall risk on real GPS (e.g. Android Doze) is structurally addressed but UNVERIFIED on a real round.
  - Background-location task is now lazy-registered (`_layout.tsx:22-28`); the prior side-effect import caused a white-screen boot on Phase 405 wave 4. Lazy path is correct on inspection but UNVERIFIED.
- **Key files:**
  - `services/gpsManager.ts` (604 LOC)
  - `services/simulatedGPS.ts` (784 LOC)
  - `services/backgroundLocationTask.ts`
  - `services/gpsAudit.ts`
  - `app/gps-test.tsx`

### 1.5 Manual Mark

- **Status:** SOLID single entry point, well-instrumented.
- **Solid:**
  - `services/positionMarkBus.ts:71-112` `forceMarkPosition()` is THE entry. Gates on `isRoundActive`, requests permission, races a 6s timeout, broadcasts to listeners.
  - Phase 405 wave 4 — shot-location correction when Mark fires within 60s of a shot (`_layout.tsx:444-489`).
  - SmartFinder seeds `lastFix` from the mark via `setMarkedFix` (wired in `_layout.tsx:39-40` import + `:451-453` call).
  - Telemetry breadcrumbs: `[path2:round] mark hole=X accuracy=Y subscribers=N`.
- **Rough:** None observed.
- **Key files:**
  - `services/positionMarkBus.ts` (112 LOC)
  - `app/(tabs)/caddie.tsx:2313-2335` (Mark button) and `:3140-3168` (More-menu)

### 1.6 Hole rendering / hole detection

- **Status:** SOLID detection logic, UNVERIFIED on current bundle.
- **Solid:**
  - `services/holeDetection.ts:1-317` sustained-position threshold (10s), 30-yard separation, GPS-quality freeze, sequence-aware. Phase Q.5b.
  - Manual override `useRoundStore.setCurrentHole()` preserved — service only fires automatic transitions.
  - Synthetic-round harness (`30106e7`) bypasses detection for ground-truth transitions during dev replay.
- **Rough:**
  - Auto-advance during a real round was last verified pre-`8dd078f` (harness era). Production hole transitions on a current bundle are UNVERIFIED.
- **Key files:**
  - `services/holeDetection.ts`
  - `services/courseGeometryService.ts`
  - `services/offCourseDetector.ts`

### 1.7 Caddie voice flow (in-round)

- **Status:** Phase 420 just patched the worst bug (Kevin voice for non-Kevin personas). Now SOLID on inspection — UNVERIFIED on every persona end-to-end.
- **Solid:**
  - Persona-aware TTS now lives in both `api/voice.ts:9-65` AND `api/kevin.ts:937-1004` (commit `a63d1b3`, 2026-05-20). Each persona has its own ElevenLabs voice ID + tuned voice_settings.
  - `services/voiceService.ts:614-622` reads `caddiePersonality` from settings store at request time and threads as `persona` to `/api/voice`.
  - Three-tier hook stack: `hooks/useKevin.ts:106` and `hooks/useVoiceCaddie.ts:482` both POST to `/api/kevin` with persona context. `services/listeningSession.ts:283,334` calls `/api/kevin` for the earbud/coach path.
  - Filler library cache key bumped to `persona_lang_v4` to force regen.
- **Rough:**
  - **No single brain abstraction.** Five separate fetch sites build their own request bodies (see audit-420-caddie.md). Adding a new field requires touching all five.
  - Per-persona ElevenLabs voice settings are duplicated literally between `api/voice.ts:41-46` and `api/kevin.ts:951-956`.
- **Unverified:**
  - Every persona must produce a distinct, recognizable voice end-to-end on device. Was last in PATH 4 audit-100 — UNVERIFIED for current bundle.
- **Key files:**
  - `services/voiceService.ts` (719 LOC)
  - `hooks/useKevin.ts` (183 LOC)
  - `hooks/useVoiceCaddie.ts` (1008 LOC)
  - `services/listeningSession.ts`
  - `api/voice.ts`, `api/kevin.ts`, `api/brain.ts`

### ROUND pillar verdict

The 1.0 critical path is code-complete with a single 420 voice fix landing same-day as this audit. Every screen-level capability exists. **No piece is verified end-to-end on the current bundle.** PATH 1-4 from `audit-100-critical-paths.md` remain the canonical MIN VERIFY scenarios. External beta is BLOCKED until those four paths run green on a real Z Fold round within 7 days.

---

## 2. PRACTICE / SwingLab pillar

Same product surface, divided into capture → analysis → drills.

### 2.1 SmartMotion two-card system (Phase 416)

- **Status:** SOLID UI + cloud insight integration. Pose-skeleton overlay is a SEAM (placeholder line).
- **Landing commits:**
  - `2a30736` — Phase 416 two-card system (UI + cloud insight integration).
  - `77014bb` — SmartMotion cleanup: direct camera, overlay toggles, integrated record.
  - `3cf8d11` — Phase 418 SmartMotion validation gate stops fabrication on no-swing footage.
  - `e872f9b` — bundle hash bump (2026-05-20) to dislodge stuck EAS asset processor; included a trivial swingValidity.ts comment edit.
- **Solid:**
  - `app/swinglab/smartmotion.tsx:80-109` mounts a single `analyzeSwing()` cloud call against the active clipUri. Result lands in `analysis` state and feeds both Card 1 (Visual) and Card 2 (Insight).
  - Card 2 insight is REAL: derived from pose-analysis cloud response, not fabricated.
  - Phase 418 validation gate (`services/swingValidity.ts:42-69`) — single source of truth `evaluateSwingValidity()`. Pose overlay, metrics strip, and Insight card all consume the SAME validity flag so they can't contradict each other (prior bug: skeleton + fake 82 mph club speed on floor footage while the caddie correctly said "no player visible").
  - Server side: `api/swing-analysis.ts` Phase 418 emits `valid_swing` + `validity_reason` directly. Client-side heuristic fallback (NO_SWING_PHRASES at swingValidity.ts:20-40) catches older API responses.
- **Rough:**
  - Pose-skeleton overlay is a placeholder line — `services/poseInference.ts:1-140` is scaffolded but unwired. Header comment at smartmotion.tsx:14-21 explicitly notes the SEAM: "real keypoint extraction lives in services/poseInference.ts which is scaffolded but unwired — the MoveNet integration ships with the next APK build when the TFJS + expo-gl deps install cleanly."
  - `app/swinglab/smartmotion.tsx:225` "TODO: club tag sheet" — Tag Club button is a no-op.
- **Unverified:**
  - Phase 418 gate: was the validation actually triggered by a no-swing capture and seen suppressing fabrication on device? Code path correct on inspection; UNVERIFIED on device.
- **Key files:**
  - `app/swinglab/smartmotion.tsx` (1127 LOC)
  - `app/swinglab/quick-record.tsx`
  - `app/smartmotion-quick.tsx`
  - `services/swingValidity.ts` (69 LOC, Phase 418)
  - `services/poseDetection.ts` (484 LOC, cloud)
  - `services/poseInference.ts` (140 LOC, MoveNet SEAM)
  - `api/swing-analysis.ts`

### 2.2 Capture (camera path)

- **Status:** SOLID structurally.
- **Solid:**
  - Direct-camera launch via `router.push('/swinglab/quick-record')` from the NoClipHero (`smartmotion.tsx:185`).
  - Overlay toggle row at smartmotion.tsx:150-174 (Body Mechanics / Shot Tracer / Grid). Shot Tracer is itself a SEAM until a tracer pipeline lands.
  - `services/mediaCapture.ts`, `services/swingCapture.ts` provide capture primitives.
- **Rough:**
  - Acoustic impact detector + strikeDetector (`services/sensing`, `services/swing/strikeDetector.ts`) are present but their integration into the SmartMotion live-capture flow is harness-only.

### 2.3 Drill library

- **Status:** SOLID listing path; UNVERIFIED on whether drill recommendations actually fire from a real swing.
- **Solid:**
  - `app/drills/index.tsx` + `app/drills/[issue].tsx` route a drill key to a per-drill detail screen.
  - `services/drillRecommendation.ts` builds drill suggestions.
  - SmartMotion Insight card passes `onPressDrill={(drillKey) => router.push('/drills/${drillKey}')}` (`smartmotion.tsx:212`).
- **Rough:** drill-recommendation quality and coverage was last touched in the Phase 403b audit (`docs/audit-403b-smartmotion-analysis-state.md`).

### 2.4 Phase 418 validation gate (anti-fabrication)

- **Status:** SOLID single source of truth. Hooked into both the Visual card overlays and the Insight card.
- **Key lines:**
  - `smartmotion.tsx:116-119` — `const validity = useMemo(() => evaluateSwingValidity(analysis), [analysis]);`
  - `smartmotion.tsx:291` — `const overlaysGated = !analyzing && validity.valid;` — overlays stay off during analysis AND when validity is false.
- **Solid:** the gate exists in exactly one place and every fabrication-prone surface routes through it.
- **Unverified:** end-to-end test on a real "no swing" clip on device.

### 2.5 Cage Mode

- **Status:** Structural fixes shipped through BX (`1e47e6a`), BV (`08f0803`), BW (`eb6a587`), BY-quick (`9a20264`), BZ-v1 (`94e7d29`). UNVERIFIED on current bundle.
- **Key files:**
  - `app/cage/*`, `app/swinglab/cage-drill.tsx`
  - `components/CageSessionOverlay.tsx`, `components/cage/*`
  - `services/cage-analysis/`, `services/cageApi.ts`, `services/cageStorage.ts`, `services/cageTelemetry.ts`
- Per `docs/audit-100-critical-paths.md`, this is the highest-leverage MIN VERIFY in the app.

### PRACTICE / SwingLab pillar verdict

Phase 416 + 418 are recent and structurally clean. **The two-card UI and the validation gate are real code, not pretend.** The pose-skeleton overlay is honestly labelled a SEAM in the file header; the next APK with TFJS + expo-gl is the unlock. Cage Mode has had the most rewrites and the least recent on-device verification.

---

## 3. PLAY pillar — 1.1 (not this sprint)

### Findings

**PLAY is NOT bleeding into 1.0.** It is a recognised pillar in the architecture but has zero dedicated UI surface today.

- `store/settingsStore.ts:8` defines `export type CaddiePillar = 'round' | 'cage' | 'drills' | 'play';` — type-level only.
- `services/caddieResolver.ts:33-46` `mapSurfaceToPillar` maps `arena` → `play`; all other surfaces (caddie / recap / null / default) → `round`. No surface in the live app is registering as `arena` today.
- `app/settings.tsx:557` exposes a per-pillar caddie picker that includes `'play'` so the user can pre-assign a caddie to it. Tank picker spec at `setCaddieForPillar('play', ...)`.
- `app/quick-start.tsx:65` text only: "PLAY — Have fun · Games and growth modes (expanding in future updates)." — labelled deferred.
- `constants/kevinCharacter.ts:41` describes the four pillars in Kevin's character spec but states "He's the default for Play / Arena too" — lore only.
- `app/(tabs)/play.tsx` is **NOT the PLAY pillar.** This 1228-LOC file is Course Discovery (search + local-course picker + selected-course detail). It feeds the Round pillar (Start Round / Hole Map / Range Book buttons). The tab is named "play" historically but its purpose is round entry. Verified by reading the file header (`app/(tabs)/play.tsx:1-16`).

### Weight added to 1.0

**None.** The four references above (settings row, pillar type, resolver mapping, quick-start blurb, character lore) are inert — no code path actually executes a PLAY-specific behavior. The team-handoff debounce in `_layout.tsx:222` includes `'play'` in the pillar union but never reaches it because no active surface maps to it.

### Verdict

PLAY is correctly out-of-scope for 1.0. No cleanup needed.

---

## Aggregate verdict

| Pillar   | Code state  | Empirical state                   | Blocker?                                          |
|---       |---          |---                                |---                                                |
| ROUND    | SOLID       | UNVERIFIED on current bundle      | Yes — PATH 1-4 MIN VERIFY required for beta       |
| PRACTICE | SOLID + SEAM| UNVERIFIED 418 gate, pose=SEAM    | Cage Mode MIN VERIFY required for beta            |
| PLAY     | Inert       | N/A                               | No — deferred, not adding weight                  |

**Single recommendation:** PATH 1-4 MIN VERIFY scenarios from `docs/audit-100-critical-paths.md` are still the unblock. None of the structural work since then invalidates those checklists.
