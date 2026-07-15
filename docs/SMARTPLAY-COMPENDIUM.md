# SmartPlay Caddie — Technical Compendium

> **Authoritative internal reference for the app as it stands.** When this doc disagrees with the
> code, **trust the code** — re-walk and update. Honesty principle: REAL / PARTIAL / STUB / DEFERRED
> are marked explicitly; never demo something marked STUB or DEFERRED as live.

| | |
|---|---|
| **As of** | 15 Jul 2026 |
| **HEAD** | `3c6a8187` |
| **Commits** | 1,913 |
| **Sim gate** | 517 / 517 ✓ |
| **Runtime** | `1.0.0` OTA (channels: preview + production) |
| **API host** | `api.smartplaycaddie.com` |
| **Platforms** | iOS + Android |
| **Repo** | `/Users/timothyg/smartplay` (the `smartplaycaddie` dir is a near-empty stub) |

Status tags used throughout: **REAL** (shipped, works end-to-end) · **PARTIAL** (real core,
gated/limited) · **STUB** (scaffold/heuristic, not real signal) · **DEFERRED** (real code,
unverified on device / needs native build).

---

## 1. Overview & tech stack

SmartPlay Caddie turns a phone's own sensors — cameras, microphone, GPS — plus AI into a complete
golf system: a voice caddie, a swing coach, and a GPS rangefinder, with no external hardware
required. One shared brain reads one shared memory; every screen is a window into it.

| Layer | Choice |
|---|---|
| Client | React Native `0.81.5` · React `19.1.0` · Expo SDK `54` · expo-router `6` |
| State | Zustand + `persist` (versioned keys, SSR-safe AsyncStorage) — **53 stores** |
| Services | **~180** modules in `services/` (17 sub-clusters) |
| Backend | **54** Vercel serverless endpoints (`api/*.ts`), custom domain |
| AI | OpenAI · Google Gemini · Anthropic behind one abstraction (`api/_aiProvider.ts`) |
| Voice | Deepgram Nova-2 (STT) · OpenAI `gpt-4o-mini-tts` (TTS) |
| Maps | Mapbox Static satellite · Golf Course API + OSM geometry · Open-Topo-Data elevation |
| Ship | EAS Build + Update (OTA), 517-scenario sim gate, custom API domain |

## 2. Build history — the arc

~1,913 commits over ~12 weeks (25 Apr → 15 Jul 2026). Four movements; the sharpest lessons came
from what broke and had to be rebuilt.

| When | Movement | What landed |
|---|---|---|
| Late Apr | Foundation | First working loop — Kevin caddie, self-keeping scorecard, GPS-on-a-hole, onboarding. |
| May | Build-out (800+ commits) | SwingLab/SmartMotion engine, Cage acoustic mode, SmartFinder, course book + geometry, personas. |
| Late Jun | The hard lesson | A change run broke the voice path → rollback to known-good, rebuild forward one change at a time, voice-tested each step. Rule: the voice path is sacred. |
| Jun–Jul | One brain | The CNS memory; providers consolidated behind a local-first brain; SmartMotion mic + on-course caddie + practice engine unified onto one pipeline. |
| Early Jul | Proving it holds | Two whole-app honesty/data-integrity audit passes; the 517-scenario sim became the standing ship gate. |
| Mid Jul | The moat | Tier-1 AI-vision hole geometry + public-scorecard anchoring + plays-like elevation — any course, no paid geometry DB. |

## 3. Architecture

**App shell & routing.** Expo-router, file-based. Five tabs (`app/(tabs)/`): **Caddie** (AI/voice
hub, `caddie.tsx` ~212KB), **Play**, **Scorecard** (live-dot when a round is active), **SwingLab**,
**Dashboard**. Big feature surfaces are top-level stacks — `smartvision.tsx` (~131KB),
`smartfinder.tsx` (~117KB), `settings.tsx` (~132KB) — plus route folders (`swinglab/`, `cage/`,
`practice/`, `drills/`, `recap/`, `round/`, `course/`) and `*-debug` developer screens.

**State layer.** 53 flat Zustand stores, all persisted through a shared SSR-safe AsyncStorage
wrapper with versioned keys + migration/hydration guards. Anchors: `roundStore` (active round +
append-only history), `settingsStore`, `caddieMemoryStore` (the CNS), `clubBag/Selection/StatsStore`,
`cageStore`, `watchStore`, the points cluster, and a voice-telemetry cluster (`voiceHitRateStore`,
`voiceMissStore`) that measures the local-answer hit-rate.

**Services layer.** ~180 modules, clustered: caddie/brain (`localStatusResponder.ts`,
`cnsShotRead.ts`, `caddieMemoryRetrieval.ts`, `listeningSession.ts`, `intents/`); course/geometry
(`courseGeometryService.ts`, `holeGeometryDerivation.ts`, `mapboxImagery.ts`, `golfCourseApi.ts`);
GPS/on-course (`gpsManager.ts` ~1163 lines, `smartFinderService.ts`, `yardageResolver.ts`,
`elevationService.ts`); swing/analysis (`mediaPipePoseService.ts`, `smartTempo.ts`, cage analysis);
imports; cloud/backup (`cloudSync/`, Supabase); vision/glasses (`glassesVisionInput.ts`,
`metaWearablesBridge.ts`).

**Backend & AI provider.** 54 serverless endpoints; `vercel.json` declares ~45 explicit builds
(per-route `maxDuration` 10–60s) + a catch-all. `api/_aiProvider.ts` wraps three SDKs behind one
interface keyed by provider (`openai | gemini | anthropic`) and tier (`fast | quality`):
`completeText/JSON/Vision`, `completeWithTools`, `runAgenticLoop`. `providerFromHeaderSafe` resolves
the requested `X-AI-Provider` down to one whose key is configured. Every endpoint has a twin under
`app/api/*+api.ts` (Expo Router) alongside the Vercel `api/*.ts`.

> **Network reality:** the client always talks to the branded host `api.smartplaycaddie.com`
> (`services/apiBase.ts`). The `*.vercel.app` fallback was fully removed (2026-07-08) because that
> hostname is caught by network content filters while the branded domain is not.

**Deploy & native.** EAS Build + Update, runtime `1.0.0`, channels `preview` + `production` (plus a
`glasses` profile). Standard ship flow: type-check + the 517-scenario sim
(`scripts/simulations/run-sim.ts`) + commit/push + sequential OTA. Native modules (Kotlin/Swift,
health-tracked in `services/nativeModuleHealth.ts`): Meta Wearables DAT glasses (real Android
bridge), Wear OS swing capture (real Android bridge), MediaPipe pose (real native wrapper, graceful
null when unlinked). All no-op safely when the native module isn't present.

## 4. The caddie system — brain, CNS, voice

One law: **answer locally first from deterministic state + CNS memory, ping the cloud only on a
miss.** The cloud is one brain with per-persona delivery; the voice path is a guarded single-voice
pipeline.

**4.1 Brain pipeline.** Two orchestrators; the active one is `settingsStore.voiceOrchestrator`,
**default `pipecat`**. The mic front-end (`hooks/useVoiceCaddie.ts`) always runs
capture/transcribe/intent; the brain step swaps to Pipecat when active.

```
mic → useVoiceCaddie (capture)
  1. follow-up bypass (last line ended with "?")
  2. LOCAL-FIRST precheck — localStatusResponder.tryLocalReply() → hit & not AI-led? answer, 0 network
  3. AI-led carve-out {club_recommend, plays_like, reach} → fall through to cloud so AI leads
  4. voice command router (HIGH-confidence tool-opens only)
  5. cloud brain → /api/pipecat-turn (default, Claude) | /api/kevin (fallback, OpenAI)
  on MISS → offlineCaddie.answerOffline() → device-TTS notice ("no signal, saved that…")
```

- `api/pipecat-turn.ts` **REAL** — default brain (Anthropic via `runAgenticLoop`, UI tools returned as `tool_actions`).
- `api/kevin.ts` **REAL** — fallback brain, OpenAI-pinned, full app-tool catalog + per-persona TTS.
- `api/voice-intent.ts` **REAL** — structured intent classifier (a hand-maintained LOCKSTEP TWIN with `app/api/voice-intent+api.ts`).
- `api/brain.ts` — **HTTP 410**, deprecated → use `/api/kevin`.

> **Brain cascade (current):** as of 2026-07-08 the Kevin brain is deliberately **OpenAI-pinned with
> a single bounded retry (`FAST_FAIL_MS` 7s), then on-device local fallback** — not a multi-cloud
> chain. The older OpenAI→Anthropic→Gemini cascade was removed. (Pipecat, the default voice brain,
> does use Anthropic — a known tension with the "no runtime Anthropic" note in `CLAUDE.md`.)

**4.2 The CNS — `store/caddieMemoryStore.ts`** (**REAL**). Offline-first, device-local, per-player +
per-course memory (key `caddie-memory-v1`). Additive, null-safe, bounded. Persists: **bag**
(rolling-average carry, null until `MIN_SAMPLES = 5` real shots); **tendencies + swing metrics**
(dominant miss, EWMA tempo, start-line divergence, mishits); **course memory** (learned per-hole
typical club, best line, green behavior, scoring avg); **narrative profile** (who the golfer is);
**course book** (static per-hole note/description/hazards + the **public scorecard par + yardage**,
anchored at round start, plausibility-gated — available on hole 1 of a never-played course, offline).
`caddieMemoryRetrieval.getCaddieContext()` (**REAL**) composes one compact prompt block from only
real facts, honesty header "treat as strong priors; live GPS still wins on the working distance." The
block flows into **both** brains.

**4.3 Personas.** Five — `kevin · serena · harry · tank · custom` (Harry soft-removed from the active
picker; `custom` is the user's self-built caddie). **One brain, different delivery:** persona changes
only name, character-spec text, and TTS voice (`kevin→onyx, serena→nova, tank→ash, harry→fable`).
Per-pillar defaults: round=Kevin, cage=Tank, drills=Serena, play=Kevin. AI provider is a separate
axis (`X-AI-Provider` header).

**4.4 Voice path (frozen / sacred).** Capture (`voiceService.ts`, silence-VAD) → `api/transcribe.ts`
**REAL** (Deepgram Nova-2, golf keyword boosting) → intent → brain → `api/voice.ts` **REAL** (OpenAI
`gpt-4o-mini-tts`; ElevenLabs removed).

> **One-voice invariant.** Cloud MP3 (`Audio.Sound`) and device TTS (`expo-speech`) are mutually
> exclusive through a single serial slot + generation counter; starting either stops the other. A
> cloud→device failover chain (breaker degraded / non-OK / suspiciously small payload) means weak
> signal never goes mute — it drops to the device voice, matched to persona gender.

**4.5 Composed shot read — `services/cnsShotRead.ts`** (**REAL**). The "SmartFinder moat": one pure,
sync, offline-safe, never-throwing `composeShotRead()` producing the single unified read — plays-like
distance, the club (real bag, else honest standard ladder), a prioritized "why," in-play hazards,
hole-specific tendency, competition-only past performance. SmartFinder and the voice path consume the
same read, so they can't disagree. **Returns `null` rather than fabricate** when raw yardage is
missing.

## 5. Feature pillars & ship status

- **On-course / Round — REAL.** `gpsManager.ts` single GPS source (adaptive polling, fix provenance,
  hardened background/Doze). Live F/M/B via an honest precedence chain, returning `no_geometry` +
  "~"/scorecard fallback rather than fake precision (**course-data-gated**). Plays-like (wind/temp/
  elevation) fed by real elevation (`api/elevation.ts` → Open-Topo-Data, free, null→flat). Shot
  tracking, scorecard, briefing live.
- **SmartVision — REAL · Tier-1 geometry PARTIAL.** Mapbox `satellite-v9` aerial + clean two-way
  **Satellite/Static** toggle (`auto` = invisible best-available default). Tier-1: `api/hole-scan.ts`
  reads green + tee off a north-up tile with our own vision (honesty: `found_green=false` rather than
  hallucinate); `holeGeometryDerivation.ts` unprojects to lat/lng, flags `estimated`; a strictly-
  separate derived cache. Derives **only in-round, only for the standing hole**, merges (keeps real
  tee/hazards), badges "AI ESTIMATE," **fallback-only**. Pre-round "any course instantly" is the next
  step.
- **SmartFinder — REAL.** Four modes; on-course tilt read gated against the GPS baseline; off-course
  standalone measuring (tilt geodesic accepted, confidence capped Medium).
- **SwingLab / SmartMotion — PARTIAL.** Post-capture MediaPipe analysis is **REAL** but needs an EAS
  build to link the native module. Live capture skeleton is a **STUB** placeholder. Cage impact-
  timing is real on-device; ball-speed server-side; strike-quality is an honest heuristic (**STUB**,
  no on-device FFT); CV bullseye **deleted not faked** (deferred). Tempo, Coach Mode, drills, swing
  library **REAL**.
- **Practice & Progress — REAL.** Drill engine, points stores, training→performance correlation
  (explicitly association-not-causation; refuses to assert until enough data).
- **Imports & Backup — REAL.** AI-parse imports (round/scorecard, Toptracer, SmartPump, club
  recognition), hardened (timeouts, size guards, defensive JSON, honest copy). Server-mediated backup
  (`api/backup.ts` → Supabase service key; identity `sha256(email::passphrase)`). Swing-video backup
  deferred.
- **Hardware — DEFERRED.** Real Android-only bridges, unverified on device. Ray-Ban Meta glasses
  (real DAT bridge → shared vision path; voice-ingest v1 shipped; TTS/DAT conflict auto-pause TODO).
  Galaxy Watch (newer real IMU bridge supersedes an old `simulateSwing` scaffold).

## 6. API endpoint inventory (representative)

| Group | Endpoints |
|---|---|
| Caddie / voice | `pipecat-turn` (default) · `kevin` (fallback) · `voice-intent` · `transcribe` · `voice` · `pipecat-tool` · `meta-voice` |
| Vision / analysis | `hole-scan` · `space-scan` · `swing-analysis` · `lie-analysis` · `putting-analysis` · `club-recognition` · `pose-analysis` · `acoustic-detect` · `cage-review` · `ball-path`/`club-path` |
| Course data | `course-geometry` · `course-intelligence` · `course-places` · `course-content` · `course-ai-search` · `elevation` · `weather` |
| Imports | `round-import` · `course-import` · `workout-import` · `toptracer-parse` |
| Data / infra | `backup` · `usage` · `owner-triage` · `health` · `recap` · `briefing` · `preround` |

Provider models: OpenAI `gpt-4o-mini / gpt-4o` · Gemini `2.5-flash` · Anthropic `haiku-4-5 /
sonnet-4-6`. TTS `gpt-4o-mini-tts`, STT Deepgram Nova-2 (always OpenAI/Deepgram, not provider-routed).

## 7. Honesty spectrum & invariants (enforced in code)

- **Never fabricate a number** — estimates labeled, missing data returns `null`/"~", a bad strike
  never shown as good. `composeShotRead` / `getCaddieContext` return empty rather than invent.
- **Local-first, cloud on a miss** — deterministic + CNS answers run before any network call; a
  hit-rate store measures zero-token answers.
- **One voice, always** — cloud MP3 and device TTS mutually exclusive; weak signal fails over to the
  device voice rather than going mute.
- **Fallback never overrides truth** — AI-estimated geometry is separate-cached, confidence-capped,
  badged, gap-fill only.
- **Zero-setup is the product** — open the app → the caddie is already helping.
- **Ship it green** — type-check + 517-scenario sim gate every change; the voice path is frozen.

## 8. Known gaps & deferred

| Item | Status | Note |
|---|---|---|
| Live skeleton overlay | STUB | Placeholder during capture; post-capture analysis real. Needs native pose build. |
| Cage strike-quality | STUB | Feature heuristic; real DSP/FFT needs a native module. Impact timing is real. |
| Cage CV bullseye | DEFERRED | Deleted not faked — post-launch backend. |
| On-device MediaPipe pose | PARTIAL | Real, but only after an EAS build links the native module. |
| Tier-1 geometry pre-round | PARTIAL | In-round standing-on-hole only today; pre-round is next. |
| Meta glasses / Galaxy Watch | DEFERRED | Real Android bridges, unverified on device — need an EAS dev-client build. |
| Google Elevation / 3D precision | DEFERRED | Optional upgrade over the free DEM; blocked on a Google API key-scope step. |
| Swing-video cloud backup | DEFERRED | Round-history backup is live; video backup is a named want. |

---

*Companion interactive/print version: the [Technical Compendium artifact](https://claude.ai/code/artifact/94190810-11af-4fc9-a546-2e7d224fc18e). Current as of HEAD `3c6a8187` (15 Jul 2026). When the code disagrees with this doc, trust the code.*
