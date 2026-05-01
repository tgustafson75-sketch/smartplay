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
