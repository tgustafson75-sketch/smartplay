# Phase 420 — Caddie / Voice Audit

**Audit date:** 2026-05-20
**Bundle commit:** `e872f9b`
**Scope:** Persona truth, voice routing, brain abstraction, persistent badge, TTS path.

---

## 1. Persona single source of truth

### File: `lib/persona.ts` (115 LOC)

- **`ALL_PERSONAS`** at `lib/persona.ts:76`:
  ```ts
  export const ALL_PERSONAS: readonly Persona[] = ['kevin', 'serena', 'harry', 'tank'] as const;
  ```
- **`ACTIVE_PERSONAS`** at `lib/persona.ts:89`:
  ```ts
  export const ACTIVE_PERSONAS: readonly Persona[] = ['kevin', 'serena', 'tank'] as const;
  ```
  Harry is intentionally dormant (per Tim's call — overlaps Kevin's arc too closely). Spec, voice config, avatars, and routing all stay in place so re-enable is one line.
- **`getCaddieName(input)`** at `lib/persona.ts:52-54` and **`getCharacterSpec(input)`** at `:56-58` — single canonical resolvers.
- **`PERSONA_NAMES`** at `:9-14`, **`PERSONA_SPECS`** at `:16-21`, **`PERSONA_GENDERS`** at `:23-28`, **`PERSONA_PRONOUNS`** at `:30-35` — all four caddies defined consistently in this one file. Per-caddie spec strings import from `constants/{kevin,serena,harry,tank}Character.ts`.

### Verdict: SOLID

All four personas are defined consistently in exactly one file. `getCaddieName` and `getCharacterSpec` resolve through the same `resolvePersona()` helper at `:46-50` with explicit back-compat: legacy `'male'/'female'` strings map to Kevin/Serena defaults; unrecognised strings fall through to `'kevin'`.

Server-side helpers `getCaddieNameFor(body)` and `getCharacterSpecFor(body)` (`:100-114`) close the F13 server-side gap from audit 101/B4 — they read `body.persona` first and fall back to `body.voiceGender` so old clients still get the right persona on every API route.

**Consumers of `ACTIVE_PERSONAS`:** `app/settings.tsx:23,834`, `app/(tabs)/caddie.tsx:38,3103-3113`, `components/tools/GlobalToolsMenu.tsx:41,104,238`. All three sites use it for picker UI and tap-to-cycle order — none reimplements the persona list.

---

## 2. Voice IDs / TTS routing

### Cross-check: `api/voice.ts` ELEVEN_VOICES_BY_PERSONA vs `api/kevin.ts`

#### `api/voice.ts:11-21`

```ts
const KEVIN_VOICE_ID  = '1fz2mW1imKTf5Ryjk5su';
const SERENA_VOICE_ID = 'RGb96Dcl0k5eVje8EBch';
const HARRY_VOICE_ID  = '5Jfxy1x2Df4No3LQBZXE';
const TANK_VOICE_ID   = 'gQOVuaEi4cxS2vkZAK3A';

const ELEVEN_VOICES_BY_PERSONA: Record<string, string> = {
  kevin:  KEVIN_VOICE_ID,
  serena: SERENA_VOICE_ID,
  harry:  HARRY_VOICE_ID,
  tank:   TANK_VOICE_ID,
};
```

#### `api/kevin.ts:945-950` (Phase 420 just added 2026-05-20)

```ts
const ELEVEN_VOICES_BY_PERSONA: Record<string, string> = {
  kevin:  '1fz2mW1imKTf5Ryjk5su',
  serena: 'RGb96Dcl0k5eVje8EBch',
  harry:  '5Jfxy1x2Df4No3LQBZXE',
  tank:   'gQOVuaEi4cxS2vkZAK3A',
};
```

### Verdict: voice IDs are identical and correct in both files. **BUT** this is the worst caddie/voice finding in the audit:

**The voice ID map AND the per-persona voice_settings tuning are duplicated literally between `api/voice.ts:41-46` and `api/kevin.ts:951-956`.** Both files declare:

```ts
const ELEVEN_SETTINGS_BY_PERSONA: Record<string, { stability; similarity_boost; style; use_speaker_boost }> = {
  kevin:  { stability: 0.45, similarity_boost: 0.75, style: 0.55, use_speaker_boost: true },
  serena: { stability: 0.50, similarity_boost: 0.75, style: 0.50, use_speaker_boost: true },
  tank:   { stability: 0.35, similarity_boost: 0.70, style: 0.70, use_speaker_boost: true },
  harry:  { stability: 0.65, similarity_boost: 0.80, style: 0.30, use_speaker_boost: true },
};
```

**Drift risk:** the next time someone tunes one persona's voice they'll touch one file and miss the other. A single shared module (e.g. `api/_voiceTuning.ts` exporting `ELEVEN_VOICES_BY_PERSONA` + `ELEVEN_SETTINGS_BY_PERSONA`) would prevent that.

The Phase 420 commit (`a63d1b3 Tools FAB: small right-side icon expands left + persona-aware Kevin TTS`) fixed the bug Tim reported — Kevin's voice speaking for every persona — by literally copy-pasting the routing from `api/voice.ts` into `api/kevin.ts`. The fix is correct on inspection (`api/kevin.ts:937-1004`), the duplication is the cleanup debt.

#### OpenAI TTS fallback

Both files fall back to OpenAI TTS with `personaKey === 'serena' ? 'nova' : 'onyx'`. All three male personas (Kevin/Harry/Tank) share `onyx` in the fallback — which means **if ElevenLabs fails, the three male personas sound identical.** This is documented in both files (`api/voice.ts:140-145` and `api/kevin.ts:993-995`) but it's still a real failure mode when the ElevenLabs key 401s or rate-limits.

---

## 3. Cascade brain / abstracted LLM call layer

### Finding: there is NO single brain abstraction. There are FIVE separate fetch sites that build their own `/api/kevin` (or `/api/brain`) request bodies.

| # | File                                | Line  | Endpoint        | What it sends                                                                       |
|---|---                                  |---    |---              |---                                                                                  |
| 1 | `hooks/useKevin.ts`                 | 106   | `/api/kevin`    | tactical caddie ask; smartFinderContext, persona, personaIntensity, pendingLieAnalysis, practice_context, register |
| 2 | `hooks/useVoiceCaddie.ts`           | 482   | `/api/kevin`    | full round ask; patternInsights, holePlan, ghostContext, watchData, smartVisionContext, mentalState (50+ fields)   |
| 3 | `services/listeningSession.ts`      | 283   | `/api/kevin`    | earbud listening session — short ask flow                                            |
| 4 | `services/listeningSession.ts`      | 334   | `/api/kevin`    | listening session chat-fallback path                                                 |
| 5 | `app/(tabs)/caddie.tsx`             | 708   | `/api/brain`    | direct caddie tab brain call                                                         |

### Each builds its own JSON body. Each must be updated when a new field is added server-side.

Smaller satellite consumers also exist:
- `api/cage-coach.ts` (server side, calls Anthropic directly)
- `api/kevin.ts` itself (the endpoint, not a consumer)
- `services/responseRouter.ts`, `services/cageApi.ts`, `services/intents/openToolHandler.ts` (these route through but don't fetch directly)
- `app/api-debug.tsx`, `app/ghost-debug.tsx`, `app/diagnostic-card.tsx` (debug surfaces)
- `scripts/simulations/run-sim.ts` (offline simulator)

### Verdict: ROUGH — duplication, not danger

The five direct fetch sites all read `useSettingsStore.getState().caddiePersonality` to thread the active persona, so persona routing is at least consistent. **But** every site duplicates: persona, personaIntensity, language, courseHoles slicing, register selection, pendingLieAnalysis read.

`hooks/useKevin.ts:106-145` is the most disciplined caller (single useCallback, AbortController + timeout). `hooks/useVoiceCaddie.ts:482-540` is the most bloated (50+ fields). A shared `buildKevinRequest(opts)` helper would let one place own the contract.

### `hooks/useKevin.ts` vs `hooks/useVoiceCaddie.ts` — both alive

Both hooks are actively used:
- `KevinBadge.tsx:32` consumes `useVoiceCaddie({ onVoiceStateChange, onResponseReceived })`.
- `hooks/useKevin.ts` is consumed via `useKevin()` — exported `ask()` is the simpler ask-and-get-text flow.
- They cover overlapping ground. Neither has been deleted.

---

## 4. Persistent Kevin badge pattern

### File: `components/KevinBadge.tsx` (152 LOC)

- Rendered ONLY in `app/hole-view.tsx:1181` (`<KevinBadge />`).
- Positioned `top-right` (anchored to `insets.top + 12`, `right: 16`) at `KevinBadge.tsx:103-109`.
- `width/height: 60`, `zIndex: 100`.
- Triggers `handleMicPress` on tap, navigates to `/(tabs)/caddie` on long-press.

### File: `components/CaddieAvatar.tsx` (1090 LOC)

- Rendered in `app/(tabs)/caddie.tsx` at four sites: `:1683, :1726, :1808, :1861` — all four within the Caddie tab itself (one per Trust Level layout).
- Per-persona avatar maps for Kevin (`CaddieAvatar.tsx:24-46`), Serena (`:56-81`), Harry (`:85-108`), Tank (`:111-150`) — all four are present and consistent shape.

### Finding: the "persistent Kevin badge" is NOT actually persistent.

- **Globally rendered components in `app/_layout.tsx:533-559`:**
  - `<BatteryPrompt />`
  - `<UpdateAvailableBanner />`
  - `<CaddieSuggestionCard />`
  - `<GpsQualityOverlay />`
  - `<CaptureOverlay />`
  - `<CaptionStrip />`
  - `<GlobalToolsMenu />`
  - `<GlobalToast />`
  - `<RoundActiveDevIndicator />`

  **No KevinBadge.** No `<CaddieAvatar />` at the root layout.

- `KevinBadge.tsx` only mounts on `app/hole-view.tsx` (the dedicated hole map screen).
- `CaddieAvatar` only mounts inside the Caddie tab itself (`app/(tabs)/caddie.tsx`).

### Drifted, not canonical

The pattern described in the audit prompt — "top-left of every screen" — is NOT what's shipping. The badge is present on the Hole View modal (top-right per the styles), and the avatar lives inside the Caddie tab only. No other screen (SwingLab, SmartFinder, SmartVision, TightLie, Cage, Settings) carries a Kevin presence indicator.

The `KevinPresenceContext` (`contexts/KevinPresenceContext.tsx`, mounted at `app/_layout.tsx:821`) is global — `setIsThinking`, `isSpeaking`, `isThinking` flow across the tree. But there's no consumer mounted at the root that renders a visible indicator. Components that DO consume the presence context (KevinBadge, CaddieAvatar) only render inside specific screens.

**Net:** if Tim's intent was "Kevin is always visible from anywhere in the app," that's NOT what the bundle does. If the intent was "Kevin is visible on the Caddie tab + the dedicated hole map," that IS what ships.

---

## 5. Voice routing / TTS path

### File: `services/voiceService.ts` (719 LOC)

Three public play entry points:

1. **`speak(text, gender, language, apiUrl, opts)`** — `:573-719`
   - Fetches `/api/voice` for fresh TTS audio bytes.
   - Reads persona at request time (`:614-622`): `require('../store/settingsStore').useSettingsStore.getState().caddiePersonality ?? null`.
   - Writes MP3 to a cache File, plays via `Audio.Sound.createAsync`.
2. **`speakFromBase64(base64, opts)`** — `:463-571`
   - Plays already-encoded audio (e.g. response payload from `/api/kevin` which now includes `audioBase64`).
   - Same singleton semantics as `speak()`: bumps `currentSpeechId`, cancels in-flight `currentSound`.
3. **`playLocalFile(uri, knownDurationMs, opts)`** — `:368-459`
   - Plays a pre-baked filler clip from the file system.

### Shared infrastructure

- Single serial queue at `:185-201` (`enqueueSpeak`) — every public entry point routes through it. Phase BM eliminated parallel-play races.
- Generation counter at `:190` (`speakGeneration`) — `stopSpeaking()` increments it; queued tasks bail when their captured generation no longer matches.
- `isVoiceAllowed(opts)` shared guard at `:295` — checks Quiet mode, audio route (`voiceOnPhoneSpeaker` setting), and `trustLevel === 1 && !opts.userInitiated` (per user-memory `voice-userinitiated-rule`).
- Three observability fan-outs: `notifySpeaking`, `notifyCaption`, `noteAudioActivity('tts')`.

### Verdict: SOLID but with three entry points

Per the audit prompt: "single clean speak() path or multiple? Are speakFromBase64 + playLocalFile + speak duplicating logic?"

**There are three entry points, and they DO duplicate ~50 LOC of boilerplate each:** speechId claim, cancel in-flight, configureAudioForSpeech, notifySpeaking, the createAsync/setOnPlaybackStatusUpdate race-with-timeout block. Each entry point has its own `try { ... } catch { ... }` with near-identical cleanup.

The duplication is justifiable because each entry point has a different fetch/IO precondition:
- `speak()` does an HTTP fetch to `/api/voice` and writes a cache file.
- `speakFromBase64()` decodes base64 and writes a cache file.
- `playLocalFile()` skips both — plays a known URI directly.

But the **playback core (createAsync → setOnPlaybackStatusUpdate → race-timeout)** is the same in all three, and could be a single `playSound(uri, opts)` helper. That refactor would remove ~80 LOC.

### `userInitiated` rule

Per user-memory `voice-userinitiated-rule`: any `speak()` / `playLocalFile()` at launch or in response to a user tap MUST pass `{ userInitiated: true }` or it goes silent at Trust Level 1. The guard lives at `voiceService.ts:295`:

```ts
if (trustLevel === 1 && !opts?.userInitiated) return false;
```

Checked one call site: `app/_layout.tsx:209` (team-handoff voice line) passes `{ userInitiated: false }` — intentional, because handoff lines should NOT play at L1. Another at `_layout.tsx:292` (caddie handoff after surface change) also passes `{ userInitiated: false }`. These are correct.

---

## Summary of findings

| Finding                                                                                                                | Severity |
|---                                                                                                                     |---       |
| Voice IDs + per-persona voice_settings duplicated literally between `api/voice.ts:11-46` and `api/kevin.ts:946-956`     | **HIGH** |
| Five separate fetch sites to `/api/kevin` + `/api/brain` build their own request bodies; no shared brain abstraction    | MEDIUM   |
| KevinBadge is mounted on ONLY `app/hole-view.tsx`; no globally-mounted Kevin presence indicator across screens          | MEDIUM   |
| OpenAI TTS fallback collapses Kevin/Harry/Tank to identical onyx voice when ElevenLabs fails                            | MEDIUM   |
| `services/voiceService.ts` playback core duplicated across `speak` / `speakFromBase64` / `playLocalFile` (~80 LOC dedup) | LOW      |
| `app/swinglab/smartmotion.tsx:225` "TODO: club tag sheet" — non-functional button                                       | LOW      |
| `useKevin` and `useVoiceCaddie` cover overlapping ground; neither has been deprecated                                    | LOW      |

### Worst finding (single-line)

**The Phase 420 fix to `api/kevin.ts` copy-pasted the voice routing map and tuning from `api/voice.ts` instead of importing them. Next time someone tunes Tank's voice they will touch one file and miss the other, and Tim will get Kevin's voice for Tank again on whichever surface they forgot.**
