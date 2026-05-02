# Voice Routing Audit (Phase P)

This document inventories every LLM call in the runtime conversation loop and the **routing decision** for each: direct handler (no LLM), Anthropic Haiku (fast conversational), Anthropic Sonnet (deep reasoning / vision).

It is the source of truth for `services/responseRouter.ts`. Update both together.

## Top-line finding

The runtime conversation loop (`services/listeningSession.ts`) is **already optimal** as of Phase P:

1. **Opener TTS** (~500ms) — pre-rendered phrase
2. **Mic capture** (user-paced)
3. **Intent classification** via `/api/voice-intent` → **Haiku** (~400ms)
4. **Handler dispatch** → **direct synchronous handler** in `services/intents/*` (instant)
5. **Response TTS** (~600-1000ms)

No Sonnet calls happen on the in-loop path. The "Hey— [silence]" gap is the cumulative latency of steps 3 + 5 (intent + TTS round-trips, ~1.0–1.4s of perceived silence between opener and response). **Phase P closes this with filler clips that bridge the gap**, not by switching models.

Sonnet calls exist out-of-band: lie analysis (Phase H), swing analysis (Phase K), course content (Phase D), recap (round end), briefing (round start), CV scoring (Phase L). Those have their own UI affordances and are not in the conversation loop.

---

## Per-intent routing table

| Intent | Trigger examples | Current handler | Phase P decision | Filler category | Rationale |
|---|---|---|---|---|---|
| `query_status / distance_to_green` | "how far to the green" | `queryStatusHandler` (direct) | **DIRECT** | none (fast enough) | Pure data lookup from `roundStore`. |
| `query_status / score` | "what's my score" | `queryStatusHandler` (direct) | **DIRECT** | none | Data lookup. |
| `query_status / wind` | "what's the wind doing" | `queryStatusHandler` (direct) | **DIRECT** | none | Data lookup from `useCurrentWeather`. |
| `query_status / hole_progress` | "how far have I gone" | `queryStatusHandler` (direct) | **DIRECT** | none | Data lookup. |
| `query_status / plays_like` | "what's it playing" | `queryStatusHandler` (direct) | **DIRECT** | none | Computed from cached weather + geometry. |
| `query_status / shot_distance` | "how far was that shot" | `queryStatusHandler` (direct) | **DIRECT** | none | Last-shot lookup from `roundStore`. |
| `query_status / ghost` | "where am I vs my ghost" | `queryStatusHandler` (direct) | **DIRECT** | `ghost` (rare bridge if slow) | Direct read; ghost route already in fillerPhrases. |
| `open_tool / lie_analysis` | "what should I do here" | `openToolHandler` (direct nav) | **DIRECT** nav, then **SONNET** vision in tool | `looking` | The nav is instant; the Sonnet vision call happens after the user takes the photo, with its own bridging filler. |
| `open_tool / smartfinder` | "open finder" | `openToolHandler` (direct) | **DIRECT** | `confirming` | Nav action. |
| `open_tool / swinglab` | "open practice" | `openToolHandler` (direct) | **DIRECT** | `confirming` | Nav action. |
| `change_setting / *` | "switch to dark mode" | `changeSettingHandler` (direct) | **DIRECT** | `confirming` | State mutation. |
| `navigate / *` | "next hole", "back" | `navigateHandler` (direct) | **DIRECT** | `confirming` | Router action. |
| `acknowledge` | "okay", "thanks" | `acknowledgeHandler` (direct) | **DIRECT** | `acknowledging` | Single-clip return. |
| `help` | "what can I say" | `helpHandler` (direct) | **DIRECT** | none | Returns canned help text. |
| `unknown` | unparseable utterance | router falls through | **HAIKU fallback** (future) | `acknowledging` | Today: silence. Future: route to `/api/kevin` Haiku branch. |

## Out-of-band Sonnet paths (not in conversation loop)

These call Sonnet because they **need vision** or **need deep reasoning** that Haiku can't handle. Each has its own UI loading state and/or filler bridge.

| Surface | Endpoint | Model | Mitigation |
|---|---|---|---|
| Lie Analysis camera | `/api/lie-analysis` | Sonnet 4.6 (vision) | Filler `looking` plays during request. UI shows skeleton card. |
| Swing Analysis (post-cage) | `/api/swing-analysis` | Sonnet 4.6 (vision) | Filler `analyzing` + skeleton `PrimaryIssueCard` while pose detection runs. |
| Course Detail prose | `/api/course-content` | Sonnet 4.6 | Generated once, **7-day in-memory cache**. No re-call latency on subsequent visits. |
| Round briefing | `/api/briefing` | Sonnet 4.6 | UI-blocking but expected — pre-round screen has its own loading state. |
| Round recap | `/api/recap` | Sonnet 4.6 | End-of-round screen with skeleton; no real-time interaction. |
| CTP CV scoring | `/api/cv-scoring` | Sonnet 4.6 (vision) | Camera affordance UI shows "scoring..." spinner. |

## Out-of-band Haiku paths

| Surface | Endpoint | Model | Notes |
|---|---|---|---|
| Voice intent classifier | `/api/voice-intent` | Haiku 4.5 | Loop-critical — this is the 400ms tax on every in-loop query. |
| Shot parser | `/api/parse-shot` | Haiku 4.5 | Two Haiku calls (one for parse, one for lie followup). |
| Cage review prompts | `/api/cage-review` | Haiku 4.5 | Practice surface only. |
| `api/kevin.ts` TACTICAL branch | `/api/kevin` | Haiku 4.5 | Routed by an in-line classifier; CONVERSATIONAL falls through to Sonnet. |

## TTS routing (separate axis from LLM routing)

| Provider | Model | Trigger | Latency |
|---|---|---|---|
| ElevenLabs | `eleven_turbo_v2` (en) / `eleven_multilingual_v2` (es,zh) | If `ELEVENLABS_API_KEY` set | ~400-700ms |
| OpenAI fallback | `gpt-4o-mini-tts` (voice: `onyx` / `nova`) | If ElevenLabs unavailable or errors | ~600-1000ms |

## Filler-firing policy (per `services/responseRouter.ts`)

```
if intent → direct handler with response_length < 60 chars → no filler (response is already a single sentence; TTS is short)
if intent → direct handler with response_length >= 60 chars → optional `acknowledging` if perceived gap > 800ms (instrumented)
if intent → out-of-band Sonnet vision → filler immediately on tool open (`looking` / `analyzing`)
if intent → unknown / Haiku fallback → `acknowledging`
```

## TTFA instrumentation

`services/listeningSession.ts` records timestamps:
- `t_capture_end` — `captureUtterance` resolves
- `t_intent_resolved` — `/api/voice-intent` returns
- `t_filler_start` — first filler audio frame plays (if any)
- `t_response_start` — `speak()` audio playback starts (the moment `Audio.Sound.createAsync({ shouldPlay: true })` resolves)
- `t_response_end` — playback finishes

Logged via `console.log('[ttfa] ...')` — production-friendly, scrapable from device logs without a metrics pipeline. Future: wire into Sentry breadcrumbs.

## Open follow-ups (post-Phase P)

- `unknown` intent currently dies silently. Should route to `/api/kevin` Haiku TACTICAL branch with a brief generative response.
- `query_status / ghost` could return richer phrases when ghost data is recent — currently terse string only.
- Wire route detection (Phase O.5 native bridge → Phase O audioRoutingService) to filler decisions: phone-speaker route should suppress fillers entirely.
- Tank persona phase will add Tank-voice fillers in a parallel library; the router will gain a `persona` axis.
