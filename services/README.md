# services/

Client-side service layer. Each service is a thin module that wraps a concern and exposes a small public API; React components and hooks consume them via direct imports.

## Three-role architecture (framework)

Kevin operates in three registers — see `constants/kevinCharacter.ts` ROLES section for the canonical voice description. The service layer is organized around these registers:

- **Caddie** — capture-time, present-tense, tactical. Per-shot decisions.
- **Coach** — recap-time, past-tense, reflective. Patterns and trends.
- **Psychologist** — cross-round, observational, regulation. The walking conversation.

Role hubs at `services/roles/{caddieRole,coachRole,psychologistRole}.ts` re-export the underlying services that operate in each register — they don't own implementation. Adding a service to a role: re-export it from the role hub and add a row to the matrix below.

`services/modeSelector.ts` exposes `selectMode(signals)` to pick a register for a moment. Today only the surface hint drives the decision; richer signal-driven shifting is staged for a later phase.

## Pillar × Mode matrix

The table maps capability pillars to which role consumes them. A blank cell means that pillar has no surface in that register today.

| Pillar | Caddie (capture-time) | Coach (recap-time) | Psychologist (cross-round) |
|---|---|---|---|
| **Voice I/O** | `voiceService.speak`, `captureUtterance` | recap narration via `recapNarration` | `fillerLibrary` rhythm |
| **Voice Intent** | `intents/queryStatusHandler` (shot_distance, hole_progress, distance_to_green, wind, conditions, plays_like, hole, score), `openToolHandler`, `navigateHandler`, `changeSettingHandler` | recap-context queries via same handler | `helpHandler` discovery |
| **Shot Capture** | `shotDetectionService`, `conversationalLoggingOrchestrator`, `shotLocationService` | shot history queries against `roundStore.shots` | — |
| **Round Flow** | `briefingGenerator`, `currentHole` state | `recapGenerator`, `recapHero`, `HoleShotMap` | `proactiveKevin` pacing |
| **Patterns & Learning** | `vocabularyProfileService` writes during logging | `patternDetection` reads on recap | `kevin-learning` relationship surface |
| **Course Knowledge** | `courseGeometryService` (live geometry for distance queries) | `courseGeometryService` (recap shot-map render) | — |
| **Identity & Relationship** | — | — | `relationshipEngine`, `proactiveKevin`, `voiceOnboardingService` |
| **Content Safety** | `contentGuardrail` wraps every TTS path regardless of mode | (same) | (same) |

Infrastructure services that don't belong to any single mode (`utils/geoDistance`, `golfCourseApi`, `planStorage`, `featureAccess`, `rulesEngine`) live outside the role hubs and are imported directly by whichever consumer needs them.

## Voice command layer (Phase A.1)

| File | Purpose |
|---|---|
| `voiceCommandParser.ts` | Calls `/api/voice-intent` to classify a transcript into a structured `VoiceIntent`. |
| `voiceCommandRouter.ts` | Registry + dispatch for `IntentHandler`s. Maintains a 30-entry rolling history. |
| `voiceHandlerRegistry.ts` | (Phase A.3) Surface-aware action registry. Screens register their own `VoiceAction`s on mount; intent handlers and the help discovery surface query the registry to find context-appropriate actions. New screens add coverage without modifying the router. |
| `intents/` | One handler per intent type: `open_tool`, `query_status`, `change_setting`, `acknowledge`, `navigate`, `help`. `index.ts` registers them all on the singleton router. |

## Conversational shot logging (Phase A.2)

| File | Purpose |
|---|---|
| `shotDetectionService.ts` | GPS-based shot signature detector. Subscribes to `expo-location`, watches for sustained displacement (>30 yds) after a stationary window (>20 s), suppresses cart speeds, emits `shot_likely` events. Manual `triggerManual()` available for tests / fallback. |
| `conversationalLoggingOrchestrator.ts` | Subscribes to `shotDetectionService`, plays one of seven Kevin prompt variations after a 5-15 s natural pause, opens the mic for 8 s, parses the response via `/api/parse-shot`, logs to `roundStore`. Handles skip phrases, lie follow-up, and fallback to manual shot card. |
| `vocabularyProfileService.ts` | Accumulates the user's actual phrasings into a persisted profile (zustand + AsyncStorage). The top phrases are injected into the parser context so Haiku adapts to the user's vocabulary over time. |

## Voice discovery & onboarding (Phase A.4)

| File | Purpose |
|---|---|
| `voiceOnboardingService.ts` | One-time hint orchestrator: first-tee, first-shot, first-tool prompts for first-round users; vocabulary banner trigger threshold; voice-logged shot counter. Hints are extensible — adding new ones is just one entry per hint type. |
| `voicePermissionService.ts` | Microphone permission gate. `checkMicPermission()` requests if undetermined, persists denial. `isVoiceSuppressed()` is the single read consumed by orchestrator + hint sites — either OS-level denial or the voice-disabled toggle in Settings. `clearMicDenial()` fires when the user re-enables voice in Settings. |

## Voice I/O & content safety

| File | Purpose |
|---|---|
| `voiceService.ts` | Audio mode management, TTS playback (`speak`, `speakFromBase64`), one-shot `captureUtterance(timeoutMs)` for non-conversational recording. |
| `contentGuardrail.ts` | Regex-based NSFW filter that wraps every Kevin-text-to-TTS path. Returns a clean fallback and discards dirty audio. |
| `fillerLibrary.ts` | Pre-recorded filler clip index used to mask brain latency during voice queries. |

## Phase B — Shot tracking with location

| File | Purpose | Role |
|---|---|---|
| `shotLocationService.ts` | GPS capture for shots: fresh-fix, last-known fallback, green/tee centroid lookup, hole-transition closer. | Caddie |
| `weatherService.ts` | OpenWeatherMap snapshot fetch + per-location bucketed cache (10-minute freshness, ~100m bucket). Wired into orchestrator: each logged shot gets a weather_snapshot fire-and-forget. | Caddie |
| `utils/playsLike.ts` | Plays-like distance calculation. Wind (1%/mph headwind, 0.5%/mph tailwind, half-cross), air-density via temperature (0.5%/10°F deviation from 70°F), elevation (1y / 3ft). v1 approximate model — calibration-by-history is staged for a later phase. | Infra (Caddie consumes) |
| `components/caddie/WindArrow.tsx` | Animated SVG wind indicator. Color-coded tailwind/headwind/crosswind, length scales with speed, calm-circle below 3mph, neutral placeholder when weather unavailable. Renders top-right of Caddie home during active rounds. | Caddie |

## Phase D-1 — Course Detail surface

| File | Purpose | Role |
|---|---|---|
| `services/courseContentService.ts` | Calls /api/course-content for AI-generated About / Caddie Tips / Hole Notes. Mem + AsyncStorage cache, weekly refresh. | Coach |
| `api/course-content.ts` | Anthropic-backed (Sonnet) Course Detail prose generator. JSON-shaped output: about, caddie_tips[], hole_notes[]. Per-instance memory cache server-side; client persistence via courseContentService. | Coach (Infra) |
| `app/course/[course_id].tsx` | Course Detail screen — hero + five-stat strip + AI About + Caddie Tips + hole photos grid + hole guide table + dual CTAs (Book Tee Time / Start Round Here). | Coach |
| `components/course/*` | CourseDetailBanner, CourseHero, CourseStats, CourseAbout, HolePhotosGrid, HoleGuide. Pure presentation. | Coach |
| `components/CoursePicker.tsx` | Now exposes optional `onInfo(courseId)` prop driving the per-row (i) affordance that opens Course Detail. | Coach (entry point) |

## Phase D-2 — SmartFinder v2

| File | Purpose | Role |
|---|---|---|
| `services/smartFinderService.ts` | GPS fix capture with accuracy classification, green front/middle/back yardage computation, distance-to-arbitrary-point. Graceful nulls when course geometry lacks green coordinates (typical case). | Caddie |
| `store/smartFinderStore.ts` | Persisted mode preference (`standard`/`target`/`map`) plus the legacy AR-lock state. AsyncStorage-backed. | Caddie |
| `app/smartfinder.tsx` | Full-screen 3-mode SmartFinder. Standard = front/middle/back numbers; Target = tap-to-target on hole overhead view; Map = full hole map with player position. Mode persists across sessions. | Caddie |
| `app/smartfinder-camera.tsx` | Legacy camera-AR rangefinder, preserved for future reactivation as a 4th "Camera" mode (1.x). | Caddie (deferred) |
| `components/smartfinder/SmartFinderCard.tsx` | Embedded glanceable card on Caddie home — front/middle/back to the green plus hole label and GPS-quality dot. Tap to expand to full-screen. Absolute-positioned, never disturbs Kevin's locked layout. | Caddie |
| `components/smartfinder/SmartFinderModeToggle.tsx` | Three-button segmented toggle. | Caddie |
| `components/smartfinder/GPSQuality.tsx` | Color-coded GPS-accuracy dot. Dot-only embedded; dot + accuracy-in-feet on full-screen. | Caddie |

## Phase E — Trust Spectrum

| File | Purpose | Role |
|---|---|---|
| `store/trustLevelStore.ts` | Persisted Trust Spectrum level (1–4). Default L2 Companion for new users. AsyncStorage-backed. Exports `TRUST_LEVEL_META` with user-facing labels and one-liners. | Mode-neutral |
| `services/trustLevelService.ts` | `getTrustLevel()` synchronous read for non-React consumers (modeSelector, intent handlers). `defaultWakeWordOn(level)` — L3/L4 default on, L1/L2 default off (Phase G consumes). `proactiveEnabled(level)` / `psychologistEnabled(level)` — gates for orchestrator and walking-conversation triggers. | Mode-neutral |
| `app/settings/trust-level.tsx` | Slider screen — four labeled positions (Quiet / Companion / Active / Full) with selection persistence and an expandable "About these" panel. | Mode-neutral |
| `services/modeSelector.ts` | Now reads trust level. Psychologist register only fires when `psychologistEnabled()` returns true (L3+). `selectModeWithLevel(signals)` returns role plus level for prompt-template consumers that adjust verbosity by level. | Mode-neutral |
| `services/voiceOnboardingService.ts` | Hint copy keyed by level (`HINTS_BY_LEVEL`). L1 returns null (silent); L2 keeps the original Phase A.4 copy; L3/L4 use proactive / full-engagement framing. | Caddie (entry) |
| `app/(tabs)/caddie.tsx` | Trust-level-gated avatar rendering: L2 path is byte-identical to the locked elite Kevin layout. L1 swaps the avatar for a mic + logo overlay. L3 shrinks the avatar frame for a top-half presence. L4 raises the avatar slightly for a centered/larger presence. Banner is unchanged across all four levels. | Mode-neutral |
| `app/onboarding/meet-kevin.tsx` | Inline TrustLevelPicker added below the Skip CTA — four labeled buttons, default L2, "Recommended for most." tag. User can change anytime via Settings. | Mode-neutral |

## Phase F — Visual Identity & Dialog Templates

| File | Purpose | Role |
|---|---|---|
| `constants/dialogTemplates/caddieTemplates.ts` | Tactical-register templates: shot prompts, distance callouts, wind callouts, plays-like, no-data apologies, help intros. Variations per situation; engine picks at random per call. Character-agnostic. | Caddie |
| `constants/dialogTemplates/coachTemplates.ts` | Reflective-register templates: recap intros, pattern callouts, club observations, no-patterns-yet, recap outros. Specific over generic; never lectures. | Coach |
| `constants/dialogTemplates/psychologistTemplates.ts` | Buddy-register templates: pre-shot calm, post-bad-shot reset, pace check, momentum lift, tilt break, idle walk filler. Mike-test guardrails enforced — never therapy framing. | Psychologist |
| `services/dialogEngine.ts` | `getDialog(role, situation, context)` returns a single string with `{var}` interpolation. The seam where future Tank / Serena character variants will compose their voice on top of the same generic templates. | Mode-neutral |
| `components/kevin/KevinAvatar.tsx` | Animated liveliness ring with four states (idle / listening / speaking / thinking) and per-Trust-Spectrum sizing. Wraps any child (avatar image, mic icon). Returns null at L1 unless `sizeOverride` is given. Uses react-native-reanimated; no asset dependency. | Mode-neutral |
| `services/conversationalLoggingOrchestrator.ts` | `pickPrompt()` now routes through `getDialog('caddie', 'shot_prompt')` instead of the inline `KEVIN_PROMPT_VARIATIONS` array (deleted). Behavior identical; consumer site is now template-shaped. | Caddie |

## Phase H — Lie Analysis Tool

| File | Purpose | Role |
|---|---|---|
| `api/lie-analysis.ts` | Anthropic vision endpoint (Claude Sonnet) — accepts a base64 JPEG of a lie + context (hole/par/distance/weather/last-shot/play-intent) and returns structured situation/advice/club/alternative/confidence JSON. Voice spoken via dialog templates on the client. | Caddie (Infra) |
| `services/lieAnalysisContext.ts` | Bundles the context the vision endpoint uses to produce specific (rather than generic) advice. Reads from roundStore + smartFinderService GPS + getCachedWeather + courseGeometry. Each field gracefully degrades when its source is unavailable. | Caddie |
| `services/lieAnalysisService.ts` | Client-side fetcher. Returns typed `LieAnalysisResult` discriminated union — `ok`, `no_network`, `too_large`, `low_quality`, `error`. Never throws; the screen renders each case directly. | Caddie |
| `app/lie-analysis.tsx` | Camera capture screen → resize/compress → analyze → speak Kevin's analysis → results display. Voice-trigger entry via `?intent=aggressive\|conservative` query param. Permission gate, no-network "save for later", low-quality retry. | Caddie |
| `components/lieAnalysis/AnalysisResult.tsx` | Results display: thumbnail, situation, advice, recommended club, alternative play, confidence dot, replay/got-it/try-again actions. | Caddie |

**Tank persona seam.** Lie Analysis is character-agnostic. The vision endpoint produces structured fields; the dialog engine selects which character speaks them. Kevin (Caddie register) speaks today; when Tank's character role is fully clarified in a future phase, Tank-specific templates plug in alongside Kevin's in `caddieTemplates.ts` and a character selector decides which voice fires (potentially gated by `confidence_level: 'low'` or other escalation triggers). The analysis pipeline does not change.

## Phase I — Kevin Coach-mode on SwingLab

| File | Purpose | Role |
|---|---|---|
| `components/swinglab/KevinCoachBox.tsx` | Contained-presence card. Kevin avatar + Coach text + close X. Visible by default at L2/L3/L4, hidden at L1, dismissible per-session (component-local state — re-engages on next surface visit). Accent prop `coach` (green) or `psychologist` (amber, for Arena). Minimized variant for ambient use during active Cage Session recording. | Coach |
| `constants/dialogTemplates/coachTemplates.ts` | Phase I additions: `swinglab_home_intro`, `swinglab_home_intro_returning`, `drill_suggestion_generic`, `drill_suggestion_with_pattern`, `cage_mode_setup_intro`, `cage_session_review_intro`, `arena_intro`, `arena_challenge_intro`, `drill_detail_intro`. {variable} placeholders for name, drill, club, pattern, challenge. | Coach |
| `app/(tabs)/swinglab.tsx` | KevinCoachBox at top of SwingLab home with intro + drill suggestion. Each drill in `DRILLS` now carries an authored `coach_voice` field; the expanded drill detail renders KevinCoachBox with that drill-specific Coach walkthrough. | Coach |
| `app/cage/index.tsx` | KevinCoachBox at top of Cage Mode setup, club-aware via `cage_mode_setup_intro` template. Updates as the user changes club selection. | Coach |
| `app/cage/summary.tsx` | KevinCoachBox at top of Cage post-session summary with `cage_session_review_intro`. Phase K's pose detection will fill in actual analysis content; today this just establishes Kevin's voice presence at the review entry point. | Coach |
| `app/arena/index.tsx` | KevinCoachBox at top of Arena landing with `arena_intro`. Uses `psychologist` accent for the gameplay register. | Coach (Psychologist-leaning) |

**Contained-presence pattern.** Distinct from Caddie home's Trust-Spectrum continuous-scaling presence. Practice surfaces use a dismissible card so Kevin can step back when the user wants quiet practice — re-engaging next visit without permanent dismissal. Future Practice surfaces (Phase J Cage v2 Lite completion, Phase K GolFix overlay, Phase L Arena CV scoring) plug into the same pattern.

## Phase J — Cage v2 Lite

| File | Purpose | Role |
|---|---|---|
| `store/cageStore.ts` | Extended `CageSession` with reserved `primary_issue` and `drill_recommendation` fields (Phase K populates). Extended `CameraAlignment` with `distance_yards` + `cage_id`. New `setDistanceCalibration(yards, cageId?)` action. | Coach (Infra) |
| `services/acousticBallSpeed.ts` | Stubbed acoustic ball speed (option b per spec). `estimateBallSpeed(club)` returns club-typical mph with `confidence: 0.3, source: 'club_typical_stub'`. `measureBallSpeedAcoustic(...)` reserved for the real DSP detector — signature stable so consumer code can swap without rewrite. | Coach (Infra) |
| `components/swinglab/PrimaryIssueCard.tsx` | Reserved-slot card from Addendum 4 spec. Placeholder mode when `issue` prop is null (today, always); populated mode renders category icon + title + severity chip + occurrence count + mechanical breakdown + feel cue. | Coach |
| `components/swinglab/DrillCard.tsx` | Paired drill recommendation card. Placeholder mode when null; populated mode shows drill name + Coach-voice reason + "Open Drill" CTA routing to `/swinglab`. Phase K populates with the relevant drill_id. | Coach |
| `app/cage/index.tsx` | Camera setup card now opens a distance-calibration modal: walk to reference target, type yardage, save. Calibration persists per cage via `setDistanceCalibration()`; subsequent sessions skip setup. | Coach |
| `app/cage/summary.tsx` | PrimaryIssueCard + DrillCard mounted between the existing Phase I KevinCoachBox and the existing shot grid. Cards render placeholders today; light up automatically when Phase K populates `session.primary_issue` / `session.drill_recommendation`. | Coach |
| `app/cage/session.tsx` | Phase I.5 follow-up — KevinCoachBox in `minimized` mode renders during active recording (silent ambient indicator). Re-expands at the post-session review. | Coach |
| `services/intents/queryStatusHandler.ts` + `api/voice-intent.ts` | Two new query topics — `end_session` (ends active Cage Session and routes to summary) and `next_focus` (summarizes Phase K's Primary Issue if populated, honest placeholder otherwise). Both work off-round (Practice context). | Caddie (entry) → Coach (data) |

## Phase K — SwingLab Pose Detection + GolFix Overlay

| File | Purpose | Role |
|---|---|---|
| `api/swing-analysis.ts` | Anthropic Claude Sonnet vision endpoint. Accepts 1-5 base64 frames + context (club, swing #, prior issues), returns canonical-issue classification with severity / confidence / observation / follow-up question. Conservative-by-design system prompt — false positives damage trust faster than false negatives. | Coach (Infra) |
| `services/poseDetection.ts` | Client wrapper. `analyzeSwing(clipUri, context)` returns typed `SwingAnalysisResult`: ok, no_frames, no_network, error. Cloud-based today (option a per spec); future TFJS-local swap is a single-file body change. KNOWN GAP: `extractKeyFrames(clipUri)` returns empty until `expo-video-thumbnails` is wired (~5-line refinement). | Coach (Infra) |
| `services/swingIssueClassifier.ts` | `classifySession(swingAnalyses)` aggregates per-swing results into a session-level `PrimaryIssue` (severity-weighted tally, low-confidence filter, minimum-occurrence floor). Returns null when data doesn't warrant a primary call. Carries `ISSUE_DISPLAY_NAME`, `ISSUE_CATEGORY`, and `ISSUE_COACH_VOICE` (per-issue authored mechanical breakdown + feel cue). | Coach (Infra) |
| `services/drillRecommendation.ts` | `recommendDrill(issue)` maps a canonical issue to a SwingLab `DrillRecommendation` (drill_id matching the existing DRILLS array + Kevin's Coach voice reason). `none` returns null → DrillCard placeholder. | Coach (Infra) |
| `app/cage/summary.tsx` | Pose-detection pipeline runs once on mount: each swing's clipUri → `analyzeSwing` → aggregate via `classifySession` → recommend via `recommendDrill` → populate `primaryIssue` and `drillRec` state → cards render real analysis. Falls back to placeholders when frames empty / data insufficient / network down. | Coach |
| `services/intents/queryStatusHandler.ts` + `api/voice-intent.ts` | Two new query topics — `swing_observation` ("what'd you see") and `tell_me_more` (feel cue + drill reason). | Coach |

**Cloud-vision tradeoff.** Privacy implication: swing frames travel to Anthropic. Future swap to local TFJS pose detection is a single-file body change in `poseDetection.ts` (the consumer signature stays stable). Visual reference assets per-issue are deferred to 1.x; PrimaryIssueCard renders text-only when `visual_reference_path` is null (already-shipped fallback).

## Phase L — Arena CV Scoring (CTP only in v1)

| File | Purpose | Role |
|---|---|---|
| `api/cv-scoring.ts` | Anthropic Claude Sonnet vision endpoint scoring a single CTP photo. Uses the flagstick (~7 ft regulation height) as the scale anchor to estimate ball-to-pin proximity. Conservative-by-design — declines when both ball and pin aren't clearly visible. Today only `challenge: 'ctp'` is implemented; Skills / Sim / Scramble explicitly rejected with a "deferred" error message. | Coach (Infra, Psychologist surface) |
| `services/cvScoring.ts` | Client wrapper. `scoreCTPShot(b64, distanceYards, mediaType)` returns typed `CVScoringResult`: ok / low_quality / no_network / error. `bucketToFeet(bucket)` maps the API's bucket back to the existing CTP RESULT_OPTIONS feet value so manual + CV paths feed the same scoring pipeline. | Coach (Infra) |
| `app/arena/ctp.tsx` | New "📷 Score with photo" CTA above the manual bucket buttons. Camera permission gate, photo capture via expo-image-picker, resize via expo-image-manipulator, send to /api/cv-scoring, route the bucket through the existing `handleResult(feet)` so points/voice summary/completion flow are unchanged. Manual buttons stay as fallback. | Psychologist surface |

**Phase L scope.** Wired only into Closest-to-Pin in v1. Skills (multi-target multi-distance), Sim Round (18-hole tracking), and Scramble (partner format) each have different scoring shapes that warrant their own targeted prompts + UI; deferred to a future focused phase.

## Refinement bundle (K.5 + sweep)

- K.5(a): `extractKeyFrames` now uses expo-video-thumbnails (5 frames at 5/30/55/80/95% of a 2s window).
- K.5(b): `primary_issue_summary_terse` / `_standard` / `_engaged` template keys added; consumer site picks by trust level.
- K.5(c): swing analysis runs in chunks of 2 (Promise.all) preserving prior_issues context-passing between chunks. ~N/2 × 4s wall-clock.
- Phase H #28: explicit "GPS distance unavailable" disclaimer baked into the lie-analysis vision prompt context block when `current_hole != null && distance_to_green_yards == null`.
- Phase J.5: `DrillCard` "Open Drill" CTA now passes `?drill_id=X` query param; `app/(tabs)/swinglab.tsx` reads the param on mount and auto-expands the matching drill.
| `courseGeometryService.ts` | Course geometry fetch and cache (mem + AsyncStorage, weekly refresh). Returns per-hole tee/green coordinates and reserved fairway/green-outline arrays for richer future sources. | Infra (Caddie + Coach consume) |
| `roles/caddieRole.ts` | Re-export hub for Caddie-register services. No implementation. | Caddie |
| `roles/coachRole.ts` | Re-export hub for Coach-register services and recap surfaces. No implementation. | Coach |
| `roles/psychologistRole.ts` | Re-export hub for Psychologist-register services (relationship, proactive, filler). No implementation. | Psychologist |
| `modeSelector.ts` | `selectMode(signals)` — picks a role for a moment. Surface-hint driven today; richer signal logic staged for a later phase. | Mode-neutral |

The hole-shot-map UI lives at `components/recap/HoleShotMap.tsx` and the route at `app/recap/hole/[round_id]/[hole].tsx` — both Coach surfaces.

## Other

| File | Purpose |
|---|---|
| `briefingGenerator.ts` | Pre-round briefing generation pipeline. |
| `recapGenerator.ts` | Post-round recap generation. |
| `patternDetection.ts` | On-device round pattern insights, fed to brain for context. |
| `proactiveKevin.ts` | Decides when Kevin proactively speaks during a round. |
| `featureAccess.ts` | Gates Pro features by subscription status. |
| `golfCourseApi.ts` | Course search, hole geometry, course context summaries. |
| `planStorage.ts` | Persisted hole plans and round recaps (AsyncStorage). |
| `rulesEngine.ts` | Rules-of-golf decisions for penalty UX. |


## Phase O — Earbud Tap-to-Talk

| File | Purpose | Role |
|---|---|---|
| `audioRoutingService.ts` | Tracks output route (phone speaker vs wired vs Bluetooth). expo-av polling-based best-effort detector; returns `unknown` until a native event listener ships. Listening session uses it to suppress TTS on phone speaker unless user opts in. | Infra |
| `earbudControl.ts` | Event-bus shape for earbud media-key taps. `notifyEarbudTap()` is the single entry point — fired today by the on-screen `TapToTalkButton` fallback; will be fired by a native iOS MPRemoteCommandCenter / Android MediaSession detector once that ships, with no consumer-site changes required. | Infra |
| `listeningSession.ts` | Single-tap listening session orchestrator. State machine (`idle → opening → listening → thinking → responding`). Picks a role-aware (Caddie if round active, Coach otherwise) and trust-aware opener via `dialogEngine` (`earbud_open` template; L1 returns terse `"Yeah?"`), captures an utterance, routes through the existing `/api/voice-intent` classifier, executes the matched handler, speaks the response. Re-tap at any phase closes the session. | Caddie + Coach |

**Phase O scope.** Orchestration, audio routing, opener templates, settings (`earbudTapToTalk`, `voiceOnPhoneSpeaker`), and on-screen Tap-to-Talk fallback button on the Caddie home are all live. The native key-event bridge ships in Phase O.5 below.

## Phase O.5 — Real Bluetooth Media Key Detection

| File | Purpose | Role |
|---|---|---|
| `mediaKeyBridge.ts` | Wraps `react-native-track-player` to register a media session that captures hardware play/pause events from connected Bluetooth earbuds. Both `RemotePlay` and `RemotePause` route to a single tap signal that fires `notifyEarbudTap()` (the existing Phase O seam). Lifecycle: media session is activated only while a round is active OR the user is on a Cage / Arena surface — outside those contexts, system media controls revert to other apps (Spotify, podcasts) untouched. Uses a phantom (1ms silence) track because track-player needs a queue item to keep remote-command callbacks alive; we never call `play()`. | Infra |

**Phase O.5 build requirement.** `react-native-track-player` is not compatible with Expo Go. A one-time `eas build --profile development --platform <ios\|android>` is required to pick up the new native module. The TypeScript layer ships over the air thereafter. iOS needs `UIBackgroundModes: ["audio"]` (added to `app.json`); Android needs `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` permissions (added).

**Audio safety hardening (Phase O.5).** `services/voiceService.ts` `speak()` now consults `voiceEnabled` + audio route + `voiceOnPhoneSpeaker` at the top of every call. Closes the audit-flagged blast leaks at `app/hole-view.tsx` (SmartVision) and `services/conversationalLoggingOrchestrator.ts` (shot-prompt) without touching their callsites — single source of truth.

## Phase P — Latency Masking

| File | Purpose | Role |
|---|---|---|
| `responseRouter.ts` | Per-intent routing decision: direct handler / Haiku / Sonnet, plus filler category to play during the gap. Single source of truth for the table in [docs/voice-routing.md](../docs/voice-routing.md). All future model migrations live here. | Mode-neutral |
| `fillerLibrary.ts` (extended) | Phase A.4 library extended with 8 Phase P contextual categories (`looking`, `thinking`, `checking`, `analyzing`, `acknowledging`, `confirming`, `engaging`, `casual`). Voice-hash bumped to v2 → regenerates on next boot. Round-robin selection avoids robotic repetition. | Mode-neutral |
| `listeningSession.ts` (extended) | Now consults `responseRouter` after intent classification, fires the prescribed filler clip via `playLocalFile` in parallel with handler.execute(), waits for both before speaking the real response. TTFA timestamps logged via `console.log('[ttfa] ...')` — scrapeable from device logs without a metrics pipeline. | Caddie + Coach |

**Phase P finding.** The runtime conversation loop is already optimal: in-loop calls are Haiku (intent classification) + direct synchronous handlers + TTS. No Sonnet on the hot path. The "Hey— [silence]" gap was the cumulative intent-classifier + TTS latency (~1.0–1.4s); Phase P bridges that gap with pre-rendered clips. Out-of-band Sonnet calls (lie analysis, swing analysis, course content, recap, briefing, CV scoring) live on UI surfaces with their own loading states; `fillerForSonnetVision()` in `responseRouter` exposes the canonical filler vocabulary for those surfaces too.

**Cage Session silence (Phase O.5).** `app/cage/session.tsx` calls `setSuppressed(true)` on mount, restored on unmount. While the user is in active swing capture, earbud taps are silently ignored so a tap mid-swing doesn't fire Kevin TTS over the recording. PostSessionReview gets normal earbud behavior again.

