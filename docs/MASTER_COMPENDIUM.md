# SmartPlay Caddie — Master Compendium

**Generated:** 2026-05-17
**Bundle head:** `fdf96f5` (Voice path: fix listening-pill small-talk drop + filler-clip queue latency)
**Channel state:** `preview` OTA `3c6020d6` on `1.0.0` runtime
**Repo:** `/Users/timothyg/Documents/smartplay`

This is the single authoritative snapshot of where SmartPlay Caddie actually is. Architecture, phases shipped, decisions made, current capabilities, deferred items, known issues, file organization, dependencies. Read this and you should understand the complete current state without needing to dig through git history or audit docs.

---

## 1. Project Overview

### Product Vision
SmartPlay Caddie is an AI-powered golf companion (Android/iOS, Expo / React Native). It blends a conversational caddie character team, GPS-based shot detection, vision-based swing analysis, course imagery, and tools for practice and on-course play. The differentiator over conventional rangefinder + scoring apps is **personality + presence**: a caddie that talks to you, learns you, and adapts to context — pre-round, mid-round, between shots, on the range, in the cage.

### Three-Pillar Architecture
The app is organized around three pillars, each with its own surfaces, primary caddie register, and verification path:

| Pillar | Surfaces | Primary Role | Path |
|---|---|---|---|
| **Round** | Play tab, Caddie tab cockpit, Scorecard | Caddie (tactical, in-the-moment) | Path 2 |
| **Practice** | SwingLab tab, Cage Mode, Range Mode, SmartMotion | Coach (instructional, swing-analysis-aware) | Path 3 |
| **Play / Social** | Dashboard, Arena practice drills, Recap | Psychologist (cross-round, observational, regulation) | — |

Path 1 (Onboarding) and Path 4 (Voice) cross all three pillars.

### Four-Character Team Caddie System
Per `lib/persona.ts`:

- **Kevin** — original, balanced, all-around (default for new users)
- **Tank** — Marine vet intensity, clipped cadence, no-BS
- **Serena** — analytical, calm, female voice
- **Harry** — Army medic vet wisdom (soft-removed from `ACTIVE_PERSONAS` per Phase BS; migration v6 maps persisted Harry → Kevin; assets retained for one-line re-enable)

Each persona has a per-pillar assignment (`store/settingsStore.ts` → `caddieAssignments`) so the user can run Tank for cage and Serena for round, for instance. Three-register interpretation (Caddie / Coach / Psychologist) is built into each character spec at `constants/{kevin,serena,tank,harry}Character.ts`.

### Tutorial-to-Caddie Loop
- Drill catalogs and pro-instructor videos (`data/drillCatalog.ts`, `data/instructorVideos.ts`) live in SwingLab → Drills.
- The caddie can route to a drill mid-conversation via `open_tool` intent.
- Per-issue drill recommendations come out of Phase K analysis (swing video → primary issue → drill) and surface as a card in the swing detail screen.
- Phase BR tutorial extraction pipeline (documented in `docs/tutorial-analysis-architecture.md`) takes an instructional video and produces structured guidance the caddie can reference conversationally.

### Multi-Modal Sensing Approach
- **GPS** — `services/gpsManager.ts` is a single adaptive subscription (active / walking / stationary) consumed by SmartFinder, SmartVision, shot detection, and movement-mode detector.
- **Acoustic** — `services/acousticImpactDetector.ts` runs a parallel Audio.Recording with metering, detects strikes via peak-then-decay validation (multi-shot) or global-peak (single-shot). Single-shot mode for SmartMotion / cage-drill / on-course "record this shot"; multi-shot mode for range sessions.
- **Pose / Vision** — Anthropic Sonnet 4.6 vision via `api/swing-analysis.ts` for primary-issue classification; RapidAPI pose-detection via `api/pose-analysis.ts` for keypoints (opt-in, env-gated); body overlay + swing-arc trace at `components/swinglab/SwingBodyOverlay.tsx`.
- **Camera** — `expo-camera` (CameraView) for SmartFinder reticle, lie analysis, cage capture, hero-shot capture, club identification.
- **Motion / IMU** — `expo-sensors` DeviceMotion for SmartFinder tilt + Putt slope hint.

### Persistent Context Architecture
- 14 Zustand stores under `store/` persisted via AsyncStorage with SSR-safe storage adapter (`services/ssrSafeStorage.ts`).
- Settings store version 7 (last migration: flip `voiceOnPhoneSpeaker` default to true).
- Round state survives tab switches and app backgrounding; hydration race protected via `whenRoundStoreHydrated()` helper.
- Relationship engine (`services/relationshipEngine.ts` + `store/relationshipStore.ts`) tracks rounds together, breakthroughs, confidence-by-club so the caddie remembers you across rounds.
- Conversation buffer in `services/conversationState.ts` — `recordUserTurn` / `recordKevinTurn` / `getRecentTurns` / `isAwaitingFollowUp`.

---

## 2. Phases Shipped — Complete Chronological Log

### Foundation (pre-Phase-numbered)
- v3 → Pro port: tab restructure, Cockpit Mode, BrandHeader, GlobalToolsMenu, Acoustic Test Bench, Camera Setup gate, diagnostic Drills catalog, Arena Practice, SmartMotion sessions 1–3 (DSP body, calibration, on-device acoustic), translation override, language hardwire, persona name resolution fix, mic-permission cache fix, accuracy fallback ladder, a11y + theme tokens, iOS UIBackgroundModes dedupe, hooks `useShallow` perf pass.

### Phases BH–BO (Caddie pillar deepening, courses, voice path)
- **Phase BH** — Caddie touch feedback, clean wind, hole-1 GPS recalibrate.
- **Phase BI** — SmartPlay Caddie Pro rename + custom caddie + L4 fix.
- **Phase BJ** — On-course conversational logging end-to-end.
- **Phase BK** — Fold open Start Round + auto-close fix.
- **Phase BL** — Bay Area courses (Crystal Springs, Mariners Point); also auto club detection scaffold (later named explicitly).
- **Phase BM** — v1.0 scope working session + voice path fix (two-caddie overlap, lag).
- **Phase BN** — Start Round button: uniform low anchor + zIndex 50.
- **Phase BO.1** — Acoustic Test Bench port from V3.

### Phase BV / BW / BX / BY / BZ (Cage pipeline reconciliation)
- **Phase BV** — Reconcile dual cage UIs to single canonical `CageSessionOverlay`.
- **Phase BW** — Per-detection clip extraction + Phase K reshape.
- **Phase BX** — Cage pipeline telemetry markers (`[path3:cage:*]`).
- **Phase BY-quick** — Detection signal-to-noise hardening.
- **Phase BZ-v1** — Review UI uplift: playback, comparison, share, annotation.
- **Phase BV-PREP** — Empirical verification gate documentation (Galaxy Z Fold MIN VERIFY).

### Phase 100 (Comprehensive audit + fix sweep)
- **Phase 100** — Audit Components 1–5, persona verdicts, critical paths, health, fix sequence F1–F14.
- **Phase 100/F2 + F13** — Persona-correctness sweep on `getCaddieName` call sites.
- **Phase 100/F3** — Lint baseline 1 error + 6 warnings → 0/0.
- **Phase 100/F5** — Document 3 in-source TODOs as v1.2-deferred.
- **Phase 100/F11** — AbortSignal.timeout polyfill (Hermes / Z Fold).
- **Phase 100/cleanup** — Asset orphan inventory + expo-doctor pass.

### Phase 101 (Audit follow-up — voice, persistence, performance, security)
13 commits covering: voice file write race (S4), text validation in `api/voice.ts` (B3), filler TTS parallelization (W3+S4), server-side persona handling sweep across `api/*` (B4), Anthropic ephemeral prompt caching on hot endpoints (W4), persistence safety pass (S2+S3+S5), audioLifecycle teardown completeness (S1), Anthropic + OpenAI SDK timeouts (S7), caddie.tsx selector + dead-memo cleanup (W1+W2), SmartVision + KevinPresence context value memoization (W6), small component + lie-analysis fixes (W8+W9+W10).

### Phase 102–105 (Character depth)
- **Phase 102** — Serena character depth (backstory, voice, three-register).
- **Phase 103** — Tank character depth (Marine vet intensity).
- **Phase 104** — Harry character depth (Army medic vet wisdom).
- **Phase 105/C1** — Kevin spec refresh (drop Tank-as-mentor lore).
- **Phase 105** — Team caddie architecture (per-pillar assignment, four caddies as team).
- **Phase 106** — Adaptive caddie defer + team intelligence.

### Phase 107–111 (Tools pillar)
- **Phase 107** — GPS framework audit + SmartFinder rangefinder accuracy (Garmin-comparable).
- **Phase 108** — SmartVision tee box orientation correction + T marker draggable when no round active.
- **Phase 109** — Shot tracking end-to-end validation.
- **Phase 110** — Voice media commands (record/watch/open video).
- **Phase 110-followup** — Round-side capture surface (`CaptureOverlay`).
- **Phase 111** — SwingLab cleanup + Primary Issue cards with reputable instructor examples + Common Faults collapsible.

### Phase 200–202 (Audit cycle 2 + Sim)
- **Phase 200** — v1.1 final audit + sim check + fix.
- **Phase 201** — Comprehensive function simulation (4 caddies × round + cage + voice + context + team).
- **Phase 202 follow-up** — Z Fold reflow, voice race, Tank disaster discipline, PACE CHECK.
- **PGA HOPE re-sim follow-up** — Lifetime owner override + Course Detail polish.

### Subscription kill-switch + Auth scaffold + Course expansion
- Subscriptions disabled globally (`SUBSCRIPTIONS_ENABLED=false`); everyone is lifetime.
- Menifee Lakes (Lakes) + Rancho California added to local-courses picker.
- EAS Update wired for OTA delivery to tester APKs.
- Z Fold avatar half-face: real fix + Sign Out / Reset App Data.

### Phase 400-series (Tools deep work)
- **Phase 400-followup** — SmartFinder polish (backgrounding, geometry messaging, mode toggle, telemetry).
- **Phase 401** — SmartVision full hole view + true tee box anchoring (no more draggable workaround).
- **Phase 402** — Auto club detection substantial implementation.
- **Phase 403** — SmartMotion Quick (course-mode swing capture, acoustic auto-stop) + substantial analysis with visual evidence.
- **Phase 404** — Reference swing comparison (side-by-side with user fault frames).
- **Phase 405 / 405b** — Course Detail page fixes; in-app Reference Authoring tool for Tank.
- **Phase 405 wave 1** — GPS ecosystem audit + geometry pre-warm + off-course indicator.
- **Phase 405 wave 2** — GPS stale-signal callout + hole re-entry safeguard.
- **Phase 405 wave 3** — Round-start orchestration, tee selection, cart/walk mode, background-GPS native config; course auto-detect banner, at-ball flow, Recap landscape graceful.
- **Phase 405 wave 4** — Background-GPS code wiring (TaskManager + foreground service + dual-source ingest).
- **Phase 406 wave 1** — Landscape audit + shared device-layout hook + SmartVision split-screen.
- **Phase 406 wave 2** — SmartFinder graceful landscape (maxWidth on non-camera modes).
- **Phase 407** — Course locator GPS-based default ordering (nearest course first).
- **Phase 408** — Caddie voice pacing + energy refinement (per-persona ElevenLabs tuning).
- **Phase 409** — TightLie substantial integration (persistence + caddie brain).
- **Phase 410** — User profile storage + login audit and hardening for beta-tester ready.
- **Phase 410B** — Google + Supabase auth scaffold (SHIPPED then REVERTED — `d5cf1df`, awaiting env values).
- **Phase 411** — In-app Quick Start Guide + harden background-task module-load.
- **Phase 411 followup** — Swap Quick Start content to Tim's canonical PDF version.

### Phase 500-series (Audit + clean for beta)
- **Phase 500** — Deep code-walk audit + cleanup for clean testing (19 lint warnings → 0).
- **Phase 501** — Audit verdict GREEN + dedupe LieAnalysis type in `kevin+api`.

### 2026-05-15 → 2026-05-17 sprint (round-day prep for Sunnyvale)
- Sunnyvale Golf Course + San Jose Municipal — 18 bundled hole images each.
- Active Listening: discoverable + tappable + voice-controllable.
- Background-location permissions in pre-flight + visible GPS banner.
- ROOT CAUSE fixes: `Sentry.ErrorBoundary` swallowing crashes; `GpsQualityOverlay` returning new object each render (infinite loop white-screen).
- Push-to-talk vs Active Listening mic-ownership race fixed.
- Clamp `setCurrentHole` to course hole count.
- SmartMotion Quick rewrite — manual START/STOP + inline analysis loop.
- Fix double-speak + canned analysis copy for swing reviews.
- Swing Library UI cleanup.
- Bypass intent router when caddie is awaiting a follow-up reply.
- Suppress global CaptionStrip on Caddie tab (duplicate of Cockpit bubble).
- Course detail UI theme awareness + loading timeout.
- Round-end integrity: auto recap + handicap pipeline + longer toast.
- SmartMotion Quick voice "ready" wake word + 1/3/5/10 loop mode.
- Tank avatars: clean v2 set (drop labeled v1 images).
- Course detail uses real per-hole data from `data/courses.ts` for local courses (Mariners is 9 par-3, not 18×380y).
- Play tab notes (mic + done) + Sunnyvale/SJM hole arrays.
- Unblock pre-round planning — SmartVision opens for any picked course and plans persist into the round.
- End Round Save/Discard dialog + Owner-only "Kevin log this" issue logging.
- Polish pass: thumbnails (yardage corner chip + dark fallback bg), viewer snap, Book Tee Time recolor, SwingLab BETA labels off, Kevin 2nd-response disconnect (stopSpeaking before real reply).
- Video replay: SwingBodyOverlay (skeleton + swing-trace SVG) on swing detail player.
- Acoustics cohesion: Range Mode routes to multi-shot; strike event bus on `acousticImpactDetector`.
- Cart Mode: cart-aware GPS shot detection thresholds + Settings toggle + voice command.
- Round-day tooling: fresh-GPS button + hole picker in Log Shot sheet; hero-shot replay+share review pane.
- Pre-round SmartVision green-screen final fix (cascade to homeCourse → Palms hard fallback).
- Voice-on-phone-speaker default ON (persist migrate v7).
- Wake-word gate for Active Listening — SHIPPED then REVERTED (was silently dropping caddie greetings).
- PuttWatch v1 — voice intent + Putt/Chip tags.
- Voice path: fix listening-pill small-talk drop (`chatJson.text` not `chatJson.response`) + tighten filler-clip queue latency.

### Empirical Verification Status
Most recent OTAs (b225665 → fdf96f5) ship via `preview` channel and were force-quit-relaunch-verified by Tim on his Z Fold over 2026-05-16/17 evening. Hard-failure paths (white screens, voice silence) caught and fixed iteratively. End-to-end Galaxy Z Fold MIN VERIFY across all four critical paths on a real round is pending Sunnyvale 2026-05-17.

---

## 3. Current Architecture State

### Critical Paths

#### Path 1 — Onboarding / Auth / Profile
**Current state:** Single-screen welcome (`app/welcome.tsx`) captures name + caddie + optional handicap. Returning users skip welcome (gated on `first_opened_at != null` OR non-empty name). Settings → Edit Profile routes back to `/welcome` with prior values. Reset App Data button clears state and re-routes to welcome.
**Auth:** `app/auth.tsx` is a "Coming soon" stub. Real auth (Google + Supabase) was scaffolded in Phase 410B then reverted (`d5cf1df`) awaiting env values.
**Key files:**
- `app/welcome.tsx`, `app/intro.tsx`, `app/intro-video.tsx`
- `app/onboarding/` (welcome, name, about-game, home-course, meet-kevin, mode, ready)
- `app/profile/custom-caddie.tsx`
- `store/playerProfileStore.ts` (profile state)
- `services/voiceOnboardingService.ts` (preference flow)
- `services/kevinGreeting.ts` + `services/kevinGreetingManifest.ts`
**Marker:** `[path1:onboard]`

#### Path 2 — Round (start → play → log → end → recap)
**Current state:** Full pipeline ships:
- Course picker on Play tab with GPS-nearest sorting + 7 curated local courses.
- Round factors (mode, 9 vs 18, competition, mental state, notes) consumed at start.
- `pendingStartCourseId` triggers auto-launch on Caddie tab.
- Cockpit UI shows hole #, score, current yardage, last shot, ghost-match.
- GPS shot detection auto-runs; Cart Mode tightens thresholds when toggled.
- Conversational logging orchestrator prompts "what was that shot?" 5–15s after detected events.
- End Round dialog: Save (recap + handicap pipeline + archive) vs Discard (full reset).
- QuickLogShotSheet manual log fallback with fresh-GPS + hole-override.
**Key files:**
- `app/(tabs)/play.tsx` (course pick, pre-round setup, start, end)
- `app/(tabs)/caddie.tsx` (cockpit, mic, tools menu) — ~2300 lines
- `app/(tabs)/scorecard.tsx`
- `store/roundStore.ts` (canonical round state; `startRound`, `endRound`, `discardRound`, `logShot`, plans, recap)
- `services/shotDetectionService.ts` (GPS-displacement detector, cart-aware)
- `services/conversationalLoggingOrchestrator.ts` (auto-prompt pipeline)
- `services/gpsManager.ts` + `services/backgroundLocationTask.ts`
- `services/shotLocationService.ts`, `services/movementModeDetector.ts`
- `services/holeDetection.ts`, `services/courseGeometryService.ts`
- `services/golfCourseApi.ts` (golfcourseapi proxy)
**Marker:** `[path2:round]`

#### Path 3 — Cage / Practice (capture → analyze → drill)
**Current state:** Canonical UI is `CageSessionOverlay`, mounted at `/cage/session` AND inline via SwingLab → Cage. Multi-shot mode for range sessions; single-shot mode for SmartMotion Quick on-course swings. Phase K analysis pipeline per-shot, fire-and-forget on upload. Pose biomechanics opt-in (RapidAPI gated). Swing detail screen renders video + biomechanics card + body overlay + swing trace.
**Key files:**
- `components/CageSessionOverlay.tsx` (canonical UI)
- `app/cage/session.tsx`, `app/cage/summary.tsx`, `app/cage/history.tsx`
- `app/smartmotion-quick.tsx` (single-swing on any surface)
- `app/swinglab/cage-drill.tsx` (single-shot capture screen post-Camera-Setup)
- `app/swinglab/swing/[swing_id].tsx` (detail screen + body overlay)
- `store/cageStore.ts`, `store/cageCalibrationStore.ts`
- `services/videoUpload.ts` (Phase K orchestrator)
- `services/swingCapture.ts`, `services/mediaCapture.ts`
- `services/acousticImpactDetector.ts` (single + multi-shot)
- `services/poseDetection.ts`, `services/poseInference.ts`, `services/poseAnalysisApi.ts`
- `services/swingIssueClassifier.ts` (LLM-output → canonical issue)
- `api/cage-coach.ts`, `api/swing-analysis.ts`, `api/pose-analysis.ts`
- `components/swinglab/SwingBodyOverlay.tsx` (skeleton + swing trace)
**Marker:** `[path3:cage]` (overlaps `[V6-DIAG]`)

#### Path 4 — Voice (mic → intent → response)
**Current state:** Two entry points share the same downstream pipeline:
1. **Cockpit mic / avatar tap** — `hooks/useVoiceCaddie.ts` → `processAudioUri` → STT → intent router → brain → speak.
2. **Brand-header listening pill** — `services/listeningSession.ts` → `toggle()` → captureUtterance → intent router → handler OR chat fallback.
Active Listening (VAD) on the Caddie tab uses `hooks/useVoiceActivityDetection.ts` and routes through `processAudioUri`. Volume button trigger removed (no-op since native module strip). Wake-word gate proposed and reverted; opt-in setting in v1.2. Filler clips (`services/fillerLibrary.ts`) bridge perceived latency.
**Key files:**
- `services/voiceService.ts` (speak, speakFromBase64, playLocalFile, stopSpeaking, captureUtterance, isVoiceAllowed)
- `services/listeningSession.ts` (long-running mic loop)
- `hooks/useVoiceCaddie.ts` (mic UX + processAudioUri)
- `hooks/useVoiceActivityDetection.ts` (VAD)
- `services/audioRoutingService.ts` (route detection — always 'unknown' until native bridge)
- `services/audioLifecycle.ts`
- `services/conversationState.ts` (turn buffer + follow-up gate)
- `services/responseRouter.ts` (filler decision per intent)
- `services/fillerLibrary.ts` + `constants/fillerPhrases.ts`
- `services/voiceCommandRouter.ts` + `services/voiceHandlerRegistry.ts`
- `services/intents/*` (15 handlers — open_tool, query_status, change_setting, navigate, help, acknowledge, set_trust_quiet/companion, club_change/query/menu, log_shot, log_issue, media_capture, media_playback, put_watch, at_my_ball, rules_query, handicap_query, in_round_diagnostic)
- `api/voice-intent.ts` + `app/api/voice-intent+api.ts` (Haiku 4.5 classifier)
- `api/voice.ts` + `app/api/voice+api.ts` (TTS: ElevenLabs primary, OpenAI fallback)
- `api/kevin.ts` + `app/api/kevin+api.ts` (brain)
- `api/transcribe.ts` (Whisper)
**Marker:** `[path4:voice]` + `[ttfa]` (time-to-first-audio instrumentation)

### Character System

Per `lib/persona.ts` (`Persona = 'kevin' | 'serena' | 'harry' | 'tank'`) and `api/voice.ts` / `app/api/voice+api.ts`:

| Persona | ElevenLabs Voice ID | stability | similarity | style | speaker_boost | Notes |
|---|---|---|---|---|---|---|
| Kevin | `1fz2mW1imKTf5Ryjk5su` | 0.45 | 0.75 | 0.55 | true | warm, faster, upbeat; default fallback |
| Serena | `RGb96Dcl0k5eVje8EBch` | 0.50 | 0.75 | 0.50 | true | confident, energetic-professional |
| Tank | `gQOVuaEi4cxS2vkZAK3A` | 0.35 | 0.70 | 0.70 | true | intense, fast, commanding |
| Harry | `5Jfxy1x2Df4No3LQBZXE` | 0.65 | 0.80 | 0.30 | true | measured wisdom (soft-removed — see below) |

**ACTIVE_PERSONAS = ['kevin', 'serena', 'tank']**. Harry voice/spec/avatars retained; settings v6 migration maps persisted Harry → Kevin. Re-enable Harry by adding back to `ACTIVE_PERSONAS`.

**Per-pillar assignment:** `store/settingsStore.ts → caddieAssignments` is `{ round, cage, drills, play } → Persona`. Tim can run Tank on cage and Serena on round simultaneously.

**Three-register interpretation:** every persona has a Caddie / Coach / Psychologist mode defined in their character spec; the system prompt is composed from `getCharacterSpecFor(persona)` and the active register.

**Assets:** `assets/avatars/{kevin,serena,harry,tank}_*` — per Phase 100 Component 8 there are 24 PNG/JPG orphans (~5.1 MB) inventoried for cleanup deferred to v1.2.

**Voice model:** `eleven_turbo_v2` for English (note: `app/api/voice+api.ts` still uses `eleven_monolingual_v1`); `eleven_multilingual_v2` for Spanish + Chinese.

**OpenAI fallback:** `gpt-4o-mini-tts` with onyx (male) / nova (female) voices when ElevenLabs returns a non-2xx or key is missing. Instructions sourced from `api/_kevinVoice.ts` (`KEVIN_TTS_INSTRUCTIONS`).

### Tools — Current State

#### SmartFinder (`app/smartfinder.tsx`)
Phase D-2; four modes: Standard (camera + reticle), Target (SVG-tap), Map, Putt (two-point with slope hint via DeviceMotion). Mode persisted via `useSmartFinderStore`. GPS quality overlay always visible; lock duration 30s; 3s refresh. **Garmin-comparable accuracy** per Phase 107 audit.
**Key files:** `services/smartFinderService.ts`, `services/rangefinder.ts`, `components/smartfinder/`.

#### SmartVision (`app/smartvision.tsx`)
Phase AV "GolfShot-class hole view". Mapbox satellite tile rotated tee→green vertical, with three draggable markers (T tee / Y target / P pin) and live Front/Middle/Back yardage. Yardages computed via haversine on green F/M/B; Mapbox projection via `services/mapboxImagery.ts`. **Pre-round cascade fallback** (Phase 502 OTA `cdccd01c`): `activeCourseId → pendingStartCourseId → previewCourseId → homeCourseId → 'local:palms'` — guarantees imagery renders for any access path. **Curated mode** uses bundled per-hole JPGs; **GPS mode** uses Mapbox; **Auto** mode prefers curated when available, falls through to Mapbox.
**Key files:** `services/mapboxImagery.ts`, `services/courseGeometryService.ts`, `services/golfbertApi.ts`, `data/localCourseImages.ts`.

#### TightLie (`app/lie-analysis.tsx`)
Phase AS rebrand of "lie analysis" + Phase 409 substantial integration. Standalone camera button removed (Phase AU); reached only via Tools menu or voice ("open TightLie", "check my lie", "what's the play"). Pipeline: camera capture → Sonnet 4.6 vision (`api/lie-analysis.ts`) → persist → caddie brain consumes pending analysis in system prompt.
**Key files:** `services/lieAnalysisService.ts`, `services/lieAnalysisContext.ts`, `api/lie-analysis.ts`, `components/lieAnalysis/`.

#### Auto Club Detection (`services/clubRecognition.ts` + `api/club-recognition.ts`)
Phase BL + Phase 402. Sends base64 sole photo to Anthropic Sonnet vision; returns `{ club_id, club_type, confidence }`. Three-tier UX: high confidence auto-registers, medium confirms, low/`unknown` falls back to manual grid. Capture lives in cage UI (`components/cage/ClubIdentifyControls.tsx`, `ClubPickerModal.tsx`).

#### SmartMotion / Phase K (`app/smartmotion-quick.tsx` + `services/videoUpload.ts`)
2026-05-16 rewrite: manual record loop `REQUESTING → READY → RECORDING → SAVING → ANALYZING → RESULTS`. Voice mode wake-words (`ready`/`go`/`swing`/`hit it`) + 1/3/5/10 loop counts. Acoustic auto-stop optional (single-shot mode). Inline results: primary issue + feel cue + drill. "Record another" loops back to READY without leaving the screen.
`runPhaseKOnSession` (Phase K orchestrator, `services/videoUpload.ts` L123-490) does per-shot Anthropic vision, then fires opt-in pose biomechanics. `ingestSession` (L495+) kicks off Phase K fire-and-forget after upload.

#### Hero Shot Capture (`components/CaptureOverlay.tsx`)
Voice intent `media_capture` with `capture_type: 'highlight'`. 5-second auto-stop (acoustic-aware). Post-record review pane: looping `<Video>` + Share (expo-sharing) + Done. Highlight kind also back-references to current hole's most recent shot (`is_highlight: true`).

#### PuttWatch v1 (`services/intents/mediaHandlers.ts` → `puttWatchHandler`)
Voice intent `putt_watch` (shot_type: 'putt' | 'chip'). Caddie ACKs only — Meta Ray-Ban SDK doesn't expose the glasses camera to third-party apps. User records via "Hey Meta, record a video"; clip syncs through Meta View to phone gallery. Upload via SwingLab → Upload with Putt or Chip tag → analysis runs. **Body overlay renders on the upload's video automatically.**

### Integrations

| Service | Status | Notes |
|---|---|---|
| **Anthropic Claude** | Live | `@anthropic-ai/sdk ^0.95.1`. Models: `claude-sonnet-4-6` (vision + heavy reasoning across 10 endpoints), `claude-sonnet-4-5` (kevin fallback), `claude-haiku-4-5-20251001` (voice-intent + parse-shot + cage-review + kevin TACTICAL branch). Ephemeral prompt caching enabled on hot endpoints (Phase 101/W4). |
| **ElevenLabs TTS** | Live | 4 voice IDs per-persona (Phase 408 tuning). `ELEVENLABS_API_KEY` env. Models: `eleven_turbo_v2` (en), `eleven_multilingual_v2` (es, zh). |
| **OpenAI** | Live (fallback) | Whisper for transcribe (`api/transcribe.ts`). `gpt-4o-mini-tts` (onyx/nova) when ElevenLabs unavailable. |
| **Supabase** | NOT WIRED | Auth scaffold reverted (`d5cf1df`). `app/auth.tsx` is a stub. v1.2. |
| **golfcourseapi** | Live | `services/golfCourseApi.ts` + `api/course-proxy.ts`. 30-day filesystem cache. Source of course discovery + geometry. |
| **Golfbert** | Live (premium) | `services/golfbertApi.ts` + `api/golfbert-proxy.ts` + AWS SigV4. Premium geometry for select courses (`constants/golfbertCourses.ts`). |
| **Mapbox Static Images** | Live | `EXPO_PUBLIC_MAPBOX_TOKEN`. Per-hole tiles + SmartVision aerials. |
| **Stripe** | NOT WIRED | `lib/pricing.ts` has tier table with `stripeProductId: 'TBD'`. `SUBSCRIPTIONS_ENABLED=false` kill-switch — everyone is lifetime. Phase 2B. |
| **expo-camera** | Live | `CameraView` for SmartFinder, lie-analysis, cage, hero-shot, club ID. No `react-native-vision-camera`. |
| **expo-location** | Live | `~19.0.8`. `expo-task-manager` for background. Single `gpsManager` singleton. |
| **expo-av** | Live | TTS playback + recording + Video for swing replay. |
| **expo-sensors** | Live | DeviceMotion for SmartFinder tilt + Putt slope. |
| **react-native-svg** | Live | SVG overlays (skeleton + swing trace + SmartVision lines). |
| **Sentry** | INSTALLED, DSN unset | `@sentry/react-native ~7.2.0`. `Sentry.init` at `app/_layout.tsx:59` gated on `EXPO_PUBLIC_SENTRY_DSN`. `SENTRY_DISABLE_AUTO_UPLOAD=true` in all eas.json (correct while DSN missing). Effectively breadcrumb-only sink. v1.2 wire-up. |
| **RapidAPI Pose** | Live (opt-in) | `api/pose-analysis.ts`. `POSE_API_KEY` + `POSE_API_HOST`. Gracefully no-ops without keys (503 + client fall-through). |

---

## 4. File Structure Overview

```
/Users/timothyg/Documents/smartplay/
├── app/                     # Expo Router screens
│   ├── _layout.tsx          # Root: Sentry init, AbortSignal polyfill, GPS lifecycle, listening lifecycle, capture overlay mount
│   ├── (tabs)/              # Bottom tabs: caddie, dashboard, play, scorecard, swinglab
│   ├── api/                 # Expo Router server routes (+api.ts variants)
│   ├── onboarding/          # Onboarding flow screens
│   ├── cage/                # Cage Mode entry + session + summary + history
│   ├── swinglab/            # Cage Mode capture, Range Mode, drills, library, swing detail
│   ├── round/               # Briefing
│   ├── arena/               # Practice drills (5 routes)
│   ├── drills/              # Per-issue drill detail
│   ├── recap/               # Recap by round id
│   ├── course/              # Course detail by id
│   ├── settings/            # Trust level, custom caddie
│   ├── smartfinder.tsx      # Rangefinder tool
│   ├── smartvision.tsx      # Top-down hole preview
│   ├── smartmotion-quick.tsx# Single-swing capture
│   ├── lie-analysis.tsx     # TightLie
│   ├── owner-logs.tsx       # Owner Issue Log
│   ├── acoustic-test.tsx    # Acoustic Test Bench
│   ├── auth.tsx             # Stub
│   └── welcome.tsx          # Single-screen onboarding
├── api/                     # Vercel serverless mirrors (deployed standalone)
├── services/                # Business logic
│   └── intents/             # 15 voice intent handlers + router
├── store/                   # 14 Zustand stores (persisted via SSR-safe AsyncStorage)
├── hooks/                   # React hooks (useKevin, useVoiceCaddie, useVAD, etc.)
├── components/              # UI components, grouped by feature
│   ├── caddie/              # Cockpit + L1HolePreview
│   ├── cage/                # ClubIdentifyControls, ClubPickerModal
│   ├── course/              # CourseDetailModal, HolePhotosGrid, HoleGuide
│   ├── smartfinder/
│   ├── smartvision/
│   ├── swinglab/            # PrimaryIssueCard, DrillCard, SwingBodyOverlay, SwingActionSheet
│   ├── lieAnalysis/
│   ├── recap/
│   ├── tools/               # GlobalToolsMenu
│   └── battery/
├── data/                    # Static catalogs
│   ├── courses.ts           # Hand-coded per-hole arrays (Palms, Lakes, Rancho, Crystal Springs, Mariners, Sunnyvale, San Jose Muni)
│   ├── localCourseImages.ts # Bundled hole JPG require() map
│   ├── drillCatalog.ts
│   ├── instructorVideos.ts
│   ├── palmsImages.ts
│   ├── rulesReference.ts
│   ├── simulatedWalks.ts
│   └── landmarks/palms.json
├── constants/               # Character specs + tables
│   ├── kevinCharacter.ts
│   ├── serenaCharacter.ts
│   ├── tankCharacter.ts
│   ├── harryCharacter.ts
│   ├── cageDetection.ts     # Multi-shot tuning thresholds
│   ├── fillerPhrases.ts
│   ├── golfbertCourses.ts
│   ├── primaryIssueCatalog.ts
│   ├── theme.ts
│   └── dialogTemplates/
├── types/                   # TS types
├── assets/                  # Avatars, course imagery, brand
│   ├── avatars/             # Per-persona PNG slots
│   └── courses/             # Per-course hole-NN.jpg
├── lib/                     # Cross-cutting
│   ├── persona.ts           # Persona type + name/spec/voice resolution
│   └── pricing.ts           # Stripe tier table (IDs TBD)
├── docs/                    # Phase audits, architecture refs, this compendium
└── eas.json, app.json, package.json, tsconfig.json, ...
```

### Where to find what

| Looking for... | Look in... |
|---|---|
| A persona's voice settings | `api/voice.ts` ELEVEN_VOICES_BY_PERSONA + ELEVEN_SETTINGS_BY_PERSONA |
| Persona character spec | `constants/{persona}Character.ts` |
| What the caddie can be asked | `app/api/voice-intent+api.ts` (production classifier) |
| What an intent does | `services/intents/{handler}.ts` |
| Round state | `store/roundStore.ts` |
| Settings state | `store/settingsStore.ts` |
| Profile state | `store/playerProfileStore.ts` |
| GPS pipeline | `services/gpsManager.ts` (singleton) + consumers |
| Brain prompt + Sonnet/Haiku routing | `api/kevin.ts` / `app/api/kevin+api.ts` |
| Swing analysis pipeline | `services/videoUpload.ts` Phase K + `services/swingIssueClassifier.ts` |
| Pose / biomechanics | `services/poseAnalysisApi.ts` + `components/swinglab/SwingBodyOverlay.tsx` |
| Cage detection thresholds | `constants/cageDetection.ts` |
| Audit history | `docs/audit-*` |

---

## 5. Standing Decisions

Source: `CLAUDE.md` + audit verdicts.

### Critical Path Verification Gates (Phase AO)
Every phase explicitly states which of PATHS 1–4 it touches and Tim verifies end-to-end on dev-client before declaring shipped. Failed verification = pending targeted fix, never bundled. Markers: `[path1:onboard]`, `[path2:round]`, `[path3:cage]`, `[path4:voice]`, `[V6-DIAG]`, `[ttfa]`.

### Phase Report Format
Commit SHA + per-component what shipped + honest scope notes for what didn't ship + critical paths touched + expected behavior per path.

### Commit Conventions
- `Phase XX - <one-line summary>` then body paragraph.
- Co-author trailer (`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`) required.
- Never `--no-verify`. Never amend a published commit.

### Dev Environment
Windows + PowerShell. TypeScript strict. `npx tsc --noEmit` and `npx expo lint` both pass before commit. Build: `eas build --profile development --platform android`.

### AbortSignal.timeout polyfill — REQUIRED FIRST IMPORT
`services/polyfills.ts` must be the first line of `app/_layout.tsx`. Hermes on Z Fold predates the static factory. 12 fetch call sites depend on it (weather, course content, course geometry, golf course api, cage upload, pose detection, cv scoring, context synthesis).

### Persona Name Resolution
Always pass `caddiePersonality` from `useSettingsStore` to `getCaddieName()`, NOT `voiceGender`. Otherwise Tank/Harry collapse to "Kevin" across ~30 surfaces. Pronoun computations still use `voiceGender`.

### Kevin Photoreal Portrait — LOCKED (Phase AU)
Canonical commit `19165fb`. Container in `app/(tabs)/caddie.tsx`: `{ position: 'absolute', top: 0, left: 0, width: W, height: avatarFrameHeight }` with `avatarFrameHeight = Math.round(W * 16/9)`. NO aspect-ratio branches, NO `top: -70` nudges, NO `insets.top + N` anchors. `components/CaddieAvatar.tsx` transforms = breath + nod + drift only.

### Anti-patterns
- **Don't add transforms in CaddieAvatar to compensate for off-center Kevin on new devices.** Move the OTHER element. Phase AT drift (`PORTRAIT_OFFSET_F`, `baseShiftFraction`, `kevinShiftFraction`, `kevinScaleMul`) clipped his hat on Fold open — all removed in Phase AU.
- **Don't lazy-register task definitions for background OS delivery.** Anti-pattern introduced + removed via hot fix `faff1d9`.
- **Don't add features beyond phase scope.** Don't write tests for impossible scenarios. Don't add comments unless *why* is non-obvious. Trust internal code, validate only at boundaries. Say so explicitly when something can't ship honestly.
- **Don't use Grok for SmartPlay work.** Hard rule, per user memory (cost: broken Kevin + full git reset + hours lost).
- **Don't drop service worker side effects in app/_layout import paths.** Re-introduces white-screen risk.

### Feature Naming
- **TightLie** = user-facing brand for lie analysis (internal name `lie_analysis` unchanged for back-compat).
- **GolfFather** = reserved name for future strategic course-management AI; not built.

### Trust Slider Order
Cyclers must use `TRUST_LEVEL_SLIDER_ORDER = [1, 5, 2, 3, 4]`, never modulo on numeric value. (Stored in user memory.)

### Voice userInitiated Rule
`speak()` / `playLocalFile()` at launch or in response to user tap MUST pass `{ userInitiated: true }` — otherwise goes silent at L1 trust.

### No Absolute Overlay Over Icons
`pointerEvents="none"` passes taps but icons still visually hide behind overlays — check `zIndex` stack.

---

## 6. Persona Verdicts — Current

Last formal verdict was Phase 100 (`docs/audit-100-personas.md`, 2026-05-05, SHA `94e7d29`). Since then 100+ commits have shipped. Updated estimate as of head `fdf96f5`:

### Dave — Weekend Warrior
Casual rec golfer, Free Play, on-course caddie + score + voice. Doesn't use Cage. Paths: 1, 2, 4.
**Phase 100 verdict:** AT RISK (UNKNOWN bundle).
**Current (post-Sunnyvale prep sprint):** **READY pending tomorrow's empirical pass.** All four critical paths have shipped iterative hardening; voice path fixed twice (filler queue + listening-pill chat fallback); SmartVision pre-round green-screen final fix lands fallback to Palms; Cart Mode addresses the cart-play GPS detection gap. End-to-end Z Fold round verification at Sunnyvale resolves the verdict.

### Marcus — Improver (Practice-focused)
Cage 3–5x/week, uploads instructional videos, expects per-swing breakdown + drill rec + weekly progress. Paths: 3 primary, 4 secondary, BR tutorial.
**Phase 100 verdict:** AT RISK (BV/BW/BX/BY/BZ shipped but unverified).
**Current:** **READY for first-uploaded-swing demo.** SwingBodyOverlay + swing-trace shipped 2026-05-17 add a tangible visual differentiator. Phase K analysis pipeline + drill recommendation cards verified on Tim's recent uploads. Tutorial extraction pipeline (Phase BR) not yet user-facing — deferred.

### Sarah — Competitive (Tournament-prep)
Break_80 mode, rigorous shot tracking, ghost match, recap with pattern detection. Paths: 2 intensive, 4 intensive, recap.
**Phase 100 verdict:** AT RISK.
**Current:** **READY for normal-stakes round.** Round-end Save/Discard + handicap pipeline shipped. Recap Sonnet system prompt persona-aware. In-round diagnostic Coach (multi-shot pattern reasoning) wired to `intent_type: 'in_round_diagnostic'`. Manual log-shot + fresh-GPS fallback handles auto-detection misses. Tournament-grade rigor (every shot logged) requires empirical 18-hole pass.

### James — Returning (2+ weeks gap)
Cold launch with persisted non-default settings. Paths: 1 (cold-launch hydration), all surfaces if deep-customized.
**Phase 100 verdict:** AT RISK.
**Current:** **READY.** Hydration race fix shipped (`98c5822`); `app/index.tsx` blocks routing on both stores; `app/greeting.tsx` uses TTS for non-Kevin personas. Persist version 7 migration covers `voiceOnPhoneSpeaker` flip. Settings persist across restart and OTA via Zustand+AsyncStorage. Corner case: `useGhostStore`, `useRelationshipStore`, `useCageStore` not gated in hydration — deep-customized cold launch may flicker for ~1 frame.

### Aggregate
- Dave: READY pending tomorrow.
- Marcus: READY for demo, full verdict awaits per-Z-Fold cage run.
- Sarah: READY for normal-stakes round.
- James: READY.

**Single highest-leverage action:** End-to-end Sunnyvale round (Tim, 2026-05-17) resolves Dave, Sarah, and most of Marcus. James verdict held by hydration soak test.

---

## 7. Known Issues + Deferred Items

### Documented Limitations
- **Audio routing detection** (`services/audioRoutingService.ts`) — always returns `'unknown'`. Native event listener not built. `'unknown'` does NOT match `'phone_speaker'` so `isVoiceAllowed` gate doesn't trip; default behavior is "play voice on whatever's active."
- **Earbud tap-to-talk** — `services/mediaKeyBridge.ts` scaffolded but `react-native-track-player` was removed (New Arch compat). Settings row says "Coming soon" — accurate. Re-enable requires new native dep + new APK build.
- **Volume button trigger** — `hooks/useVolumeButtonTrigger.ts` is a no-op (`react-native-volume-manager` removed).
- **Background-task module-load fragility** — `services/backgroundLocationTask.ts` registers lazily at round start; OS-resurrected fixes silently dropped while JS bundle unloaded. Acceptable for v1.1 per `audit-501-verdict.md`.
- **`app/onboarding/*` unreachable** — `has_completed_onboarding` defaults to true; predates Phase 500; leave alone until after beta.
- **`app/_layout.tsx` size** — touched by 6 of 14 recent commits; future `useRoundLifecycle` hook extraction candidate.

### v1.2 Deferred (`docs/v1.2-deferred.md`)
- **TODO #1 Sentry env wire-up** — `EXPO_PUBLIC_SENTRY_DSN` + Sentry org/project to eas.json; remove `SENTRY_DISABLE_AUTO_UPLOAD=true`. Severity MINOR.
- **TODO #2 Driver-yardage default** — `services/intents/queryStatusHandler.ts:563` `const driverYards = 230`. Per-club distance accumulation needs a clubStatsStore phase.
- **TODO #3 Stripe product IDs** — `lib/pricing.ts:7` aligned with real dashboard IDs in Phase 2B billing.
- **F8 Per-clip mp4 extraction** — needs `react-native-ffmpeg` / `ffmpeg-kit-react-native` (~30MB native dep + new EAS build).
- **F14 Web SSR / Zustand-rehydrate** — SHIPPED for stores via `services/ssrSafeStorage.ts`.
- **24-file asset orphan deletion** — Tim walks per-row KEEP/DELETE/RENAME.
- **Server-side `getCaddieName(voiceGender)` sweep** across `api/*` (some routes still take gender directly).
- **Wake-word gate for Active Listening** — was shipped + reverted; return as opt-in setting in Settings → Voice rather than default-on.
- **Real auth (Phase 410B)** — Google + Supabase, scaffold reverted. 3–5 sessions per `docs/audit-410-auth-state.md`.
- **Hosted privacy policy URL** — currently `smartplaycaddie.com/privacy` is a placeholder.
- **Cloud sync** — currently zero; post-beta data informs choice.
- **Native BT media-key listener** — Kotlin module deferred until external tester requests.
- **Auto club detection accuracy refinement** — Phase BL greenfield; deferred post-1.0.
- **iOS-compliant billing** — Apple IAP + Stripe, RevenueCat, or web-only checkout. Not decided.
- **PuttWatch v2** — putt-specific analysis prompt (head stability, shoulder pendulum, tempo) in Phase K pipeline. v1 ships voice ACK + Putt/Chip tags + general body overlay analysis.
- **Phone-gallery auto-import** — per-folder permission ("Golf" album auto-imports) into Swing Library. Half-day post-launch.
- **Video replay live overlay on Meta glasses** — Meta SDK doesn't expose the camera feed; not buildable without Meta opening up.

### Outstanding Empirical Verification
- Galaxy Z Fold end-to-end round at Sunnyvale (2026-05-17) — resolves Dave/Sarah/Marcus verdicts.
- Marcus cage pipeline 5-controlled-swing pass on Z Fold (BV-PREP Test Groups E1–E4).
- Cold-launch hydration pass across Kevin / Serena / Tank (James verdict).
- Cart Mode tuning validation post-Sunnyvale (manual-log telemetry vs auto-detection rate).

---

## 8. Beta Readiness State

### Verdict (audit-501, 2026-05-16): **GREEN. Beta-tester ready.**

Build health holds: `tsc --noEmit` 0/0, `expo lint` 0/0, `expo-doctor` 17/17, zero new `any`, 8 new `as X` assertions all safe.

### Ready for Tester Send

**Onboarding & profile:**
- Fresh install → `/welcome` single-screen.
- Welcome captures name + caddie + optional handicap; empty-name skip still writes `first_opened_at`.
- Returning users skip welcome (gated on `first_opened_at != null` OR non-empty name).
- Settings → Edit Profile routes back to `/welcome` with prior values.
- Reset App Data button copy clean.

**Persistence:**
- Settings persist (Zustand + AsyncStorage via SSR-safe adapter).
- Survives restart; hydration race protected via `whenRoundStoreHydrated()`.
- Sentry breadcrumb on profile hydration.

**Courses (7 bundled local):**
- Menifee Lakes — Palms (Tim's home)
- Menifee Lakes — Lakes
- Rancho California
- Crystal Springs
- Mariners Point (9-hole par-3)
- San Jose Municipal
- Sunnyvale

**Round mechanics:**
- Background-GPS wired with foreground-service notification (Android) + `UIBackgroundModes:location` (iOS).
- Manual Mark button (60s post-shot correction window).
- Round-start/end toasts confirm orchestration.
- Cart Mode toggle (settings + voice).
- Save vs Discard end-round dialog.
- Handicap differential pipeline + recap.

**Tools:**
- SmartFinder Garmin-comparable accuracy.
- SmartVision pre-round preview cascade (Palms hard fallback).
- TightLie pipeline real (camera → vision → persist → caddie brain).
- Auto club detection (high/medium/low confidence tiers).
- SmartMotion Quick (manual + voice trigger, 1/3/5/10 loop).
- SwingBodyOverlay (skeleton + swing trace) on uploaded swings.
- Hero shot capture + share via voice.
- PuttWatch v1 voice intent + Putt/Chip tags.

**Voice:**
- Per-persona ElevenLabs tuning (Phase 408).
- Filler cache v5 with cold-launch regen.
- Active Listening discoverable + tappable + voice-controllable.
- Voice on Phone Speaker default ON (Phase 502 migrate v7).
- Filler-clip queue latency tightened (`isLoaded === false` resolves immediately).
- Listening-pill chat fallback fixed (`chatJson.text` not `.response`).

**Beta infrastructure:**
- In-app Quick Start guide reachable from welcome + settings.
- Share Feedback email pre-filled (Settings → Help).
- Owner-only Issue Log via "Tank, log this — [description]" voice intent.
- EAS Update for OTA delivery on `preview` channel.
- White-screen crash fixed (`faff1d9` + lazy `ensureTaskDefined()`).

### Outstanding for Tester Send
- Wait for any pending EAS build (most recent OTA chain landed on `3c6020d6`).
- Re-confirm 6 empirical scenarios on Z Fold post-OTA: fresh install lands welcome; force-close + reopen skips welcome; Settings → Edit Profile pre-populates; Reset App Data → relaunch → back to welcome; Privacy Policy opens; Contact Support opens mail client.
- Privacy policy hosted at a real URL (currently placeholder).

### Honest Framing for PGA Hope Testers
- Local-device single-tester beta.
- No login required.
- No cloud sync.
- Reset App Data wipes everything.
- Real account sync (Supabase) in v1.2.
- Subscriptions disabled globally; everyone is lifetime during beta.

### External Beta Gate (Phase BM v1.0 scope)
Requires all four critical paths verified end-to-end on real device within last 7 days on a real round, plus:
- Hosted privacy URL.
- Billing pattern decision OR "free during beta" disclosure.
- Sentry DSN wired + auto-upload re-enabled.
- 11 debug routes (`api-debug`, `battery-debug`, `cage-debug`, `ghost-debug`, `kevin-learning`, `landmark-curate`, `patterns-debug`, `plan-debug`, `smartfinder-debug`, `subscription-debug`, `voice-debug`) hidden behind `__DEV__` gating.

### Public Launch (beyond external beta)
- Attorney review.
- App Store Connect / Play listings.
- Billing live (Apple IAP + Stripe via RevenueCat, or alternative).
- Auth (Phase 410B Supabase).

---

## 9. Appendix — Reference Files

**Read these first if resuming the project:**
- `CLAUDE.md` — project conventions (critical-path gates, locked elements, polyfill + persona conventions, commit format)
- `docs/critical-paths.md` — the four PATH 1–4 MIN VERIFY scenarios
- `docs/v1-scope-final.md` — v1.0 scope contract
- `docs/v1.2-deferred.md` — items intentionally not in v1.1
- `docs/voice-routing.md` — voice register / persona / ElevenLabs voice ID map

**Per-pillar references:**
- Round: `docs/audit-100-critical-paths.md`, `docs/audit-405-gps-state.md`
- Cage: `docs/audit-BU-cage-pipeline.md`, `docs/audit-BU-verification-protocol.md`, `docs/upload-pipeline-map.md`, `docs/cage-telemetry-map.md`
- Voice: `docs/audit-200-critical-paths.md`, `docs/voice-routing.md`
- SmartVision: `docs/audit-401-smartvision-render.md`
- SmartFinder: `docs/audit-400-smartfinder-state.md`
- Auto club detection: `docs/audit-402-club-detection-state.md`, `docs/club-recognition-architecture.md`
- SmartMotion: `docs/audit-403b-smartmotion-analysis-state.md`
- TightLie: `docs/audit-409-tightlie-state.md`
- Auth: `docs/audit-410-auth-state.md`, `docs/audit-410-pre-tester-checklist.md`

**Persona scaffolding:**
- `docs/personas/` — per-persona system prompt scaffolding
- `constants/{kevin,serena,tank,harry}Character.ts` — character specs

**Audit history (chronological):**
- Phase 100 (audit-100-*) — comprehensive audit + fix sweep
- Phase 200 (audit-200-*) — v1.1 final audit + sim check
- Phase 500/501 (audit-500-*, audit-501-*) — clean-for-beta + verdict GREEN
- Phase BV (audit-BU-*) — cage pipeline empirical audit

**Last 10 commits (head fdf96f5 backward):**
```
fdf96f5 Voice path: fix listening-pill small-talk drop + tighten filler-clip queue latency
8bea3af Pre-round green screen + voice-on-speaker — round-day hardening
b4b6b9a Revert wake-word gate — was silently dropping caddie greetings
4ca6140 Wake-word gate for Active Listening + PuttWatch v1
275a15b Fix pre-round SmartVision green screen + voice toggle for Cart Mode
d284c52 Round-day tooling: ground-truth shot marking + hero-shot spectator capture
23b09af Cart Mode: cart-aware GPS shot detection thresholds
cc7ede6 Acoustics cohesion: Range Mode routes to multi-shot + strike event bus
0550070 Video replay: skeleton + swing-trace overlay on swing detail player
b225665 Polish pass: thumbnails, holeview, Book Tee Time, SwingLab labels, Kevin 2nd-response disconnect
```

---

*Compendium generated 2026-05-17 in Phase 502 by Claude Opus 4.7 (1M context). Read top-to-bottom for project orientation; section-jump for targeted work. When this document drifts from reality, update or regenerate.*
