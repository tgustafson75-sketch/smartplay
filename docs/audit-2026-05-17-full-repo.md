# Full-Repo Sweep — 2026-05-17

Audits #1 and #2 covered the work I just shipped + the hot-path round
flow. This is the everything-else sweep: every store (excluding
roundStore), every service (excluding the round-flow ones already
covered), every screen (excluding settings/smartvision/smartfinder
already covered), every component, every hook. Run by 4 parallel
read-only agents.

The first half is the punch list — the actual issues to fix. The
second half is the per-domain reference inventory (skip unless you're
spelunking).

# Part 1 — Punch list

## P0 — Bugs that affect users today

These produce wrong output for someone using the app right now.

1. **`shareCardGenerator.pickHeroStat` totalPar bug.** Ternary
   `hc.plan?.markers?.tee ? 4 : 4` always returns 4. The share-card
   hero stat over-par calculation is wrong for any non-par-4 round.
   File: `services/shareCardGenerator.ts:43`.
2. **`reference.tsx` deep-link tab bug.** `useState<Tab>(rule ?
   'rules' : 'rules')` — both branches return the same value; the
   `?rule=<id>` param doesn't switch to the Rules tab even though it
   expands the right entry. File: `app/reference.tsx`.
3. **`audioRoutingService` detection is stubbed and returns
   `'unknown'`.** Every "phone speaker" gate downstream
   (`voiceService.isVoiceAllowed`, listeningSession's ttsAllowed) is
   effectively passing on the unknown-route fallback. If you ever
   wanted phone-speaker suppression to actually work, it won't.
4. **`mapboxImagery.clearImageryCache` is a no-op.** Settings → Cache
   Management button claims to clear Mapbox tiles; doesn't. OS evicts
   eventually. Honest in the inline comment but the UI lies.
5. **`rangefinder.computeDistance` returns `250yd` sentinel when
   `unmeasurable:true`.** Back-compat hazard — any caller that
   forgets to check the flag renders a literal 250. The
   smartfinder.tsx fix went in this session, but the sentinel is
   still wired and trapdoors any new caller.
6. **`clubRecognition.parseSpokenClub` matches bare digit 3-9 as
   iron.** Regex `\b([3-9])\s*(?:i|iron)?\b` — "3 of us" parses to
   3-iron, "ace 7" parses to 7-iron. Voice intent edge case but
   real-world hit.
7. **`relationshipStore.getTopObservations` mutates state during read.**
   Bumps `usedInAdvice` counter as a side effect of "getting"
   observations. Calling it twice for the same prompt double-counts.
   Anything memoizing it fights React's render cycle.
8. **`cageStore.deleteShot` leaves stale `shot_ids` in
   `clubSegments`.** Segment ids point at non-existent shots. The
   per-segment club aggregation downstream is wrong.
9. **`cageStore.setShotAnalysis` does NOT advance `analysis_status`
   to `'ok'`.** Only `setSessionAnalysis` does. Per-shot-only paths
   leave the session stuck on `pending` forever.
10. **`lieAnalysisContext.LIE_KEYWORDS` has duplicate `'rough'`
    entries.** Trivial but real. File:
    `services/lieAnalysisContext.ts:83`.

## P1 — Real risks but not silently broken today

Working today, but the design carries a foot-gun.

1. **`useVoiceCaddie` is instantiated TWICE concurrently.** Once in
   the Caddie tab, once in `KevinBadge.tsx`. Each owns its own
   `recordingRef`/`isProcessingRef`. Two recording lifecycles can
   overlap. The module-level `micPermissionGranted` /
   `micBlockedPromptShown` are intentionally shared across instances
   — fine — but the recording state is not. Real risk during round.
2. **`recapGenerator` polling has no UI countdown.** `recap/[round_id]`
   polls `loadRecap` every 1s for 30 attempts. User sees an
   indefinite spinner that gives up silently. After ~5s the spinner
   should say "Still generating…" or surface a retry.
3. **`useRoundStore.getState()` in `recap/hole/[round_id]/[hole].tsx`
   render path.** No subscription → live round updates won't
   re-render this screen. The `eslint-disable` line is hiding the
   staleness.
4. **Two parallel source-of-truth for cage distance**:
   `cageCalibrationStore.userOverrideYards` AND
   `cageStore.cameraAlignment.distance_yards`. Two writers, two
   readers, no sync. Whichever was last written wins per call site.
5. **Two parallel paths to `/api/voice-intent`** in
   `services/listeningSession.ts` — one via `voiceCommandParser`
   (with `context`), one inline (without). The two paths can drift.
6. **`playerProfileStore` persists `selfieB64` + `customCaddiePortraitB64`
   as base64 in AsyncStorage.** Android default 2MB per-row limit.
   No size guard. A high-res selfie could overflow.
7. **`watchStore.isConnected` is persisted truthy** but BLE doesn't
   survive process death. UI lies briefly until BLE service
   re-runs.
8. **`hooks/useCurrentWeather` runs a 5-minute interval per mount.**
   3 mount points today (smartfinder, dashboard, caddie tab) → 3
   independent timers fetching the same weather.
9. **Naming collision**: `components/PrimaryIssueCard.tsx` and
   `components/swinglab/PrimaryIssueCard.tsx` are different
   components with the same name. Easy import mistake; IDE
   auto-import will guess wrong.
10. **Most persisted stores are missing `version` + `migrate`**:
    playerProfile, relationship, cageCalibration, cageOverlay,
    courseGeometryOverride, holeMarkerCalibration, issueLog,
    smartFinder, teamIntelligence, tutorial, vocabularyProfile,
    voiceHints. Schema evolution is hidden behind Zustand's default
    merge. settingsStore is the one example of a real migrate
    function (v3→v7) — the others should follow.
11. **`referenceAuthoringStore` uses AsyncStorage directly, NOT
    `getPersistStorage()`.** SSR-unsafe inconsistency. Native-only
    today so OK in practice, but the inconsistency is a foot-gun if
    anyone ever imports the store from a web path.
12. **`probeVideo.has_audio` is unreliable.** Detects via
    `isLoaded && duration > 0`. Silent-video files satisfy that.
    Downstream `has_audio` flag is wrong for those.
13. **Module-level `Math.random` UUIDs** (`cageStorage`,
    `cageStore.ingestUploadedSwing`) — fine for local-only, but if
    you ever sync this you'll need real UUIDs.
14. **`recordingRef`-style stale state in `smartFinderService`.**
    `gpsUnsub` guard truthiness can stale-skip a real start if
    `gpsManager.stopGpsManager` cleared subscribers without
    `stopSmartFinderGpsTracking` running.

## P2 — Code quality / archival

Working fine, but adds noise to the codebase or fragility long-term.

1. **`apiUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:8081'`**
   pattern appears in ~25 screens. In prod, missing env → localhost
   silently. Centralize via a `getApiUrl()` helper that returns a
   clear error in prod if unset.
2. **Hardcoded `CLUBS` arrays** in `cage/index`, `swinglab/upload`,
   `swinglab/range`, `swinglab/tutorial-upload`, `custom-caddie`.
   Single source-of-truth would fix drift.
3. **Hardcoded brand color literals** (`#00C896`, `#0d1a0d`,
   `#0d2418`, `#F5A623`, etc.) coexist with `useTheme().colors`
   across many components. Mixed strategy defeats theme switching
   for any user who picks light mode.
4. **Three competing layout-hook conventions**: `useDeviceLayout`,
   `useLayoutMode`, `useLayout`. Plus inline breakpoints in
   `CageSessionOverlay` + `CaddieAvatar`. Three answers to the same
   question.
5. **Polling intervals not coalesced**: PermissionBanner (5s),
   SmartFinderCard (4s), TapToTalkButton (250ms), GpsQualityOverlay
   (1s), useCurrentWeather (5min × N), `recap/[round_id]` (1s × 30).
   Each independent. Battery impact is small but nontrivial
   especially TapToTalkButton.
6. **Always-on animation loops while mounted**: `WindArrow` pulse,
   `CaddieDataStrip` four-dot pulses, `CaddieAvatar` drift/breath/
   idle-hint. Native driver, cheap, but not free on low-end devices.

## Open items requiring your call

1. **Onboarding directory rm** (8 files) — pending your OK since
   audit #1.
2. **Mark Green tool fate** (keep gated / delete) — pending audit #1.
3. **`is_highlight` dead field on `ShotResult`** — pending audit #1.
4. **Orphaned `components/smartvision/HoleView.tsx`** — pending
   audit #1.
5. **`@rnmapbox/maps` migration** vs current static-image approach —
   pending audit #1.
6. **`withPolygons=1` for non-`local:` courses** — pending audit #1.

7. **Whole list of dead/orphan routes** (see Dead Code below).
   Each one needs your "delete it" or "wire it up" call.

8. **Each P0 fix above** — most are small. Want me to take them in
   one cleanup commit pass after you scan?

# Part 2 — Dead code catalog

Files that have no inbound caller in `app/`, `components/`, or
`services/` (grep-based; agents flagged but did not exhaustively
verify). Treat as removal candidates pending your OK.

## Likely-dead screens
- `app/auth.tsx` — "Coming soon" placeholder, no inbound push
- `app/intro.tsx` — superseded by `/welcome` + `/onboarding/welcome`
- `app/swinglab/drills-legacy.tsx` — 1252 LOC, replaced by `/drills`
- `app/cage-review/*` subtree — no inbound `/cage-review/start` push
- `app/settings/trust-level.tsx` — replaced by inline slider on Caddie
- `app/smartfinder-camera.tsx` — replaced by `/smartfinder`
- `app/author/reference-assets.tsx` — direct-URL-only authoring tool
- `app/arena/*` subtree — only reachable via `/arena`, which is only
  pushed from `drills-legacy`. Effectively orphan.
- `app/onboarding/*` — `has_completed_onboarding` defaults true so
  the redirect never fires. Already flagged in audit #1.
- `app/hole-view-3d.tsx` — "Coming soon" placeholder

## Likely-dead components
- `components/LivingKevin.tsx` — alternative to CaddieAvatar; agents
  found no callers
- `components/swinglab/CageOverlay.tsx` — used? grep was inconclusive

## Likely-dead hooks
- `hooks/useKevinSpeech.ts` — no callers
- `hooks/useLayout.ts` — no callers (superseded by useDeviceLayout)
- `hooks/useLayoutMode.ts` — no callers (superseded by useDeviceLayout)
- `hooks/useTranslation.ts` — stub returning `{t: identity}`, no callers
- `hooks/useVolumeButtonTrigger.ts` — body is no-op (volume-manager
  removed); still imported in caddie tab

## Likely-dead services
- `services/caddieBrain.ts` — stub returning empty strings
- `services/heroReel.ts` — stub
- `services/contextBuilder.ts` — stub
- `services/contentSearch.ts` — stub
- `services/acousticEngine.ts` — stub
- `services/mediaKeyBridge.ts` — documented dead code, returns false
- `services/mediaKeyBridge.web.ts` — web stub
- `services/swing/swingCapture.ts` — possibly superseded by
  `poseDetection.analyzeSwing`; verify no callers before deleting
- `services/relationshipEngine.processRound` /
  `relationshipEngine.generateInsight` — legacy no-op exports inside
  an otherwise-live file
- `services/watchService.simulateSwing` — `Math.random` fake
  masquerading as telemetry; verify nothing in prod consumes it

## Likely-dead store fields
- `relationshipStore.spiralTriggers` — never written
- `relationshipStore.firstRoundNoSpiral` — never written
- `cageStore.clubProfiles` — no writer in cageStore.ts (might be
  written elsewhere; verify)
- `cageOverlayCalibrationStore.calibrated_at` — read only inside the
  store itself
- `roundStore.ShotResult.is_highlight` — already flagged in audit #1
- `ScorecardChip` has dead `chip`/`chipText` styles in StyleSheet

# Part 3 — Per-domain inventories

## Stores (24 files, roundStore excluded)

Persistence pattern: most use `getPersistStorage()` wrapper for SSR
safety; one exception (`referenceAuthoringStore`) uses AsyncStorage
directly.

| Store | Persist key | Version | Notable |
|---|---|---|---|
| `cageCalibrationStore` | `cage-calibration-v1` | none | Duplicates cage distance with `cageStore` |
| `cageOverlayCalibrationStore` | `cage-overlay-calibration-v1` | none | Bullseye + strike-box fractional coords |
| `cageStore` | `cage-store-v1` | 1 (identity migrate) | Heavy session orchestration; partialize excludes activeSession |
| `courseGeometryOverrideStore` | `course-geometry-overrides-v1` | none | Per-(course,hole) user overrides; non-reactive getter |
| `ghostStore` | not persisted | — | In-memory ghost-round comparison |
| `holeMarkerCalibrationStore` | `hole-marker-calibration-v1` | none | Per-(course,hole) marker fractional positions |
| `issueLogStore` | `issue-log-v1` | none | Owner-only voice issue log FIFO 100 |
| `listeningSessionStore` | not persisted | — | Mirror of `services/listeningSession` FSM |
| `playerProfileStore` | `player-profile-v2` | none(!) | Big profile + handicap + subscription + persistent patterns |
| `pointsStore` | `points-store-v1` | 1 (identity) | Tier recomputed on every add — can drift |
| `referenceAuthoringStore` | `@smartplay/reference_authoring` | 1 | Uses AsyncStorage directly (SSR-unsafe) |
| `relationshipStore` | `relationship-store-v1` | none(!) | Kevin's private memory; `getTopObservations` mutates state |
| `settingsStore` | `settings-store-v2` | **7 (real migrate)** | Reference example of how migrate should look |
| `smartFinderStore` | `smartfinder-store-v1` | none | Mode pref + transient AR rangefinder lock |
| `teamIntelligenceStore` | `team-intelligence-store-v1` | none | Caddie handoff suggestions + cooldowns |
| `toastStore` | not persisted | — | Tiny in-memory toast |
| `toolsMenuStore` | not persisted | — | Tools menu open/close |
| `trustLevelStore` | `trust-level-store-v1` | 1 (identity) | Trust spectrum L1–L5 |
| `tutorialStore` | `tutorial-store-v1` | none | Instructional video library |
| `vocabularyProfileStore` | `vocabulary-profile-v1` | none | User shot phrases + parsed signatures |
| `voiceHintsStore` | `voice-hints-v1` | none | First-run voice hints + mic state |
| `watchStore` | `watch-store-v1` | 1 (identity) | Watch BLE state; isConnected persisted (lies after restart) |

Headline concerns repeated up top: 12 stores missing version/migrate;
two duplicate sources of truth for cage distance; non-reactive
getters in 4 stores; relationshipStore.getTopObservations mutates
state.

## Services (~80 files, minus exclusions)

Grouped by domain. Per-file detail in the agent transcripts; this is
the index.

### Voice / audio
`voiceService.ts`, `listeningSession.ts`, `voiceCommandParser.ts`,
`voiceCommandRouter.ts`, `voiceHandlerRegistry.ts`,
`voiceOnboardingService.ts`, `voicePermissionService.ts`,
`audioLifecycle.ts`, `audioRoutingService.ts` (**STUBBED**),
`earbudControl.ts`, `mediaKeyBridge.ts` (**DEAD**),
`fillerLibrary.ts`, `kevinGreeting.ts`, `kevinGreetingManifest.ts`,
`dialogEngine.ts`, `recapNarration.ts`,
`swing/audioMetering.ts`, `swing/strikeDetector.ts`,
`acousticBallSpeed.ts` (**STUB**), `acousticEngine.ts` (**DEAD**),
`acousticDetectApi.ts`, `acousticImpactDetector.ts`,
`activeSurfaceRegistry.ts`

### Course data
`golfCourseApi.ts` (30-day file cache), `golfbertApi.ts`,
`courseContentService.ts`, `courseGreenOverrides.ts`,
`landmarks.ts` (Palms-only, dead for other courses),
`shotLocationService.ts`, `simulatedGPS.ts`,
`offCourseDetector.ts`, `movementModeDetector.ts`,
`backgroundLocationTask.ts`, `lastGpsRefresh.ts`,
`positionMarkBus.ts`, `weatherService.ts`,
`lieAnalysisContext.ts`, `lieAnalysisService.ts`

### Mapbox / SmartVision
`mapboxImagery.ts` (clearImageryCache is no-op),
`smartVisionOverlay.ts`, `rangefinder.ts` (250 sentinel)

### Cage / swing
`cageApi.ts`, `cageStorage.ts`, `cageReview.ts`,
`cageTelemetry.ts`, `clubRecognition.ts` (regex bug),
`swingIssueClassifier.ts`, `swingLibrary.ts`,
`swingReferences.ts` (every entry has `image:null`),
`swingCapture.ts` (possibly superseded),
`drillRecommendation.ts`, `primaryIssueRanker.ts`,
`patternEngine.ts`, `patternDetection.ts`,
`poseDetection.ts`, `poseAnalysisApi.ts`,
`poseInference.ts` (scaffold, returns `not_loaded`),
`videoUpload.ts`, `uploadDiagnostic.ts`,
`tutorialAnalysis.ts`, `tutorialContext.ts`,
`spaceAssessment.ts`, `cvScoring.ts`

### Round / pattern / recap
`briefingGenerator.ts`, `recapGenerator.ts`,
`recapHero.ts`, `shareCardGenerator.ts` (**totalPar BUG**),
`planStorage.ts`, `proactiveKevin.ts`, `conversationState.ts`,
`contextSynthesizer.ts`, `handicapCalculator.ts`,
`rulesEngine.ts`, `responseRouter.ts`,
`relationshipEngine.ts` (legacy stubs alongside live code),
`teamIntelligence.ts`, `caddieResolver.ts`,
`modeSelector.ts` (not wired), `trustLevelService.ts`,
`featureAccess.ts`, `paywallGuard.ts`

### Persistence / boot / infra
`analytics.ts`, `ssrSafeStorage.ts`, `vocabularyProfile.ts`,
`vocabularyProfileService.ts`, `polyfills.ts`,
`autoUpdate.ts`, `permissionsManager.ts`, `batteryMonitor.ts`,
`contentGuardrail.ts`, `safeBack.ts`, `teeTimeLink.ts`,
`youtubeLinks.ts`, `watchService.ts` (simulateSwing is fake)

### Stubs (delete or annotate)
`caddieBrain.ts`, `heroReel.ts`, `contextBuilder.ts`,
`contentSearch.ts`, `acousticEngine.ts`

### Role facades
`roles/caddieRole.ts`, `roles/coachRole.ts`,
`roles/psychologistRole.ts` — pure re-export hubs

## App screens (~50 files, minus exclusions)

Grouped by user journey.

### Round flow
- `/(tabs)/caddie` — 3722 LOC, default landing
- `/round/briefing` — pre-round AI briefing
- `/recap/[round_id]` — post-round recap with PDF / share / narration
- `/recap/hole/[round_id]/[hole]` — per-hole shot map (uses getState
  in render — staleness risk)
- `/course/[course_id]` — course detail with About, Stats, Hole Guide

### Practice
- `/(tabs)/swinglab` — launcher tab (6 cards)
- `/swinglab/cage-drill` — 1039 LOC full cage capture flow
- `/swinglab/range` — Range Mode planning (doesn't persist, known)
- `/swinglab/camera-setup` — pre-flight gate
- `/swinglab/space-scan` — practice-space vision scan
- `/swinglab/library` — unified swing library
- `/swinglab/upload` — pick video + metadata
- `/swinglab/tutorials` — tutorial library
- `/swinglab/tutorial-upload` — compose tutorial
- `/swinglab/tutorial/[id]` — tutorial detail
- `/swinglab/swing/[swing_id]` — 991 LOC swing detail
- `/swinglab/drills-legacy` — **1252 LOC dead** code
- `/cage` — Cage Mode setup
- `/cage/session` — wrapper around `<CageSessionOverlay>`
- `/cage/summary` — post-session analysis
- `/cage/history` — last 10 sessions
- `/cage-review/start`, `/cage-review/[review_session_id]`,
  `/cage-review/summary` — **possibly dead subtree**
- `/smartmotion-quick` — 954 LOC manual capture loop
- `/drills` — Common Faults grid
- `/drills/[issue]` — issue detail

### Tool / utility
- `/mark-green` — capture green coords
- `/lie-analysis` — TightLie camera + analysis
- `/acoustic-test` — owner test bench
- `/gps-test` — owner GPS diagnostic

### Onboarding (mostly dead)
- `/onboarding/welcome` / `name` / `mode` / `home-course` /
  `about-game` / `meet-kevin` / `ready` — superseded by `/welcome`
- `/welcome` — Phase 410 single-screen first-launch

### Pre-onboarding / first-run
- `/` (index.tsx) — hydration gate + routing
- `/+not-found` — 404
- `/auth` — **dead placeholder**
- `/intro-video` — one-shot brand intro
- `/intro` — **dead legacy intro**
- `/permissions` — one-time core perm pre-flight
- `/greeting` — per-cold-launch Kevin greeting
- `/quick-start` — tester guide

### Settings + adjacent
- `/settings` — master settings (40+ setters in one destructure)
- `/settings/trust-level` — **possibly dead** (slider is inline now)

### Other / supporting
- `/(tabs)/play` — Course Discovery + start round (1225 LOC)
- `/(tabs)/dashboard` — Stats tab (869 LOC)
- `/(tabs)/scorecard` — vertical per-hole scorecard
- `/arena/*` — **likely dead** (orphan from drills-legacy)
- `/paywall` — subscription pitch
- `/reference` — rules + handicap calc (tab-default bug)
- `/tutorials` — feature tutorials
- `/kevin-learning` — vocabulary signatures viewer
- `/landmark-curate` — Palms landmark authoring (owner)
- `/diagnostic-card` — in-round diagnostic intent card
- `/owner-logs` — owner issue-log viewer
- `/hole-view-3d` — **placeholder**
- `/author/reference-assets` — **possibly dead** authoring tool
- `/profile/custom-caddie` — AI selfie → caddie portrait
- `/smartfinder-camera` — **possibly dead** old SmartFinder

### Debug screens (gated this session)
`api-debug`, `battery-debug`, `cage-debug`, `ghost-debug`,
`patterns-debug`, `plan-debug`, `smartfinder-debug`,
`subscription-debug`, `voice-debug` — all gated with
`useDebugRouteGate()` now.

## Components (74 files, minus exclusions) + Hooks (13)

Headline concerns repeated up top: useVoiceCaddie double-instantiated,
naming collision on PrimaryIssueCard, 5 likely-dead hooks, 3 competing
layout-hook conventions, polling/animation cost.

### Caddie / cockpit / round
- `CaddieAvatar.tsx` (1090 LOC, locked layout per Phase AU)
- `CaddieDataStrip.tsx` (494 LOC bottom HUD strip)
- `CaddieSuggestionCard.tsx` (team handoff prompt)
- `CockpitCaddieScreen.tsx` (Cockpit-mode layout)
- `caddie/cockpit/BrandHeader.tsx`,
  `caddie/cockpit/AskCaddieButton.tsx`,
  `caddie/cockpit/DistanceCard.tsx`,
  `caddie/cockpit/ShotResultRow.tsx`,
  `caddie/cockpit/SmartToolsRow.tsx`,
  `caddie/cockpit/StepperPair.tsx`
- `caddie/ActiveListeningPill.tsx`,
  `caddie/PhotoCaptureButton.tsx`,
  `caddie/ScorecardChip.tsx`,
  `caddie/WindArrow.tsx`
- `PermissionBanner.tsx`, `KevinBadge.tsx` (duplicates useVoiceCaddie!),
  `KevinHelpButton.tsx`, `LivingKevin.tsx` (likely dead),
  `TapToTalkButton.tsx`, `UpdateAvailableBanner.tsx`,
  `VocabBanner.tsx`, `WhatCanISayChip.tsx`
- `QuickLogShotSheet.tsx` (manual shot entry sheet)
- `RoundShareCard.tsx` (offscreen render for share image)
- `CageSessionOverlay.tsx` (1085 LOC full cage UI),
  `cage/ClubIdentifyControls.tsx`, `cage/ClubPickerModal.tsx`

### SmartVision / SmartFinder
- `smartfinder/GPSQuality.tsx`,
  `smartfinder/SmartFinderCard.tsx`,
  `smartfinder/SmartFinderModeToggle.tsx`,
  `smartfinder/TargetingOverlay.tsx`

### Recap
- `recap/HandicapImpactCard.tsx`,
  `recap/HoleShotMap.tsx` (329 LOC),
  `recap/PhotoCollage.tsx`

### SwingLab / practice
- `swinglab/CageOverlay.tsx` (camera overlay),
  `swinglab/DrillCard.tsx`,
  `swinglab/KevinCoachBox.tsx`,
  `swinglab/PrimaryIssueCard.tsx` (NAMING COLLISION),
  `swinglab/SkeletonOverlay.tsx`,
  `swinglab/SwingActionSheet.tsx` (439 LOC),
  `swinglab/SwingBodyOverlay.tsx`,
  `swinglab/VideoWatermark.tsx`

### Course
- `course/CourseAbout.tsx`, `course/CourseDetailBanner.tsx`,
  `course/CourseDetailModal.tsx`, `course/CourseHero.tsx`,
  `course/CourseStats.tsx`, `course/HoleGuide.tsx`,
  `course/HolePhotosGrid.tsx`, `course/StartRoundCourseCard.tsx`

### Settings / shared overlays
- `PrimaryIssueCard.tsx` (root, NAMING COLLISION),
  `ErrorBoundary.tsx`, `CaptionStrip.tsx`,
  `battery/BatteryPrompt.tsx`,
  `brand/BrandHeaderRow.tsx`,
  `toast/GlobalToast.tsx`,
  `tools/GlobalToolsMenu.tsx` (526 LOC),
  `dev/GpsQualityOverlay.tsx`

### Onboarding / Kevin / lie analysis
- `kevin/KevinAvatar.tsx`,
  `lieAnalysis/AnalysisResult.tsx`

### Illustrations
- `illustrations/BallPositionIllustration.tsx`,
  `illustrations/GripIllustration.tsx`,
  `illustrations/PostureIllustration.tsx`,
  `illustrations/SwingPathIllustration.tsx`,
  `illustrations/TempoIllustration.tsx`,
  `illustrations/WeightTransferIllustration.tsx`

### Shared atoms
- `themed-text.tsx`, `themed-view.tsx`,
  `external-link.tsx`, `haptic-tab.tsx`,
  `hello-wave.tsx` (web-style anim — may not run on native),
  `parallax-scroll-view.tsx`,
  `ui/collapsible.tsx`, `ui/icon-symbol.tsx`,
  `ui/icon-symbol.ios.tsx`,
  `AppIcon.tsx`, `AddressSilhouette.tsx`

### Hooks
- `use-color-scheme.ts` / `.web.ts` — RN useColorScheme wrappers
- `use-theme-color.ts` — atom-set only
- `useCurrentWeather.ts` — 5min refresh × N mounts (uncoalesced)
- `useDeviceLayout.ts` — used by smartvision
- `useKevin.ts` — imperative ask(); double-writes presence + isThinking
- `useKevinSpeech.ts` — **likely dead**
- `useLayout.ts` — **likely dead** (superseded)
- `useLayoutMode.ts` — **likely dead** (superseded)
- `useTranslation.ts` — **stub, no callers**
- `useVoiceActivityDetection.ts` — VAD via Audio.Recording metering
- `useVoiceCaddie.ts` — 1004 LOC voice pipeline; **double-instantiated**
- `useVolumeButtonTrigger.ts` — **no-op body, still imported**

# Closing

Three commits land tonight:
- `88a9a46` — Audit #1 (recent changes)
- `a968b42` — Audit #2 (hot paths)
- *this commit* — Audit #3 (full repo)

Combined open-items count across all three audits:
- ~14 small bugs (P0 + P1 from this doc + the 8 from audit #2)
- ~20 dead-code removal candidates
- ~10 mid-size refactor items (singleton state hooks, store
  migrations, polling coalescing, etc.)
- ~6 architectural decisions still pending your call (audit #1 list)

Where you want to start tomorrow is your call. My recommendation for
maximum-bang-for-the-buck:
1. P0 bugs cleanup pass (~1-2 hours, all small fixes batched)
2. Dead-code rm pass with your explicit OK file-by-file (~1 hour)
3. Singleton state reset hooks at round boundary (~1-2 hours, audit #2 finding)
4. Add version/migrate to the 12 stores that lack them (~2 hours)

That clears the bottom 80% of accumulated risk without touching any
hot path. Then we can talk about the architectural bigger items
(rnmapbox migration, Bluegolf hole imagery scraping, the voice-hook
duplication refactor).
