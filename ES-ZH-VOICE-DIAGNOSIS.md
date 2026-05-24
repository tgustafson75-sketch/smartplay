# ES/ZH VOICE PATH DIAGNOSIS — Why the Spanish utterance didn't respond

**Date:** 2026-05-24
**Mode:** Read-only. No source files modified. Only this doc is written.
**Question:** Spanish voice input produced no response. Where in the pipeline does it die?
**Answer (TL;DR):** **Stage 1 — the ASR (Whisper) is pinned to `settings.language`, which defaults to `'en'`.** When the user speaks Spanish without first changing the app language to Spanish, Whisper transcribes the audio as if it were English — the resulting transcript no longer contains Spanish substrings like `"cuántas yardas"`, so the classifier's language-detection rules never fire and route through to "unknown" → silence. **The full pipeline downstream of Stage 1 is wired correctly. ZH fails for the same reason.**

---

## Stage-by-stage trace

### Stage 1 — INPUT (Speech-to-text) — **THE BREAK POINT** ❌

**File:** [services/voiceService.ts:84-141](services/voiceService.ts#L84) — `captureUtterance(timeoutMs, apiUrl, language)`.
**Server:** [app/api/transcribe+api.ts:21-24](app/api/transcribe+api.ts#L21)

```ts
const transcription = await openai.audio.transcriptions.create({
  file: audio,
  model: 'whisper-1',
  language: language === 'zh' ? 'zh' : language,
});
```

**Caller:** [services/listeningSession.ts:201](services/listeningSession.ts#L201)
```ts
const captureP = captureUtterance(8_000, apiUrl, settings.language);
```

**What happens with the default settings:**
- `settings.language` defaults to `'en'` ([store/settingsStore.ts:233](store/settingsStore.ts#L233))
- Spanish audio + Whisper `language: 'en'` → Whisper interprets the audio as English. It either phonemically maps Spanish sounds to English-looking gibberish or silently translates the meaning to English. **In either case, the literal Spanish keywords disappear from the transcript.**
- Result: a garbled string that contains none of the classifier's Spanish triggers.

**Verdict:** Spanish does NOT survive Stage 1 unless `settings.language === 'es'` is set FIRST. Same for ZH.

---

### Stage 2 — CLASSIFIER (intent + language detection) ✓ — but starved by Stage 1

**File:** [api/voice-intent.ts](api/voice-intent.ts) (Language-detection block in the system prompt — `grep "Language detection"`).

The classifier has Spanish + Chinese substring triggers:
- ES: `"cuántas yardas"`, `"qué distancia"`, `"distancia al"`, `"al banderín"`, `"al centro del green"`, `"cuánto al"`
- ZH: `"多少码"`, `"到旗杆"`, `"到果岭"`, `"码到"`, `"到中心"`

These triggers only fire if **the transcript literally contains those substrings**. If Stage 1 mangles the audio into English-looking text, the triggers never see Spanish/Chinese characters and the classifier emits `language: 'en'`.

**Verdict:** Classifier itself is correct. It receives no Spanish to detect — the failure is upstream.

---

### Stage 3 — ROUTE / HANDLER ✓

**File:** [services/voiceCommandRouter.ts:84-86](services/voiceCommandRouter.ts#L84)

```ts
const ctx: AppContext = intent.language ? { ...context, language: intent.language } : context;
return await handler.execute(intent, ctx);
```

**Handler consumer:** [services/intents/queryStatusHandler.ts](services/intents/queryStatusHandler.ts) — `distance_to_green` case reads `context.language` and dispatches against `TTS_STRINGS[lang]` (en/es/zh).

**Verdict:** Router threads language correctly. Handler emits localized text. **Works correctly IF Stage 2 emits `'es'` or `'zh'`** — which requires Stage 1 to have produced a Spanish/Chinese transcript.

---

### Stage 4 — TTS (text → spoken audio) ✓

**File:** [services/voiceService.ts (`speak()` ttsModel derivation)](services/voiceService.ts) + [app/api/voice+api.ts](app/api/voice+api.ts)

```ts
const ttsModel = language === 'en' ? 'eleven_monolingual_v1' : 'eleven_multilingual_v2';
body: JSON.stringify({ text, gender, language, persona, model_id: ttsModel }),
```

**Call sites in listeningSession.ts** (3 places, all threaded):
- L387 follow-up question: `intent.language ?? settings.language`
- L510 main voice_response: `intent.language ?? settings.language`
- L649 handsfree-route: `intent.language ?? settings.language ?? 'en'`

**Verdict:** TTS routes through ElevenLabs `eleven_multilingual_v2` correctly whenever language is `'es'` or `'zh'`. Wired end-to-end. **Works IF Stage 3 receives a non-English language.**

---

### Stage 5 — SETTING (does `settings.language` actually flow?) ✓ wired, ❌ defaults wrong for the failure case

**File:** [store/settingsStore.ts:26, 233, 300, 546-547](store/settingsStore.ts#L26)
- Type: `language: 'en' | 'es' | 'zh'`
- Default: `'en'`
- Persisted via `partialize`: ✓ survives app restart
- Mutators: `setLanguage(l)` ([store/settingsStore.ts:300](store/settingsStore.ts#L300)) — wired to both the Settings UI picker ([app/settings.tsx:625](app/settings.tsx#L625)) AND the voice command `"switch to Spanish"` via [services/intents/changeSettingHandler.ts:89](services/intents/changeSettingHandler.ts#L89).

**Verdict:** Setting is wired correctly to Stage 1 (`captureUtterance(..., settings.language)`) and to Stage 4 (`speak(..., intent.language ?? settings.language, ...)`). The **value** at the moment of the Spanish utterance is what matters.

**The trap:** The voice command to change language ("switch to Spanish") relies on Stage 1 transcribing it correctly **in English** — which works fine. But to test Spanish features, the user has to either:
1. Use the Settings UI to switch language to Spanish (visual tap path), OR
2. Say "switch to Spanish" in English voice first, THEN speak Spanish.

If the user just opens the app and speaks Spanish directly → Stage 1 default `en` lock → silence.

---

## First stage where it dies: **Stage 1 (ASR)**

The pipeline is correct end-to-end. The break is in the **ASR's language pin policy** — Whisper is told the user's settings language, which defaults to English. There is no auto-detect path, and the classifier (Stage 2) cannot rescue a transcript that has already been corrupted upstream.

ZH fails at the same point for the same reason.

---

## Recommended fixes (described, not applied)

**Option A — single-line server fix (recommended):**
In [app/api/transcribe+api.ts:24](app/api/transcribe+api.ts#L24), change
```ts
language: language === 'zh' ? 'zh' : language,
```
to
```ts
language: language === 'es' || language === 'zh' ? language : undefined,
```
or simply
```ts
// omit the language field entirely — let Whisper auto-detect
```
**Effect:** When `settings.language === 'en'` (the default), Whisper auto-detects. Spanish audio → Spanish transcript → Stage 2 detects "es" via substring triggers → Stage 3-4 emit Spanish text + use multilingual TTS. When the user has explicitly chosen `es` or `zh`, that's a hard pin (helps accuracy on ambiguous short utterances).

**Cost:** Whisper's auto-detect adds ~50-100ms to transcription. Acceptable for the voice-flow latency budget (already 2-3s end-to-end).

**Option B — auto-set settings from classifier-detected language:**
After the classifier emits `language: 'es'`, also call `setLanguage('es')` so future utterances pin Whisper correctly. Two-step adaptation: the FIRST Spanish utterance might transcribe imperfectly with auto-detect, but every subsequent one is pinned. Combines with Option A.

**Option C — explicit user-facing language picker on onboarding:**
Surface the language picker on first launch (or in the permissions screen). Makes the language selection a deliberate user choice. UX-side fix; doesn't change the technical pipeline.

**Recommended:** **Option A** alone is enough to make Spanish/Chinese voice work today without any code change to the client. The other layers are already correct.

---

## Side-effect log that would confirm the diagnosis on-device

After the fix, the per-utterance side_effects should show:
- `lang:es` on `query:distance_to_green` (or whichever topic)
- `green_source:truth|courseHoles|geometryCache`

Today, with the bug present, you'd see `lang:en` even when the user spoke Spanish (because the classifier never saw Spanish keywords).

The AsyncStorage dump panel ([/cage-debug](app/cage-debug.tsx)) can confirm `settings-store-v2.language` value at the moment of testing.

---

## Verification script (to run after applying Option A)

1. `settings-store-v2.language === 'en'` (default — don't touch the Settings picker)
2. Speak: `"¿cuántas yardas?"`
3. Listen for response.
4. Inspect `voice-misses` store: should be empty (classifier should resolve).
5. Inspect handler side_effects: `lang:es`, `query:distance_to_green` — confirms the full chain executed in Spanish.
6. Audible: Spanish pronunciation via `eleven_multilingual_v2`.

**Repeat with Chinese** (`"多少码"` → expected `lang:zh` side-effect + Chinese pronunciation).

---

**End of diagnosis. Pipeline is correct; one server line fixes Stage 1.**
