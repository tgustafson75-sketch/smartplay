# Legacy v2 Functional Inventory (Phase BI Component 1)

**Date:** 2026-05-04
**Source:** `origin/master` of `tgustafson75-sketch/smartplaycaddie` — 98 tracked files, "Day N" commit cadence (Days 7-14 visible). Compared against current `main` branch (420 tracked files).
**Scope:** Code-level inventory. Empirical UX walkthrough (look, feel, voice tone, latency on real device) requires Tim's first-person observation and is not in this document.

---

## Inventory format

For each surface: legacy file path, line count (legacy), one-paragraph summary of what was there, current equivalent.

---

## Cage / Practice flow

### `app/cage/index.tsx` — cage entry / club selector
**Legacy:** 338 LOC. `CLUBS` constant with 14 manual buttons (Driver / 3W / 5W / 4I-9I / PW / GW / SW / LW / Putter). Tap-grid selector → `startSession(selectedClub)` → navigate to `/cage/session`. "Camera Aligned" status row, watch-connected pill, last-session summary, history link.
**Current:** 541 LOC. Same `CLUBS` array. Adds Phase I `clubLabel()` mapper for Coach intro template (line 22-29). Adds space-configuration and distance-calibration modals. Same start flow.

### `app/cage/session.tsx` — active session
**Legacy:** 652 LOC. Uses `useCageStore.activeSession`, manual feel/shape buttons (flush/solid/fat/thin/heel/toe and draw/straight/fade/hook/slice/push/pull). On `handleLogShot` writes shot to store, runs `analyzeSession(shots, club)` from `patternEngine`, calls Kevin via `getKevinShotResponse`, plays TTS. `simulateSwing(club, feel)` produces synthetic watch metrics; `getKevinTempoLine` formats them. No vision-based analysis, no pose detection.
**Current:** 732 LOC. Adds Kevin coach box, KevinAvatar portrait, trust-level-keyed verbosity, drill recommendation surface. Pose-detection hook integration. The synchronous "log shot → speak Kevin" loop preserved.

### `app/cage/summary.tsx` — session-end summary
**Legacy:** 397 LOC. Calls `analyzeSession()` once, displays pattern result (dominant miss, root cause, drill suggestion), Kevin TTS speaks the analysis inline. Synchronous, sub-100ms compute time.
**Current:** 658 LOC. Orchestrates pose-detection pipeline per swing, swing-issue classification, drill recommendation. Per-shot CV analysis runs through `services/poseDetection.ts` (252 LOC). Trust-level gates TTS verbosity (L1 silent text-only, L2+ auto-TTS).

### `services/patternEngine.ts` — heuristic analysis
**Legacy:** ~280 LOC. Pure-function `analyzeSession(shots, club): PatternResult`. Counts feel/shape, computes flush rate, derives root-cause heuristics ("Low point control" if `fatRate >= 40`, "Early extension" if `thinRate >= 40`, etc.), suggests next drill ("Impact bag drill", "Stay down drill").
**Current:** Still present, still callable. Used as fallback when pose-detection unavailable.

### `services/acousticEngine.ts` — STUB
**Legacy:** 6 LOC. `analyze: async () => null`, `isAvailable: () => false`. Day-14 stub, never built.
**Current:** Identical 6 LOC stub. Plus a separate `services/acousticBallSpeed.ts` (71 LOC, also stubbed — `measureBallSpeedAcoustic()` returns `null`, `estimateBallSpeed(club)` returns hard-coded MPH lookup tagged `confidence: 0.3, source: 'club_typical_stub'`).

### `store/cageStore.ts` — cage data model
**Legacy:** Tracks `activeSession`, `sessionHistory`, `clubProfiles` (per-club dominantMiss / missRate / flushRate / shotCount), `cameraAlignment`. Actions: `startSession(club)`, `addShot()`, `endSession({ dominantMiss, rootCause, summary })`.
**Current:** Same baseline shape. Extends with `PrimaryIssue` and `DrillRecommendation` objects from pose-classification pipeline.

### `store/relationshipStore.ts` — Kevin's silent observations
**Legacy:** ~270 LOC. `observations[]` (technical / mental / pattern / strength tags), `confidenceByClub: Record<string, number>` (just stat tracking, not detection), `heroMoments[]`, `breakthroughs[]`, `mentalState`. Kevin uses these silently in his prompts.
**Current:** Same baseline. Grew to manage relationship state more deeply (round count, observation pruning).

---

## Round flow

### `app/(tabs)/caddie.tsx` — Caddie home / round hub
**Legacy:** Smaller, simpler. `useVoiceCaddie` hook handled bypass phrases and routed to `caddieBrain.ts`. Kevin avatar via `CaddieAvatar` with simple emotion + voice state.
**Current:** Far larger (~3000 LOC visible). Imports both `CaddieAvatar` (legacy, 935 LOC, line 24) and `KevinAvatar` (new, 154 LOC, line 59). Uses `useVoiceCaddie` + `useVoiceActivityDetection` + `conversationalLoggingOrchestrator`. Trust-level avatar branching. Smart finder, wind arrow, plays-like distance, listening session, paywall guard, GPS calibration, more-menu drawer, Mark button (Phase AL). Brief intro / mode picker logic, weather fetch, etc.

### `store/roundStore.ts` — round state
**Legacy:** ~150 LOC stub. Basic types `ShotResult`, `HoleStats`, `RoundState`. Manual shot logging. No GPS, no weather, no rules.
**Current:** 361 LOC. Adds GPS shot tracking (`start_location`, `end_location`), `RulesDecision`, weather snapshots, voice-logging fields (`raw_utterance`, `logged_via`), round photography. `player_id` reserved for 1.1 multi-player.

### `services/caddieBrain.ts`
**Legacy:** Day-6 stub. Promised AI advice but returned empty / minimal strings.
**Current:** 1000+ LOC. Real intent routing, context assembly, Anthropic + OpenAI integration, role registers (caddie / coach / psychologist).

### `app/(tabs)/scorecard.tsx`, `swinglab.tsx`, `dashboard.tsx`
**Legacy:** All tabs present in basic form. Scorecard had hole-by-hole entry. SwingLab had drill cards / silhouettes (Day 9). Dashboard was Day 7 with bug fixes mentioned in commit log.
**Current:** Significantly expanded. Scorecard has all-holes view + club summary + Kevin recap (Phase Z). SwingLab has Cage Mode, Practice tools, drill library, YouTube external links (recently hardened in Phase BM). Dashboard renamed/repurposed.

### `app/(tabs)/_layout.tsx` — tab bar
**Legacy:** Basic tab structure.
**Current:** 5 tabs (Caddie / Play / Score / SwingLab / Stats), trust-level visibility rules.

---

## Voice flow

### `services/voiceService.ts`
**Legacy:** `configureAudioForRecording`, `configureAudioForSpeech`, `speak`, synchronous recording capture. Plain imperative API.
**Current:** Adds `audioModeQueue` to serialize `Audio.setAudioModeAsync` (Phase V.7 race fix), `captureUtterance` with timeout + cancellation, `speakFromBase64` for streaming TTS. Same public-shape `speak(text, gender, lang, apiUrl)` retained.

### `hooks/useVoiceCaddie.ts`
**Legacy:** Bypass-phrase parser (yardage / hero / mute / vision), routed to `caddieBrain.ts` or manual handlers. Imperative mic-on-demand.
**Current:** Still present, still routes intents — but now coexists with the full orchestrator (`listeningSession` + `conversationalLoggingOrchestrator`).

### NEW in current — no legacy equivalent
- `services/listeningSession.ts` (388 LOC) — earbud / on-screen tap → opener (trust-level-aware) → mic open → utterance → intent routing → response. Exported `initListeningSession()` is called from [app/_layout.tsx:97](../app/_layout.tsx#L97).
- `services/conversationalLoggingOrchestrator.ts` — buffers shot detection events and prompts user for voice logging.
- `hooks/useVoiceActivityDetection.ts` — real-time metering, silence threshold (Phase AB tuned to 2800ms).

### `api/voice.ts`, `api/transcribe.ts`, `api/brain.ts`
**Legacy:** Basic OpenAI wrappers. `voice.ts` had ElevenLabs voice IDs (`male: '1fz2mW1imKTf5Ryjk5su'`, `female: 'RGb96Dcl0k5eVje8EBch'`) and OpenAI fallback (`onyx`/`nova`).
**Current:** Same voice mapping carried forward. Adds Anthropic SDK, role-keyed prompts, tool-routing.

### `api/vision.ts` — hole-overhead caddie advice (NOT club detection)
**Legacy:** `mode === 'hole'` branch sends overhead satellite image of a hole + course context to `gpt-4o`, returns 2-sentence Kevin "read the hole" response. **No club detection mode exists.**
**Current:** Same shape. Plus dedicated TightLie (`api/lie-analysis.ts`) for player-pointed lie analysis.

---

## Onboarding

### Legacy
Single-file `app/intro.tsx`. ~3 steps: name entry, caddie gender selection (male/female avatar swap), confirmation. `useState` stepping, direct store mutations. No branching, no context capture beyond name + voice gender.

### Current
Full router at `app/onboarding/` with 8 files: `_layout.tsx`, `welcome.tsx`, `name.tsx`, `meet-kevin.tsx`, `mode.tsx`, `about-game.tsx`, `home-course.tsx`, `ready.tsx`. Captures player goal, course preference, game knowledge level. `app/intro.tsx` still exists alongside.

---

## Avatar / Kevin

### `components/CaddieAvatar.tsx`
**Legacy:** 467 LOC. Wraps a portrait image (`kevin_portrait.jpg` / `serena_portrait.jpg`) with text bubbles, breath/nod transforms.
**Current:** 935 LOC — exactly **2.0×** legacy size. Trust-level-keyed rendering (L1-L4), aspect-ratio handling (Fold open/closed/standard), full emotion-keyed AVATARS map (22 emotional states for Kevin), parallel SERENA_AVATARS map (Phase BN).
**Note:** Per `CLAUDE.md`, Phase AT added a "recompose pipeline" (`PORTRAIT_OFFSET_F`, `baseShiftFraction`, `kevinShiftFraction`, etc.) that drifted Kevin user-left on Fold open and clipped his hat; Phase AU **claims** the pipeline was removed. The 935 LOC vs legacy's 467 LOC is mostly the emotion map expansion and Fold-aware layout. CLAUDE.md's "canonical lock" at commit `19165fb` is the contract.

### `components/kevin/KevinAvatar.tsx` — NEW
**Current only.** 154 LOC. Brand-new component. Imported alongside the legacy `CaddieAvatar` in `app/(tabs)/caddie.tsx` (line 59). Both are mounted in caddie.tsx — which one renders depends on trust level / surface. Worth confirming with Tim that this dual-import is intentional (Phase AU canonical) and not legacy debt waiting to be deleted.

---

## Onboarding-adjacent: settings + intro

### `app/intro.tsx`
**Legacy:** 3-step name + caddie picker (Kevin / Serena), gender → voice swap.
**Current:** Same file present. Has `goToStep()` fade-out/fade-in animation. Likely deprecated by `app/onboarding/` but not deleted.

### `app/settings.tsx`
**Legacy:** Day 8 onboarding work — basic preferences.
**Current:** ~800 LOC. Voice toggle (Kevin / Serena picker at line 308-312, wired to `setVoiceGender`), trust-level controls, watch settings, simulated walk, dialog templates, paywall debug entry.

---

## Screens / surfaces in legacy NOT in current

None identified at code level — every legacy screen has a v1.0 equivalent. The reverse is not true: many surfaces are **new in v1.0** (see Migration Gap Analysis Section "NEW-IN-V1").

---

## Surfaces requiring Tim's empirical observation (not capturable from code)

The following dimensions of legacy v2 cannot be inventoried from code alone:
- **Voice character / tone** — how did Kevin sound? Different tempo, vocabulary, opener style?
- **Round-active feel** — did the round-active state feel responsive vs flashy in legacy?
- **Cage analysis tempo** — legacy ran sync `analyzeSession` (<100ms). Current runs async pose pipeline (4s+ per swing). What did the legacy "feel" like vs current latency?
- **Earbud tap behavior** — legacy `react-native-track-player` was present (commit `9865fef` later removed it). Did it ever actually work on Galaxy Buds?
- **Kevin avatar in motion** — legacy 467 LOC vs current 935 LOC. What was the breath/nod cadence in legacy? Better, worse, same?
- **Drill recommendation utility** — legacy heuristic-only ("Impact bag drill, hands forward at impact"). Current ML-based. Were legacy drills more concrete / actionable?

These dimensions feed `migration-gap-analysis.md` once Tim has walked the legacy app.
