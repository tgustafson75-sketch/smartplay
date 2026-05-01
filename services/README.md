# services/

Client-side service layer. Each service is a thin module that wraps a concern and exposes a small public API; React components and hooks consume them via direct imports.

## Voice command layer (Phase A.1)

| File | Purpose |
|---|---|
| `voiceCommandParser.ts` | Calls `/api/voice-intent` to classify a transcript into a structured `VoiceIntent`. |
| `voiceCommandRouter.ts` | Registry + dispatch for `IntentHandler`s. Maintains a 30-entry rolling history. |
| `intents/` | One handler per intent type: `open_tool`, `query_status`, `change_setting`, `acknowledge`. `index.ts` registers them all on the singleton router. |

## Conversational shot logging (Phase A.2)

| File | Purpose |
|---|---|
| `shotDetectionService.ts` | GPS-based shot signature detector. Subscribes to `expo-location`, watches for sustained displacement (>30 yds) after a stationary window (>20 s), suppresses cart speeds, emits `shot_likely` events. Manual `triggerManual()` available for tests / fallback. |
| `conversationalLoggingOrchestrator.ts` | Subscribes to `shotDetectionService`, plays one of seven Kevin prompt variations after a 5-15 s natural pause, opens the mic for 8 s, parses the response via `/api/parse-shot`, logs to `roundStore`. Handles skip phrases, lie follow-up, and fallback to manual shot card. |
| `vocabularyProfileService.ts` | Accumulates the user's actual phrasings into a persisted profile (zustand + AsyncStorage). The top phrases are injected into the parser context so Haiku adapts to the user's vocabulary over time. |

## Voice I/O & content safety

| File | Purpose |
|---|---|
| `voiceService.ts` | Audio mode management, TTS playback (`speak`, `speakFromBase64`), one-shot `captureUtterance(timeoutMs)` for non-conversational recording. |
| `contentGuardrail.ts` | Regex-based NSFW filter that wraps every Kevin-text-to-TTS path. Returns a clean fallback and discards dirty audio. |
| `fillerLibrary.ts` | Pre-recorded filler clip index used to mask brain latency during voice queries. |

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
