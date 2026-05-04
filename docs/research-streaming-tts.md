# Research — Streaming TTS via OpenAI (Phase BJ Component 8)

**Capability:** Reduce time-to-first-audio (TTFA) for Kevin's voice responses by streaming TTS chunks rather than buffering the full clip before playback. Targets the long Sonnet-routed responses (5-8s perceived latency today) where the user is staring at the avatar waiting.

**Verdict: BUILD-TODAY CANDIDATE — sentence-pipelined approach via existing `expo-av` (no new deps required)**

---

## Current state confirmed

- `services/voiceService.ts:326` — `speakFromBase64(base64, opts)` calls `Audio.Sound.createAsync({ uri: 'data:audio/mp3;base64,' + base64 })`. **This buffers the entire clip before playback starts.**
- The TTS round-trip flow: client requests TTS → OpenAI generates the *whole* audio → response arrives → client decodes base64 → `Audio.Sound` initialises → playback starts. All-or-nothing.
- For a 12-second Kevin response, TTFA is roughly: round-trip (200-400ms) + OpenAI generation (2-5s for the full 12s of audio) + decode + Sound init (~300ms) = **~3-6s before any audio plays**.

## Two viable paths

### Path 1A — Sentence-chunked playlist via `expo-av` (recommended)

Split incoming text into sentences. Fire 2-3 parallel OpenAI TTS calls per sentence (each non-streaming). As clips arrive, enqueue them. Start playing the first clip as soon as it lands; chain via `setOnPlaybackStatusUpdate` end-of-clip handler.

**TTFA improvement:** instead of waiting for the full clip, you wait for the *first sentence's* clip — typically 1-2s of audio at 300-600ms generation time = **~600ms-1.2s TTFA**. Improvement of ~3-5s for a 3-sentence response.

**Stack fit:**
- Uses installed `expo-av ~16.0.8` (no new deps)
- Same `Audio.Sound` API as today, just multiple sounds chained
- Same `subscribeToSpeaking` / `stopSpeaking` semantics retain
- No EAS prebuild, no native module work

**Scope:**

| Step | Hours |
|---|---|
| Sentence splitter (regex on `[.!?]` + length cap fallback) | 1 |
| TTS request pool with bounded concurrency (2-3 parallel) | 2 |
| Replace single-Sound playback with sequential `Audio.Sound` queue + chained end handlers | 3 |
| Cancellation propagation (user changes hole mid-utterance → kill queue + abort pending TTS calls via `AbortController`) | 2 |
| TTFA / total instrumentation logging | 1.5 |
| Empirical verification on Galaxy Z Fold | 1.5 |
| **Total** | **~11h** |

Above the prompt's <6h BUILD-TODAY bar but inside a focused phase. Worth doing before external beta — voice latency is the single biggest "is this app useful?" signal.

### Path 1B — `expo-audio` `AudioPlaylist`

`expo-audio` (newer SDK 52+ replacement for `expo-av`) has a native `AudioPlaylist` class with gapless `add()`/`next()`. Cleaner API than chained `Audio.Sound`s.

**Cost:** Adds `expo-audio` as a new dep alongside `expo-av`. Two competing audio stacks in the project temporarily — risk of conflicts if both Audio sessions are active. Not a clean win unless the project also migrates voice service from `expo-av` to `expo-audio` wholesale (much bigger refactor — out of scope for streaming TTS).

**Verdict: defer to a future audio-stack consolidation phase.** Path 1A ships the value without the consolidation cost.

### Path 2 — True chunk streaming via OpenAI SSE + `expo-audio-stream`

OpenAI `/v1/audio/speech` supports `stream_format: "sse"` + `response_format: "pcm"` returning base64 `speech.audio.delta` events. Decode chunks → feed into a streaming audio track.

`expo-av` cannot consume raw PCM chunks. Would require `@mykin-ai/expo-audio-stream` (community library, varying maintenance) or a custom native module.

**Cost:** Adds an unmaintained-shaped dep. Significant native-side complexity. Marginal latency improvement over Path 1A (Path 1A already achieves sub-1s TTFA for short utterances).

**Verdict: QUEUE.** Revisit only if Path 1A's empirical TTFA isn't acceptable.

## Cost implications

OpenAI TTS pricing is per-token (per character of input text), not per-call. Splitting one 100-character utterance into three 33-character calls produces *almost identical* total cost. Per-call HTTP overhead is small (~50-100ms × 3 calls vs 1 call, but they're *parallel*, so wall-clock is unchanged or improved).

For a typical 12-second Kevin response (~150 characters):
- Single call: ~$0.0023, TTFA 3-6s
- Three parallel calls: ~$0.0023, TTFA ~600ms-1.2s

**Net cost neutral, latency 5-10× better.**

## Side effects to handle

- **Sentence boundaries are hard for poetic / idiomatic responses.** Kevin's caddie register often uses incomplete sentences ("Driver? Sure. Just keep it down the right side."). The sentence splitter needs to chunk aggressively (split on `,;:.!?` with min/max length bounds) to keep TTFA low without producing weird audio prosody breaks.
- **Filler library conflicts.** When a Sonnet call has a filler bridge (`services/listeningSession.ts:224,313`), the streaming path needs to coordinate so the filler clip plays first, then the streaming response chains in. Existing chain logic should adapt cleanly because the existing `Audio.Sound` queue already supports sequential play.
- **Pre-rendered greeting clips** (`assets/audio/greetings/*.mp3`) stay buffered (they're tiny, no benefit from streaming).
- **Filler audio for Serena** (per Phase BN) is unaffected — same architecture.

## Decision

**BUILD-TODAY CANDIDATE — Path 1A (sentence-pipelined `expo-av`).** ~11 hour scope. Single deepest-impact latency improvement available short of a full audio-stack rewrite. Files affected:
- `services/voiceService.ts` — refactor `speakFromBase64` into queued path
- New `services/ttsQueue.ts` — sentence splitter + bounded-concurrency TTS request pool
- `api/voice.ts` (server-side) — no change required; per-call non-streaming requests work as-is
- `services/listeningSession.ts` — minor: coordinate with filler bridge

Awaiting Tim's go/no-go before this becomes a build phase ("Phase BP — TTS sentence pipeline"). If green, it ships before external beta.
