# SmartPlay Caddie Pro — Technical Compendium

> **Authoritative internal reference for Tim + Tank.** Built from the actual codebase at `/Users/timothyg/Documents/smartplay` as of HEAD `1bf2cb3` (2026-05-21). When the code disagrees with this doc, **trust the code** — re-walk and update.
>
> Honesty principle: real / stub / deferred are marked explicitly throughout. Tank must never demo something marked STUB or DEFERRED to a paying student.

---

## Table of Contents

1. [Overview](#1-overview)
2. [The Caddie System](#2-the-caddie-system) — personas, voice, brain, handoff
3. [Round Pillar](#3-round-pillar)
4. [Practice / SwingLab Pillar](#4-practice--swinglab-pillar)
5. [Play Pillar](#5-play-pillar)
6. [Voice Commands](#6-voice-commands) — intent catalog
7. [Trust Spectrum](#7-trust-spectrum)
8. [REAL vs STUB vs DEFERRED](#8-real-vs-stub-vs-deferred)
9. [Known Issues + Pending Verification](#9-known-issues--pending-verification)
10. [Architecture Notes](#10-architecture-notes)

---

## 1. Overview

**SmartPlay Caddie Pro** is a React Native + Expo + TypeScript application targeting Android (preview; iOS deferred). Three product pillars:

| Pillar | Purpose | Status |
|---|---|---|
| **ROUND** | On-course caddie: GPS yardages, hole transitions, scoring, recap | Fully built, ship-ready core |
| **PRACTICE (SwingLab)** | Cage Mode, SmartMotion swing analysis, future drills/range | Cage + SmartMotion Card 2 live; pose overlay is preview; range/drills deferred to 1.1 |
| **PLAY** | Ghost replays today; Arena / Challenge / Skills deferred to 1.1 | Ghost play live; Arena UI not built |

### Tech stack

- **App**: React Native `0.81.5`, Expo SDK `~54.0.33`, React `19.1.0`, TypeScript `~5.9.2`, `newArchEnabled: true` (Fabric/JSI)
- **State**: Zustand `^5.0.12` with `persist` middleware → AsyncStorage via [services/ssrSafeStorage.ts](../services/ssrSafeStorage.ts)
- **Routing**: `expo-router` `~6.0.23` (file-based, typedRoutes)
- **Native modules**: `expo-location`, `expo-task-manager`, `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-haptics`, `expo-sensors`, `expo-keep-awake`, `expo-screen-orientation`, `react-native-health-connect`, `react-native-worklets`, `react-native-reanimated`, `react-native-gesture-handler`, `react-native-svg`, `react-native-view-shot`, `react-native-screens`, `react-native-safe-area-context`
- **AI providers**:
  - **Anthropic** (`@anthropic-ai/sdk ^0.95.1`) — Claude Sonnet 4.5 for the main caddie brain (`/api/kevin`), Claude Haiku for voice-intent classification (`/api/voice-intent`)
  - **OpenAI** (`openai ^6.34.0`) — `gpt-4o-mini-tts` voice fallback, `gpt-image-1` image-edit for selfie→caddie face, vision fallback in a few routes
  - **ElevenLabs** — primary TTS provider (per-persona voice IDs, multilingual)
- **Hosting**: Vercel for `/api/*` (web export + serverless). `vercel.json` overrides `maxDuration` to 30s on five LLM-heavy routes (`kevin`, `brain`, `voice-intent`, `swing-analysis`, `cage-coach`).
- **Build / OTA**: EAS Build (`eas-cli`), profile `preview` ships APKs over channel `preview`; `expo-updates` checks for OTA bundles at boot.
- **Telemetry**: `@sentry/react-native ~7.2.0` — gated on `EXPO_PUBLIC_SENTRY_DSN`. As of this writing the DSN is NOT set as an EAS secret → `Sentry.init()` doesn't fire → **no runtime crash capture on current builds** ([app/_layout.tsx:65-71](../app/_layout.tsx#L65-L71), see §9).

### Current state at HEAD

- Day 2 fix sprint shipped Fix G, H, I, N, N-3, O, P, Q, R, S, plus Harness v2-lite. All TS-clean, pushed to `main`.
- Latest EAS preview APK: build `c7f5ad9a` on commit `97c04ed` (Fix N-3). Fix S + Harness v2-lite ride OTA on top.
- Pending on-device verification: Fix N-3 (Start Round crash), Fix S (per-hole intro), Fix I (airplane-mode fallback).

---

## 2. The Caddie System

### 2.1 Personas

Four personas defined in [lib/persona.ts](../lib/persona.ts), each with a separate character spec file under [constants/](../constants/).

| Persona | Gender | Character file | Active in UI? | Default pillar |
|---|---|---|---|---|
| **Kevin** | male | [kevinCharacter.ts](../constants/kevinCharacter.ts) | ✅ | round, play |
| **Serena** | female | [serenaCharacter.ts](../constants/serenaCharacter.ts) | ✅ | drills |
| **Tank** | male | [tankCharacter.ts](../constants/tankCharacter.ts) | ✅ | cage |
| **Harry** | male | [harryCharacter.ts](../constants/harryCharacter.ts) | ❌ soft-removed | — |

[lib/persona.ts:89](../lib/persona.ts#L89): `ACTIVE_PERSONAS = ['kevin', 'serena', 'tank']`. Harry is type-valid (`ALL_PERSONAS` at line 76) but invisible in the picker. Settings store v6 migration ([settingsStore.ts:464-472](../store/settingsStore.ts#L464-L472)) maps any persisted Harry assignment to Kevin so existing users don't get stuck on a hidden persona. Re-enable Harry = one line: add `'harry'` back to `ACTIVE_PERSONAS`.

**Character voices in code** (full strings live in `constants/*Character.ts`):
- **Kevin** — warm, observant, conversational; three registers (Caddie / Coach / Psychologist); trust-spectrum aware; "stay in this shot."
- **Serena** — composed, professionally confident, competitive-amateur background; encouraging directness; "trust your prep. Stay composed. Execute with intent."
- **Tank** — intense, Marine cadence; standards-driven; signature: "Lock it in," "Execute"; **disaster discipline** pulls back on blow-ups (3+ over par). Soft-intro flag drops the cadence on first interaction.
- **Harry** (dormant) — partnership voice; "we" language; Army medic background.

### 2.2 Persona resolution (post Fix Q, Path B — commit `338329e`)

Single source of truth: `useSettingsStore.caddiePersonality` ([store/settingsStore.ts:33](../store/settingsStore.ts#L33)).

**Per-pillar map** ([settingsStore.ts:12-17](../store/settingsStore.ts#L12-L17)) with defaults:
```ts
DEFAULT_CADDIE_ASSIGNMENTS = {
  round: 'kevin',   // steady on-course
  cage: 'tank',     // cage intensity
  drills: 'serena', // technical drills
  play: 'kevin',
};
```

**The Fix Q rule:** `setCaddiePersonality(p)` now also resets `caddieAssignments` to `{round:p, cage:p, drills:p, play:p}` ([settingsStore.ts:296-310](../store/settingsStore.ts#L296-L310)). Pick Serena → all pillars become Serena → no silent bleed.

**Per-pillar override is opt-in.** A user can still call `setCaddieForPillar('cage', 'tank')` after a global switch to keep Tank on the cage only — the global switch resets the map; explicit per-pillar assignment is the only way to differ.

**Surface-crossing no longer auto-switches.** The old `_layout.tsx` `syncFromSurface` and `syncFromAssignmentChange` subscribers were DELETED in Fix Q ([app/_layout.tsx:286-296](../app/_layout.tsx#L286-L296)) — they were the structural source of the bleed.

**[services/caddieResolver.ts](../services/caddieResolver.ts)** maps active surface → pillar → persona:
- `cage / swing_library / swing_detail` → `cage`
- `arena` → `play`
- `caddie / recap / null` → `round`

### 2.3 Voice path

Entry point: `voiceService.speak(text, gender, language, apiUrl, { userInitiated? })` in [services/voiceService.ts](../services/voiceService.ts).

- **Queueing**: Phase BM `enqueueSpeak()` serializes calls so two near-simultaneous speak() calls don't double-talk.
- **Gate**: `isVoiceAllowed(opts)` returns false when:
  - `voiceEnabled === false`
  - `trustLevel === 1` (Quiet) **AND** `userInitiated !== true`
  - route is `phone_speaker` and `voiceOnPhoneSpeaker === false`
- **Per-persona volume**: `personaIntensity[persona]` (0-100, defaults Kevin/Serena 100, Tank 70) scales playback 0.3-1.0.
- **Custom-caddie tweak**: when `useCustomCaddie && customCaddiePortraitB64`, volume × 0.85, rate × 1.08 — so the user-face caddie sounds subtly distinct from the source persona.

### 2.4 TTS chain

[app/api/voice+api.ts](../app/api/voice+api.ts) (referenced by `voiceService.speak`):

1. **Primary: ElevenLabs.** Voice IDs from `ELEVEN_VOICES_BY_PERSONA` in [api/_voiceTuning.ts](../api/_voiceTuning.ts).
   - Models: `eleven_turbo_v2` (en), `eleven_multilingual_v2` (es/zh)
   - Per-persona settings (stability, similarity, style) from `ELEVEN_SETTINGS_BY_PERSONA`.
   - Fallback chain in resolver: persona → gender+language → `KEVIN_VOICE_ID`.
2. **Fallback: OpenAI.** `gpt-4o-mini-tts`, voices `'onyx'` (male) / `'nova'` (female). Triggered when ElevenLabs unavailable or fails.

### 2.5 Brain / LLM cascade

- **[app/api/kevin+api.ts](../app/api/kevin+api.ts)** — main caddie endpoint
  - Anthropic Claude Sonnet 4.5 (`claude-sonnet-4-5`)
  - 25s SDK timeout; Vercel `maxDuration: 30` from [vercel.json](../vercel.json)
  - System prompt assembled from `getCharacterSpec(persona)` + language + tactical context + last 12 messages
  - `cache_control: { type: 'ephemeral' }` on system block (prompt cache)
  - Tools defined for structured outputs: `open_smartvision`, `log_score`, etc.
  - **Fix I shape C honest fallback** ([api/kevin+api.ts:510-517](../app/api/kevin+api.ts#L510-L517)): outer catch returns HTTP 200 with `{text: localized fallback, audioBase64: null}` instead of error — caller speaks the line, user is never silently dropped
  - **Register sub-branch**: `register='coach'` + `inRoundDiagnostic:true` routes to the in-round Coach prompt for multi-shot pattern reasoning
- **[app/api/brain+api.ts](../app/api/brain+api.ts)** — conversational lighter endpoint (OpenAI, no tactical tools)
- **[app/api/voice-intent+api.ts](../app/api/voice-intent+api.ts)** — Claude Haiku 4.5 classifier; system prompt enumerates the 15+ intent types; returns `{intent_type, parameters, confidence, follow_up_question}`
- **Other caddie-facing API routes**: `recap`, `briefing`, `preround`, `vision`, `cage-coach`, `cage-review`, `lie-analysis`, `pose-analysis`, `swing-analysis`, `space-scan`, `tutorial-analysis`, `parse-shot`, `image-edit`, `cv-scoring`, `weather`, `course-proxy`, `course-geometry`, `course-content`, `golfbert-proxy`, `acoustic-detect`, `club-recognition`, `smartmotion`, `health`, `transcribe`, `context-synthesis` (full list in §10.3)

### 2.6 Languages

[settingsStore.ts:26](../store/settingsStore.ts#L26): `language: 'en' | 'es' | 'zh'`.

Language-dispatched logic:
- TTS provider selection (model + voice ID) keys on language
- Honest-fallback strings ([services/listeningSession.ts:136-144](../services/listeningSession.ts#L136-L144)) — `en` / `es` / `zh` dict
- Filler library cache key includes language (`voiceHash(persona, language)`) so a language flip invalidates the persona's pre-cached clips
- `briefingGenerator.clearBriefingCache()` runs on language change so the next briefing renders in the new language

### 2.7 Handoff (opt-in only, post Fix Q)

[services/teamIntelligence.ts](../services/teamIntelligence.ts) + [store/teamIntelligenceStore.ts](../store/teamIntelligenceStore.ts).

**5 triggers** ([teamIntelligence.ts:23-28](../services/teamIntelligence.ts#L23-L28)): `drill_plateau`, `cage_frustration`, `mental_struggle`, `tactical_to_mental`, `user_explicit_stuck`.

**Suggestion shape**: `{id, fromPersona, toPersona, trigger, reason, pillar, createdAt}`. Caps: 1 per session, 24h cooldown per trigger after decline.

**Acceptance flow** ([app/_layout.tsx:226-249](../app/_layout.tsx#L226-L249)): user taps Accept on the suggestion card → store appends to `acceptedHandoffs` → `_layout.tsx` subscriber calls `setCaddiePersonality(accepted.toPersona)` **directly**. That action resets all pillars + speaks intro + clears caches. **No auto-revert on surface leave** (removed in Fix Q).

---

## 3. Round Pillar

### 3.1 GPS — single source of truth

[services/gpsManager.ts](../services/gpsManager.ts) is the canonical GPS layer. Every consumer subscribes (`subscribeGps`) or reads `getLastFix()`; nothing else calls `expo-location` directly except `permissionsManager.ts` and the simulator harness (which sets `setSimulatedFix` to override).

- **Modes**: `active` / `walking` / `stationary`, switched by motion signal + shot-intent timer
- **Accuracy ladder** ([gpsManager.ts:311-355](../services/gpsManager.ts#L311-L355)): configured accuracy → Balanced → Low; survives OEM-specific accuracy refusals
- **Outlier rejection**: drop fixes >15m accuracy; drop jumps >50m in 5s
- **3-fix smoothing buffer** (reset on mode transition)
- **`bumpToActive(reason)`** ([gpsManager.ts:554-561](../services/gpsManager.ts#L554-L561)): public helper — hole change, Mark, SmartFinder open all call this so GPS goes high-cadence for 60s

### 3.2 Background location + foreground service (Fix N defensive triple-layer)

[services/backgroundLocationTask.ts](../services/backgroundLocationTask.ts):
- **Lazy `TaskManager.defineTask`** ([backgroundLocationTask.ts:111-153](../services/backgroundLocationTask.ts#L111-L153)) — registers only when `startBackgroundLocation()` is called. Was inline at module-load originally and caused a Phase 405 white-screen crash when the native binding threw at import time.
- **POST_NOTIFICATIONS gate (Fix N)** ([backgroundLocationTask.ts:63-98](../services/backgroundLocationTask.ts#L63-L98)) — Android 13+ runtime permission probe before starting the foreground service. Denial = skip foreground service entirely; round still runs on foreground watch only.
- **Triple-layer try/catch**: outer (line 167), permission probe (line 67), inner around `startLocationUpdatesAsync` (line 204). JS-level crash-proof.

⚠️ **Fix N alone was insufficient** for the Z Fold Start Round crash — that crash turned out to be from `react-native-health-connect` native JNI fatal (Fix N-3 shipped 2026-05-21).

### 3.3 Hole detection

[services/holeDetection.ts](../services/holeDetection.ts) — pure 4-second poll:
- `SUSTAINED_TRANSITION_MS = 10_000` — 10s sustained position before transition fires
- `MIN_DISTANCE_FROM_GREEN_YD = 30` — must be 30+ yards from current green
- `MAX_TRANSITION_LOOKAHEAD = 2` — only considers current+1, current+2 (handles doglegs)
- **Manual override lockout** ([holeDetection.ts:73-78](../services/holeDetection.ts#L73-L78)): `noteManualOverride()` clears position history + sets timestamp. 20s window suppresses auto-transitions. Called from `roundStore.setCurrentHole()` so cockpit/data-strip taps + voice "I'm on hole 7" all get the lockout.
- **GPS quality freeze**: weak/none accuracy halts detection
- **Loop-back re-entry**: triggers transition when player walks back to an already-played hole's tee

### 3.4 SmartFinder (live F/M/B yardages + honest no_geometry fallback)

[services/smartFinderService.ts](../services/smartFinderService.ts):
- **Green-coord resolution cascade** ([smartFinderService.ts:217-264](../services/smartFinderService.ts#L217-L264)):
  1. User-captured **mark-green override** (per-`(courseId, hole)`, persisted)
  2. `courseHoles` record from golfcourseapi
  3. Geometry cache from `courseGeometryService` (7-day AsyncStorage TTL)
- **`reason` field** on yardage response ([smartFinderService.ts:51,58](../services/smartFinderService.ts#L51)): `'ok' | 'no_fix' | 'no_hole' | 'no_geometry'`
- **Honest `no_geometry` fallback** ([smartFinderService.ts:302-310](../services/smartFinderService.ts#L302-L310)): when geometry missing, returns scorecard tee→green total with `reason: 'no_geometry'` — yardage labeled honestly so user knows it's static, not live
- **Sanity clamp**: computed yardages > 800y → revert to scorecard + warn

### 3.5 Mark Green CTA + override persistence (Consolidation 5 Part 2)

When `reason === 'no_geometry'`, the SmartFinder card surfaces a "Mark this green for live yardages" CTA → routes to [app/mark-green.tsx](../app/mark-green.tsx).

- User walks to green center, taps "Mark green center"
- `getOneShotFix({ maxAgeMs: 0 })` forces a fresh GPS pulse
- `setGreenOverride(courseId, hole, {lat, lng})` writes to [services/courseGreenOverrides.ts](../services/courseGreenOverrides.ts), persisted
- Override wins the resolution cascade ahead of scorecard / geometry
- Reachable from Owner Tools or Tools menu; per-(courseId, hole) keyed → carries across rounds

### 3.6 SmartVision (camera-overlay yardages, planning surface)

[app/smartvision.tsx](../app/smartvision.tsx) + setting `smartVisionImagery: 'curated' | 'gps' | 'auto'` in settingsStore.

- **`'curated'`** — bundled hole screenshot, no GPS tile fetch
- **`'gps'`** — live Mapbox satellite tile + draggable F/M/B markers (requires hole geometry)
- **`'auto'`** — use GPS when geometry available, else curated
- **Two-marker UX**: down-the-line vs face-on toggle; draggable yellow target (Y) calculates haversine yardage to green
- **Pre-round planning**: works before Start Round via `previewCourseId` / `pendingStartCourseId` deep-link path

### 3.7 TightLie (lie analysis)

[app/lie-analysis.tsx](../app/lie-analysis.tsx) + [api/lie-analysis.ts](../api/lie-analysis.ts) — REAL Sonnet-vision analysis:
- Camera capture (`expo-camera` → `takePictureAsync`), resize to 1024px JPEG @ 75%, base64
- POST to `/api/lie-analysis` with `{imageBase64, context}` 
- Sonnet reads lie quality + stance + obstructions + light + distance → `{situation_description, tactical_advice, recommended_club, confidence}`
- Optional voice narration of the analysis
- Graceful no-network / low-quality fallback states

### 3.8 Cockpit scoring + DataStrip hole nav (Fix O)

[components/caddie/CockpitCaddieScreen.tsx](../components/caddie/CockpitCaddieScreen.tsx) + [components/CaddieDataStrip.tsx](../components/CaddieDataStrip.tsx):
- **Fix O canonical actions** — cockpit now uses `logScore(hole, n)` and `logPutts(hole, n)` (real store actions). Previously called non-existent `setScore` / `setPutts` via optional chaining → silently no-op'd.
- **STROKE running count**: manual edit wins; otherwise derives from `shots[hole] + penalty_strokes`
- **Steppers**: Haptics.selectionAsync on every press
- **DataStrip ◀/▶ HOLE arrows** ([CaddieDataStrip.tsx:70-79](../components/CaddieDataStrip.tsx#L70-L79)): call `setCurrentHole(prev/next)` with boundary clamps → fires `noteManualOverride()` so auto-detection respects the manual nav for 20s
- F/M/B yardage strip wired to `subscribeFixChange` — yardages update live as player walks

### 3.9 Per-hole caddie intro (Fix S)

[store/roundStore.ts setCurrentHole](../store/roundStore.ts) — when `prevHole !== clamped && state.isRoundActive`, speaks **"Hole [N]. Par [X]. [Y] yards."** through the active persona's voice.

- Gating: `voiceEnabled && trustLevel !== 1` — Quiet stays silent
- Fires on BOTH auto-detection AND manual nav (single bottleneck)
- Hole 1 at round-start does NOT pass through here (`startRound` uses direct `set()`) → no double-fire with briefing / skip-briefings hole-1 line
- Active persona is implicit — `voiceService.speak()` reads `caddiePersonality` at request time (Fix Q semantics)

### 3.10 Recap (post-round)

[app/recap/[round_id].tsx](../app/recap/[round_id].tsx):
- Shareable PNG card (`react-native-view-shot`) + PDF export (`expo-print`)
- Narration playback (`buildNarrationScript`) — Kevin walks through the round hole by hole
- Hole-by-hole variance cards with Kevin summaries from `/api/recap`
- Ghost match comparison row when a ghost was active
- **Fix R Notes section** ([recap/[round_id].tsx:186-188](../app/recap/[round_id].tsx#L186-L188)) — surfaces "Kevin, log this" entries captured during the round window (filtered from [store/issueLogStore.ts](../store/issueLogStore.ts))

---

## 4. Practice / SwingLab Pillar

### 4.1 SmartMotion (swing analysis — two cards)

[app/swinglab/smartmotion.tsx](../app/swinglab/smartmotion.tsx) — opens with TWO synchronized cards: down-the-line + face-on.

**Card 1 — visual + pose overlay**
- **Phase 418 validation gate**: `evaluateSwingValidity(analysis)` runs first. When `valid_swing === false`, the pose overlay + metrics + insight card are all suppressed. No fake analysis on shaky footage.
- **Metrics strip**: `backswingMs`, `downswingMs`, `peakWristSpeed` are real timing values when a valid swing is analyzed
- **`(est)` labels**: club head speed and ball speed marked as estimates — they come from `simulateSwing()` math, not Watch IMU
- ⚠️ **Pose skeleton overlay is STUB** ([smartmotion.tsx:1-22 header](../app/swinglab/smartmotion.tsx#L1-L22)): the overlay renders `StubSkeletonOverlay` with normalized MoveNet-17 keypoint positions. **No real pose tracking happens.** No MoveNet / MediaPipe / TFJS imports in the file. The overlay is a preview of what real pose will look like once TFJS + expo-gl native deps land in a future EAS build. **Do not demo as live pose tracking.**

**Card 2 — insight + coach review (REAL)**
- `analyzeSwing(clipUri, { club, angle, language, player_context })` → POST `/api/swing-analysis` (Sonnet vision on 1-5 JPEG frames from the clip)
- Returns `{detected_issue, severity, confidence, observation, valid_swing}` 
- Drives Top Focus + Drill + Next Swing Focus
- This IS the actual swing-analysis capability — Sonnet vision powered, with confidence metadata. Real.

### 4.2 Cage Mode (post Fix G — honest)

[app/swinglab/cage-mode.tsx](../app/swinglab/cage-mode.tsx) — practice/lesson environment.

**Phase machine** (Fix G, commit `686443d`): `SETUP → RECORDING → UPLOADING → RESULT | ERROR`. The old `CHECKING / NOT_READY / READY` phases were tied to an unbuilt `/api/cage/check-bullseye` endpoint that always 404'd — deleted entirely.

**5 capabilities post-record:**

| # | Capability | Real? |
|---|---|---|
| 1 | **Local acoustic impact detector** ([cage-mode.tsx:89-94](../app/swinglab/cage-mode.tsx#L89-L94)) — on-device audio signal analysis detects impact moment | ✅ REAL |
| 2 | **Ball speed estimate** via `/api/acoustic-detect` (POST audio frames) | ✅ REAL |
| 3 | **Coach review** via `coachReview(features, voiceGender, caddiePersonality)` → `/api/kevin/coach` (real Sonnet analysis, persona-aware per Fix Q) | ✅ REAL |
| 4 | **Watch IMU metrics** — defensive UI gate `watchSwing && ...`; **zero production wiring today** | ⏳ DEFERRED (scaffold only) |
| 5 | **Recorded clip persistence** to gallery | ✅ REAL |

**Bullseye CV scoring** ([services/cageApi.ts CageAnalyzeResponse](../services/cageApi.ts)): `bullseye_offsets: []` — type kept for forward compat but always empty client-side. No CV scoring runs. The CageOverlay still renders for visual alignment but no fake "bullseye detected" gate fires.

### 4.3 Watch IMU (deferred)

[services/watchService.ts:112-118](../services/watchService.ts#L112-L118) — explicit `FUTURE: REAL SDK HOOK` block:
```ts
// import { SamsungHealth } from '@samsung/health-sdk';
// SamsungHealth.onSwingDetected((data) => {
//   useWatchStore.getState().recordSwing(parseWatchData(data));
// });
```

Current state: `analyzeTempoRatio`, `estimateClubSpeed`, `getKevinTempoLine`, `simulateSwing` are pure math utilities. **Zero production callers** of `useWatchStore.recordSwing` or `setConnected`.

Path forward: native module + Samsung Health SDK + EAS rebuild (not OTA-able). Beta wearables SDK access unblocked 2026-05-19.

### 4.4 Other practice surfaces

- **Range Mode** — **NOT BUILT.** No file in repo. Deferred to 1.1.
- **Swing Library** — **NOT BUILT.** Cage Mode saves clips to camera roll but no dedicated playback/comparison UI. Deferred.
- **Drills** — **scaffolding only.** Persona assignment exists (`drills → serena` default in [settingsStore.ts:15](../store/settingsStore.ts#L15)) but no drill picker / detail / plate screens. Deferred to 1.1.
- **Selfie → caddie face transformation** — ✅ **BUILT END-TO-END.** [app/profile/custom-caddie.tsx](../app/profile/custom-caddie.tsx) captures selfie, [api/image-edit.ts](../api/image-edit.ts) transforms via OpenAI `gpt-image-1`, [components/CaddieAvatar.tsx](../components/CaddieAvatar.tsx) renders the user's transformed face while voice/brain stay tied to `caddiePersonality`. Entry point: Dashboard "Try a new look" card.

---

## 5. Play Pillar

Per Tim's roadmap: **Play pillar = 1.1 / deferred. Largely inert in 1.0.**

### What IS built

- **Course discovery (Play tab)** — [app/(tabs)/play.tsx](../app/(tabs)/play.tsx): course browser + Start Round picker. Wired to golfcourseapi.searchCourses + local course list. Real and functional.
- **Ghost play** — ✅ REAL and live in 1.0
  - [store/ghostStore.ts](../store/ghostStore.ts): `activateGhost(pastRoundRecord)`, `updateHole(holeNumber, currentScore)`, `getLabel()`, `getSummaryText()`
  - Plays a prior round of yours as a ghost during the current round
  - Ghost results render in recap ([recap/[round_id].tsx:132-173](../app/recap/[round_id].tsx#L132-L173))
- **CV scoring (CTP only)** — [api/cv-scoring.ts](../api/cv-scoring.ts) Phase L v1: Closest-to-Pin endpoint REAL. Skills / Sim / Scramble return 400 "not yet implemented" — deferred.

### What's NOT built

- **Arena / Challenge UI** — no `app/arena*` or `app/play/challenges*` screens. cv-scoring API ready; UI deferred to 1.1.
- **Second-swing comparison** (your ghost across different courses) — 1.1
- **Multi-target CV challenges** — Skills, Sim, Scramble — 1.1

---

## 6. Voice Commands — Intent Catalog

All registered in [services/intents/index.ts:19-41](../services/intents/index.ts#L19-L41). The classifier ([app/api/voice-intent+api.ts:164-170](../app/api/voice-intent+api.ts#L164-L170)) emits one of these `intent_type` strings — handler dispatched by `voiceCommandRouter`.

> ⚠️ **Silent-contract pattern (Fix O/P fingerprint)**: every handler's `intent_type` must match the classifier's union. Audit at HEAD found all 17+ handlers aligned. When adding a new intent, register BOTH sides.

| `intent_type` | What it does | Example phrasings |
|---|---|---|
| `open_tool` | Routes to a UI surface | "show me the smart finder", "open SmartVision", "let me record a swing" |
| `query_status` | Reads current round state | "what's my score", "what hole am I on", "how am I doing against the ghost" |
| `change_setting` | Mutates settings (theme, voice, persona, cart mode, language, response_mode) | "switch to dark mode", "change caddie to Tank", "cart mode on" |
| `acknowledge` | Passive ack — keeps conversation alive without reply | "thanks", "got it", "okay" |
| `navigate` | App-level navigation | "go back", "next hole", "main menu", "home" |
| `help` | Voice discoverability | "what can I say", "help", "what voice commands work here" |
| `rules_query` | Golf rules questions | "what's the penalty for OB", "can I take a drop here" |
| `handicap_query` | Handicap / index questions | "what's my handicap", "what should I shoot for" |
| `set_trust_quiet` | Drop trust level to L1 (Quiet) | "Kevin go quiet", "be quiet", "shush" |
| `set_trust_companion` | Restore trust level from Quiet | "come back", "speak up", "talk to me" |
| `club_change` | Club selection in cage mode | "switching to 6-iron", "use the driver" |
| `club_query` | What club is selected | "what club do I have" |
| `club_menu` | Open club picker | implied |
| `log_shot` | Log per-swing outcome | "pulled it left, in the trees", "striped it", "hit it fat" |
| `log_score` | Log final hole score (Fix P) | "I made a five", "shot a 7 on hole 3", "bogey on this one", "made par" |
| `media_capture` | Record shot/swing clip | implied |
| `media_playback` | Replay last clip | implied |
| `putt_watch` | Glasses recording ack (putt/chip) | implied |
| `at_my_ball` | Mark current position as ball location | "I'm at my ball" |
| `log_issue` | Capture in-app bug/feedback (owner-friendly) | "remember this — SmartFinder white-screened at 10x zoom", "this is broken", "log a bug" |
| `sequence` | Chain up to 3 commands | "log a 5 and move to the next tee", "open SmartFinder and go quiet" |
| `unknown` | Falls back to brain for tactical golf questions | "what's the play", "what club from 150" |

**Tactical golf questions intentionally route to `unknown`** — they go to `/api/kevin` (Sonnet) for full tactical reasoning instead of being squashed into a structured intent.

**`log_issue` storage**: entries persist to [store/issueLogStore.ts](../store/issueLogStore.ts) (key: `issue-log-v1`), capped at 100 FIFO. Owner-gated retrieval UI at Settings → Owner Tools → Issue Log (route `/owner-logs`). After Fix R, recent entries also surface on the round recap screen filtered by the round window.

---

## 7. Trust Spectrum

[store/trustLevelStore.ts](../store/trustLevelStore.ts) — 5 levels, default L2:

| Level | id | Label | One-liner | Behavior |
|---|---|---|---|---|
| 1 | `quiet` | **Quiet** | "Just the basics." | Voice suppression except user-initiated (mic tap → answer). No briefing auto-speak, no proactive Kevin, no filler, no per-hole intro. |
| 2 | `companion` | **Companion** | "Kevin's there when I need him." | Default. Proactive voice enabled; briefing speaks; per-hole intro fires. |
| 3 | `active` | **Active** | "Kevin engages along the way." | More frequent proactive lines, filler clips between actions. |
| 4 | `full` | **Full** | "Kevin's right there with me." | Maximum verbosity; tracks more shots; surfaces ghost deltas. |
| 5 | `cockpit` | **Cockpit** | "Minimal cockpit layout — tools first." | Alternate UI layout (brand header + steppers + SmartFinder + pills); voice behavior similar to L2. |

**Slider display order**: `TRUST_LEVEL_SLIDER_ORDER = [1, 5, 2, 3, 4]` ([trustLevelStore.ts:53](../store/trustLevelStore.ts#L53)) — Cockpit slots between Quiet and Companion by *intensity*, not by numeric value. **Cyclers must use this array, never modulo on the numeric level.**

**Gates in code:**
- Voice: `isVoiceAllowed` returns false when `trustLevel === 1 && !userInitiated` ([voiceService.ts:287-302](../services/voiceService.ts#L287-L302))
- Per-hole intro: `trustLevel !== 1` ([roundStore.ts setCurrentHole](../store/roundStore.ts))
- Skip-briefings hole-1 line: same gate ([caddie.tsx:1444](../app/(tabs)/caddie.tsx#L1444))
- Briefing auto-speak: same gate ([round/briefing.tsx](../app/round/briefing.tsx))

---

## 8. REAL vs STUB vs DEFERRED

The honesty matrix Tank lives by. Three states:
- ✅ **REAL** — works end-to-end, safe to demo to a paying student
- ⚠️ **STUB / PREVIEW** — visually looks like a feature but isn't actually doing the work. Do NOT demo as live.
- ⏳ **DEFERRED** — intentionally not built, marked in code. Roadmap.

### 8.1 REAL — safe to demo

| Capability | Evidence |
|---|---|
| GPS subsystem (foreground watch, accuracy ladder, smoothing, outlier rejection, mode switching) | [gpsManager.ts](../services/gpsManager.ts) |
| Background location + foreground service (post Fix N) | [backgroundLocationTask.ts](../services/backgroundLocationTask.ts) |
| Hole detection (10s sustained, 30y green gate, sequence-aware, manual override lockout) | [holeDetection.ts](../services/holeDetection.ts) |
| SmartFinder F/M/B yardages with `no_geometry` honest fallback | [smartFinderService.ts](../services/smartFinderService.ts) |
| Mark Green CTA + per-(courseId, hole) override persistence | [app/mark-green.tsx](../app/mark-green.tsx), [courseGreenOverrides.ts](../services/courseGreenOverrides.ts) |
| SmartVision (curated/gps/auto imagery modes; draggable Y target) | [app/smartvision.tsx](../app/smartvision.tsx) |
| TightLie (Sonnet vision lie analysis + tactical advice) | [api/lie-analysis.ts](../api/lie-analysis.ts) |
| Cockpit + DataStrip scoring + hole nav (Fix O) | [CockpitCaddieScreen.tsx](../components/caddie/CockpitCaddieScreen.tsx), [CaddieDataStrip.tsx](../components/CaddieDataStrip.tsx) |
| Per-hole intro voice (Fix S) | [roundStore.ts setCurrentHole](../store/roundStore.ts) |
| Recap (share card, PDF, narration, notes section per Fix R) | [recap/[round_id].tsx](../app/recap/[round_id].tsx) |
| Persona-aware voice + brain (post Fix Q) | [voiceService.ts](../services/voiceService.ts), [api/kevin+api.ts](../app/api/kevin+api.ts) |
| Voice intent classification (Haiku) + 17+ handlers | [api/voice-intent+api.ts](../app/api/voice-intent+api.ts), [services/intents/](../services/intents/) |
| Honest-failure fallback (Fix I — 5 silent-drop sites + server outer catch) | [listeningSession.ts:136-164](../services/listeningSession.ts#L136-L164), [api/kevin+api.ts:510-517](../app/api/kevin+api.ts#L510-L517) |
| Trust Spectrum (5 levels, L1 voice suppression) | [trustLevelStore.ts](../store/trustLevelStore.ts) |
| SmartMotion Card 2 (Sonnet swing analysis + Phase 418 validation gate) | [api/swing-analysis.ts](../api/swing-analysis.ts) |
| Cage Mode core (Fix G phase machine + acoustic impact + ball speed + coach review) | [cage-mode.tsx](../app/swinglab/cage-mode.tsx), [api/cage-coach.ts](../api/cage-coach.ts) |
| Selfie → caddie face transformation (OpenAI gpt-image-1, voice/brain stay decoupled) | [api/image-edit.ts](../api/image-edit.ts), [custom-caddie.tsx](../app/profile/custom-caddie.tsx), [CaddieAvatar.tsx](../components/CaddieAvatar.tsx) |
| Ghost play (live during round, surfaces in recap) | [ghostStore.ts](../store/ghostStore.ts) |
| Owner Issue Log + recap Notes section | [issueLogStore.ts](../store/issueLogStore.ts), [owner-logs.tsx](../app/owner-logs.tsx) |
| Health Connect OPT-IN tap-to-grant (Fix N-3 — moved off round-start path) | [app/settings.tsx](../app/settings.tsx), [services/healthData.ts](../services/healthData.ts) |
| Synthetic round harness v2-lite (cart/walk mode, manual-override guard, persona logging) | [services/simulatedGPS.ts](../services/simulatedGPS.ts), [app/gps-test.tsx](../app/gps-test.tsx) |

### 8.2 STUB / PREVIEW — do NOT demo as live

| Capability | What's fake | Evidence |
|---|---|---|
| **SmartMotion pose skeleton overlay** | Animated mock of MoveNet-17 keypoints. No real pose detection. | [smartmotion.tsx:1-22 header](../app/swinglab/smartmotion.tsx#L1-L22) — explicit `StubSkeletonOverlay` comment. No MoveNet/MediaPipe/TFJS imports. |
| **SmartMotion club / ball speed metrics** | Labeled `(est)` — come from `simulateSwing()` math, not a real sensor | [watchService.ts](../services/watchService.ts) |
| **Cage Mode bullseye gate** | DELETED in Fix G. `bullseye_offsets` always `[]`. CageOverlay still renders for visual alignment but the "bullseye detected" gate is gone | [cage-mode.tsx:1-12](../app/swinglab/cage-mode.tsx#L1-L12), [cageApi.ts](../services/cageApi.ts) |
| **Glasses connection UI** | `settingsStore.glassesConnected` field present (line 92) but no `glassesService.ts`, no real wiring. Vestigial | [settingsStore.ts:92](../store/settingsStore.ts#L92) |

### 8.3 DEFERRED — roadmap, not built

| Capability | Why deferred | Path forward |
|---|---|---|
| **Real pose tracking (MoveNet local)** | TFJS + expo-gl native deps + new APK build | `services/poseDetection.ts` swap-in point already commented in swing-analysis.ts |
| **Galaxy Watch IMU integration** | Samsung Health SDK + native module + EAS build (not OTA) | [watchService.ts:112-118](../services/watchService.ts#L112-L118) `FUTURE: REAL SDK HOOK` block |
| **Cage CV bullseye scoring** | `/api/cage/analyze` never built; Fix G removed the broken client wiring | New CV pipeline (or skip) — out of 1.0 scope |
| **Meta glasses integration** | Item #7 post-launch. App ID `2111052109463421` captured in SPRINT-LOG; manifest tag deferred until full SDK pass | EAS native build cycle |
| **Range Mode** | No file in repo | 1.1 |
| **Drills (picker / detail / plate UIs)** | Scaffolding only (persona assignment for `drills` exists) | 1.1 |
| **Swing Library** | Cage saves clips but no library UI | 1.1 |
| **CV scoring — Skills / Sim / Scramble** | API returns 400 "not yet implemented"; only CTP shipped | 1.1 |
| **Arena / Challenge UI** | No screens; cv-scoring API ready | 1.1 |
| **Second-swing comparison (ghost across different courses)** | Same player only today | 1.1 |
| **iOS build** | Tim explicit hold; HealthKit not wired | Future |
| **Sentry production crash capture** | Account connected; DSN not yet set as EAS secret | One `eas env:create` away |

---

## 9. Known Issues + Pending Verification

| Item | Status | Next step |
|---|---|---|
| **Start Round crash on Z Fold (HC native JNI fatal)** | Fix N-3 shipped commit `97c04ed`, in build `c7f5ad9a` | Tim install APK, tap Start Round — should not crash. If still crashes, capture `adb logcat AndroidRuntime:E *:S` for ground truth |
| **Per-hole intro voice** | Fix S shipped commit `1646a2d` (JS-only, OTA) | Tim on-device: walk to hole 2 or tap DataStrip ▶, confirm "Hole 2. Par X. Y yards." in active persona |
| **Honest-failure fallback** | Fix I shipped commit `fefc7bc` | Airplane-mode test: caddie should speak "I'm having trouble connecting — try that again" instead of going silent |
| **Cross-persona bleed** | Fix Q Path B shipped commit `338329e` | Set Serena → confirm Serena on every surface, no Kevin bleed |
| **Hole-jumping on co-located courses (Lakes / Palms interweave)** | NOT yet shipped — diagnosis only | Fix L design: multi-course atCourse picker + true centroid math + "playing X but GPS says Y" safety belt |
| **Sentry production capture** | Account connected; DSN not yet wired | `eas env:create --environment preview --name EXPO_PUBLIC_SENTRY_DSN --value "<dsn>"` then next build self-reports |
| **Real cart round verification** | Cart-is-default principle; real-GPS field test pending | Tim's next real round on the Z Fold |

---

## 10. Architecture Notes

### 10.1 Zustand stores + persistence

All stores use `zustand/middleware/persist` + [services/ssrSafeStorage.ts](../services/ssrSafeStorage.ts) (AsyncStorage with web/SSR fallback).

| Store | Owns | Persist key | Notable fields |
|---|---|---|---|
| [roundStore](../store/roundStore.ts) | Active round + roundHistory | `smartplay-round` (legacy `round-store-vN`) | `isRoundActive`, `currentHole`, `scores`, `putts`, `shots`, `courseHoles`, `currentRoundId`, `roundHistory` |
| [settingsStore](../store/settingsStore.ts) | User preferences | `settings-store-v2` (version 7) | `caddiePersonality`, `caddieAssignments`, `voiceEnabled`, `language`, `trustLevel` (via separate store), `cartMode`, `simpleBriefing`, `personaIntensity`, `tankSoftIntro`, `cockpitMode`, `yardageMode`, `cageAutoClubDetection`, `voiceOnPhoneSpeaker` |
| [playerProfileStore](../store/playerProfileStore.ts) | Identity + subscription | `player-profile-store` | `email`, `name`, `firstName`, `handicap`, `dominantMiss`, `experienceContext`, `subscription_status`, `trial_started_at`, `customCaddiePortraitB64`, `useCustomCaddie` |
| [watchStore](../store/watchStore.ts) | Galaxy Watch state | not persisted (rechecked on mount) | `isConnected`, `sessionSwings`, `lastSwing` |
| [issueLogStore](../store/issueLogStore.ts) | "Kevin, log this" entries | `issue-log-v1` | `entries[]` (100 FIFO, with `id`, `timestamp`, `text`, `context`) |
| [teamIntelligenceStore](../store/teamIntelligenceStore.ts) | Caddie handoff suggestions | persists `cooldowns` only | `pendingSuggestion`, `acceptedHandoffs`, `cooldowns` |
| [trustLevelStore](../store/trustLevelStore.ts) | Trust Spectrum L1-L5 | `trust-level-store` | `level` |
| [ghostStore](../store/ghostStore.ts) | Active ghost match | session-only (not persisted) | `ghostRecord`, `holeResults`, `overall_delta` |
| [cageStore](../store/cageStore.ts) | Cage session state | session-only | recent cage sessions, plateaus |
| [toastStore](../store/toastStore.ts) | Ephemeral toast notifications | session-only | queue + current toast |
| [relationshipStore](../store/relationshipStore.ts) | Player↔Caddie relationship metrics | persisted | `roundsTogether` (drives simpleBriefing heuristic) |

### 10.2 Single-source-of-truth declarations

| Concern | Canonical owner | Don't duplicate |
|---|---|---|
| GPS fix | [gpsManager.ts](../services/gpsManager.ts) | No direct `expo-location.watchPositionAsync` outside this file (and `permissionsManager.ts` for permission check) |
| Distance math | [utils/geoDistance.ts](../utils/geoDistance.ts) `haversineYards` | One canonical haversine; consolidated in Consolidation 1 |
| Active persona | [settingsStore caddiePersonality](../store/settingsStore.ts) (single global) + caddieAssignments (per-pillar overlay) | Per Fix Q: `setCaddiePersonality()` resets the per-pillar map |
| TTS voice tuning | [api/_voiceTuning.ts](../api/_voiceTuning.ts) | Shared by `/api/voice` and `/api/kevin`; consolidated in Consolidation 1 Merge B |
| Watch connection | [watchStore](../store/watchStore.ts) | Cage Mode, Settings, native SDK all read this; not a local cache (Consolidation 1 Merge C) |
| Hole geometry | [services/courseGeometryService.ts](../services/courseGeometryService.ts) | 7-day AsyncStorage cache, `_seedGeometry()` for synthetic harness, `fetchCourseGeometry()` for real courses |

### 10.3 API endpoints inventory

Vercel routes (live):

| Endpoint | Purpose | Provider |
|---|---|---|
| `/api/kevin` | Main caddie brain — Sonnet 4.5, register Caddie/Coach/Psychologist, tool_use for structured outputs, ephemeral cache, Fix I outer-catch fallback | Anthropic |
| `/api/kevin/coach` (alias for `/api/cage-coach`) | Cage swing review | Anthropic |
| `/api/brain` | Lighter conversational endpoint (no tactical tools) | OpenAI |
| `/api/voice-intent` | Intent classifier — Haiku 4.5, returns `{intent_type, parameters, confidence, follow_up_question}` | Anthropic |
| `/api/voice` | TTS — ElevenLabs primary, OpenAI gpt-4o-mini-tts fallback | ElevenLabs + OpenAI |
| `/api/transcribe` | Speech-to-text | OpenAI Whisper |
| `/api/swing-analysis` | SmartMotion Card 2 swing analysis (Sonnet vision on 1-5 JPEG frames) + Phase 418 validation | Anthropic |
| `/api/lie-analysis` | TightLie — Sonnet vision lie + tactical advice | Anthropic |
| `/api/pose-analysis` | Pose keypoints (Fix H: returns HTTP 200 + `{data: null, configured: false}` honestly when not configured) | (stub — pose deferred) |
| `/api/cage-coach` | Cage Mode Kevin coach review | Anthropic |
| `/api/cage-review` | Cage review variant | Anthropic |
| `/api/acoustic-detect` | Audio frames → ball speed estimate (cage) | server-side analysis |
| `/api/cv-scoring` | Closest-to-Pin proximity estimate (1.0); Skills/Sim/Scramble return 400 (1.1) | Anthropic vision |
| `/api/image-edit` | Selfie → caddie face (OpenAI `gpt-image-1`) | OpenAI |
| `/api/vision` | Generic image analysis | Anthropic |
| `/api/briefing` | First-tee briefing prose | Anthropic |
| `/api/preround` | Pre-round context synthesis | Anthropic |
| `/api/recap` | Post-round recap (hole summaries + overall) | Anthropic |
| `/api/parse-shot` | Voice utterance → structured ShotResult | Anthropic |
| `/api/space-scan` | Camera scan analysis | Anthropic vision |
| `/api/club-recognition` | Cage club ID via image | Anthropic vision |
| `/api/tutorial-analysis` | Tutorial fit analysis | Anthropic |
| `/api/smartmotion` | SmartMotion proxy (routes to swing-analysis) | Anthropic |
| `/api/context-synthesis` | Generic context shaper | Anthropic |
| `/api/golfbert-proxy` | GolfBERT proxy | external |
| `/api/course-proxy` | golfcourseapi proxy | external |
| `/api/course-geometry` | Course geometry (tee, green, hazards) | external + cache |
| `/api/course-content` | Course content (descriptions) | external |
| `/api/weather` | Hole-time weather | external |
| `/api/health` | Health check | trivial |

### 10.4 `vercel.json` per-route overrides (Fix I shape B)

Five LLM-heavy routes bumped to `maxDuration: 30`:
- `kevin`, `brain`, `voice-intent`, `swing-analysis`, `cage-coach`

All others stay at the Vercel default (10s).

### 10.5 Boot sequence (`app/_layout.tsx`)

1. Polyfills (`services/polyfills.ts`) — must be first
2. Sentry init — gated on `EXPO_PUBLIC_SENTRY_DSN` (currently undefined; no capture)
3. Trial lifecycle — initialize, check expiry, owner lifetime grant
4. `initAudioLifecycle()`, `initBatteryMonitor()` — idempotent
5. OTA silent check — `expo-updates.checkForUpdateAsync`
6. `whenRoundStoreHydrated(...)` — gates round-active subscribers on hydration
7. Subscribers (fire when `isRoundActive` flips):
   - `activateMediaSession` / `deactivateMediaSession`
   - `startHoleDetection` / `startOffCourseDetector` / `startMovementModeDetector`
   - `shotDetectionService.start()` / `conversationalLoggingOrchestrator.start()`
   - GPS manager start (via roundStore.startRound's orchestration IIFE)
8. Team Intelligence boot: `initTeamIntelligenceForSession()` (once per cold launch)
9. Accept-handoff subscriber on `useTeamIntelligenceStore` (calls `setCaddiePersonality` directly post-Fix-Q)

**Phantom-round boot guard**: AsyncStorage-persisted `isRoundActive: true` from a prior session is checked at boot and discarded if stale (Audit B P0 fix).

---

## Appendix A — Glossary

- **Pillar** — one of `round` / `cage` / `drills` / `play`. A unit of the per-pillar persona override system (Phase 105 Team Caddie).
- **Persona** — Kevin / Serena / Tank / Harry. Drives voice + brain + on-screen avatar (face decoupled via `useCustomCaddie`).
- **Trust Spectrum** — L1-L5 verbosity gate.
- **Honest fallback** — when an LLM call or TTS fails, speak a short localized "having trouble, try again" instead of silence (Fix I).
- **No-fake-precision** — display estimates with `(est)` labels; surface GPS quality; never fabricate analysis on low-SNR captures.
- **Silent contract** — handler exists + write path canonical, but the addressable layer above doesn't address it correctly (Fix O scoring + Fix P log_score were both this).
- **OTA** — JS-only update via expo-updates, no rebuild required. Most fixes ship OTA.
- **EAS rebuild** — required for native module changes (Watch IMU, glasses, manifest permissions, plugin changes).

---

*Compendium built from code walk 2026-05-21. Update when reality diverges.*
