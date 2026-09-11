# i18n audit — English / Spanish / Chinese

**Date:** 2026-09-10 · **Commit:** `6a287f7f` · **Mode:** read-only diagnosis, nothing fixed.
**Reason:** a language claim is about to go into the App Store and Play Store descriptions, and the
i18n wiring had not been verified in months.

> **VERDICT: BROKEN — es and zh.** Full statement in [§6](#6-verdict).

---

## 1. Implementation inventory

| Item | Finding | Evidence |
|---|---|---|
| Library | `i18next` ^26.2.0 + `react-i18next` ^17.0.8 | `package.json:84,88` |
| Device locale | `expo-localization` ~17.0.9, defensive `require` | `i18n/index.ts:40-55` |
| Init | Module side-effect on import | `i18n/index.ts:74-85` |
| Imported by | `app/_layout.tsx:39` | — |
| Fallback locale | `fallbackLng: 'en'` | `i18n/index.ts:81` |
| Source of truth | `settingsStore.language`, NOT device locale | `i18n/index.ts:59-72` |
| Suspense | disabled (`useSuspense: false`) | `i18n/index.ts:84` |

**Resource files** — all three are static-imported, so they are bundled and present at first render:

- `i18n/locales/en.json` — 178 keys
- `i18n/locales/es.json` — 178 keys
- `i18n/locales/zh.json` — 178 keys

**Does init complete before first render?** **Yes.** `i18n.init()` is synchronous for
static resources, runs as an import side-effect of `app/_layout.tsx:39`, and `useSuspense` is off.
There is no async backend and no loading race.

One ordering caveat, by design: `detectInitialLanguage()` (`i18n/index.ts:59`) reads
`settingsStore.getState().language` at module-evaluation time, which may run **before AsyncStorage
rehydrates**. The documented mitigation is a `settingsStore.subscribe` in `app/_layout.tsx` that calls
`i18n.changeLanguage` on every settings change (`i18n/index.ts:9-12`), so a persisted non-English
choice is applied a tick later rather than being lost.

### Chinese variant — determined from the characters, not the filename

**`zh-Hans` (Simplified).** Counted over `zh.json`: **153 Simplified-only characters, 0
Traditional-only.** Forms present: 个会传击动对开录数时杆标点离练继续设话车这选长风 — with **no**
Traditional counterpart (個會傳擊動對開錄數時桿標點離練繼續設話車這選長風) anywhere in the file.

Sample: `golf_advice.par3_wind` = `顶风。多用一号杆,挥杆平稳。`

> Note for the store listing: the app declares `zh` generically (`i18n/index.ts:65`,
> `detectDeviceLanguage` maps any `zh*` → `zh`). A Traditional-script user in Taiwan or Hong Kong
> matches that branch and is served **Simplified** text.

---

## 2. Key parity audit

Structural parity is **perfect**. Every key exists in every locale; nothing is missing, nothing is
orphaned, nothing is empty.

| Locale | Keys | Missing vs en | Orphans | Empty | Byte-identical to en | **Coverage** |
|---|---|---|---|---|---|---|
| en | 178 | — | — | 0 | — | 100% |
| es | 178 | **0** | **0** | **0** | 25 | **86.0%** (153/178) |
| zh | 178 | **0** | **0** | **0** | 7 | **96.1%** (171/178) |

Coverage = keys that are present, non-empty, and not byte-identical to English.

**Caveat, stated so the number is not over-read:** "identical to English" is a *placeholder
detector*, not proof of a defect. Most of the 25 Spanish collisions are golf and brand vocabulary
that is genuinely identical in Spanish — `labels.driver` "Driver", `scorecard.par` "PAR",
`scorecard.eagle` "Eagle", `brand.app_name` "SmartPlay Caddie". A handful are real gaps:
`scorecard.vs_par` "VS PAR", `scorecard.putts` "PUTTS", `scorecard.total` "TOTAL",
`scorecard.gir_pct` "GIR %", `scorecard.hole_dist` " · {{dist}} yds" (the **unit is untranslated and
not localized** — metric markets get yards).

All 7 Chinese collisions are brand or product names (`SmartPlay Caddie`, `Smart Motion`, `SwingLab`,
`Break 100/90/80`) and are correct as-is.

**Conclusion for §2: the resource files are not the problem.** They are small, complete and
consistent. The problem is §3 — how little of the app they cover.

---

## 3. Hardcoded string audit — the drift detector

Two independent scans, one written for this audit and one already in the repo
(`scripts/audit/i18nAudit.ts`), agree on the structural fact:

| Measure | This audit (narrow regex) | `scripts/audit/i18nAudit.ts` (broader heuristic) |
|---|---|---|
| Files scanned (`app/` + `components/`) | 208 | 208 |
| **Files using `t()` / `useTranslation`** | **5** | **5 (2%)** |
| Files with ≥1 hardcoded user-facing string | 166 | 172 |
| Hardcoded user-facing strings | ~1,274 | **~2,091** (jsx 1,288 · props 575 · alerts 228) |

**The five localized files are the entire i18n surface of the app:**

| File | `t()` calls | still hardcoded |
|---|---|---|
| `app/(tabs)/scorecard.tsx` | 45 | 3 |
| `app/(tabs)/play.tsx` | 38 | 21 |
| `app/(tabs)/dashboard.tsx` | 27 | 17 |
| `app/settings.tsx` | 16 | **239** |
| `app/(tabs)/swinglab.tsx` | 10 | 0 |

`app/settings.tsx` is the sharpest illustration: the language picker itself is translated, and the
239 strings around it are not — so a player switches to Spanish **on a screen that stays English**.

### Round-critical path

| Screen | `t()` | hardcoded | Examples |
|---|---|---|---|
| **`app/(tabs)/caddie.tsx`** — the Kevin surface | **0** | 36 | "Start Round", "Which nine", "Trial ended — Subscribe" |
| `app/(tabs)/play.tsx` — round start | 38 | 21 | "Start round", "Courses near you", "Searching…" |
| `app/(tabs)/scorecard.tsx` — scoring | 45 | 3 | "No round in progress", "View Recent Rounds" |
| `app/greeting.tsx` — launch | **0** | 1 | "Skip greeting" |
| `app/recap/[round_id].tsx` | **0** | 25 | "Round Recap", "View hole →", "CAPTURED OFFLINE (no signal)" |
| `app/recap/feelings.tsx` | **0** | 5 | "How'd it feel out there?" |
| `app/tournament.tsx` | **0** | 22 | "Match Play is head-to-head — exactly 2 teams." |
| `app/round/briefing.tsx` | **0** | 1 | "Reading the course..." |
| `components/round/RestModeOverlay.tsx` | **0** | 1 | "Tap anywhere to wake" |
| `components/round/ShotTrackedSheet.tsx` | **0** | 1 | "Confirm tracked shot" |
| `components/recap/HandicapImpactCard.tsx` | **0** | 8 | "Track Your Index", "Not now" |

Of the ~2,091 hardcoded strings, roughly **1,100 are on player-facing screens** and ~174 are on
owner/debug screens (`gps-test`, `owner-logs`, `api-debug`, `*-debug`, `author/*`) that no player
reaches. The owner screens are **not** a defect; they are excluded from the verdict.

**The single most important line in this report:** `app/(tabs)/caddie.tsx`, the screen the product is
named for, contains **zero** `t()` calls.

---

## 4. Voice path audit

> Summary: **the voice path is the half that works.** Speech-in and text-out are genuinely
> trilingual. Every pre-rendered and voice-*rendering* surface is English-only.

### 4a. Speech-to-text — **YES, locale-aware** (with 4 exceptions)

The provider is **Deepgram nova-2**, not Whisper.

- Language is read from the request and mapped to a Deepgram code:
  `api/transcribe.ts:84-86` (`?? 'en'`), `api/transcribe.ts:20`
  (`DG_LANG = { en:'en', es:'es', zh:'zh-CN' }`), `api/transcribe.ts:108-109` (built into the URL).
- It is **not** auto-detect: `language=${dgLang}` is always pinned.
- The client sends it: `services/voiceService.ts:626` (`fd.append('language', language)`), fed from
  `captureUtteranceDetailed(..., language)` at `services/voiceService.ts:428`.
- **The round path passes the user's real setting** — `services/listeningSession.ts:989`
  (`settings.language`), `app/(tabs)/caddie.tsx:2377`, `app/(tabs)/caddie.tsx:4175`,
  `app/tournament.tsx:118`, `app/lie-analysis.tsx:161`, `app/(tabs)/play.tsx:687`,
  `services/intents/coachRefineHandler.ts:127`.

**Four call sites hardcode `'en'`** — all outside the round, none round-critical:

| File:line | Surface |
|---|---|
| `app/swinglab/smartmotion.tsx:1143` | SmartMotion voice note |
| `app/swinglab/smartmotion.tsx:1161` | SmartMotion voice note |
| `services/feelCaptureService.ts:74` | feel capture |
| `app/swing-review/[review_session_id].tsx:234` | swing review note |

A Spanish or Chinese speaker dictating into those four surfaces is transcribed as English.

One quality caveat: `DG_KEYWORDS` (`api/transcribe.ts:23-28`) boosts English golf vocabulary
(`fairway`, `bunker`, `birdie`, `bogey`) and the `SUBSTITUTIONS` table (`api/transcribe.ts:30+`)
corrects English mishearings only. Non-English recognition works but is un-tuned.

### 4b. TTS — **NO. Hardcoded `onyx`, and `language` is silently discarded.**

- `api/voice.ts:85` destructures `language = 'en'` from the body.
- **`language` never appears again in the file.** Verified: `grep -n "language" api/voice.ts`
  returns exactly one line, line 85.
- The OpenAI call (`api/voice.ts:119-125`) passes `model: 'gpt-4o-mini-tts'`, `voice`, `input`,
  `instructions` — no language, no locale.
- **Yes, `onyx` is used for all locales.** `voice` resolves from client override → persona map →
  gender default; `OPENAI_VOICES_BY_PERSONA.kevin = 'onyx'` (`api/voice.ts:34`),
  `OPENAI_VOICES.male = 'onyx'` (`api/voice.ts:21`), `KEVIN_TTS_VOICE = 'onyx'`
  (`api/_kevinVoice.ts:4`). Locale is not an input to that decision.
- `KEVIN_TTS_INSTRUCTIONS` (`api/_kevinVoice.ts:14-19`) is English prose describing English prosody,
  sent verbatim on every request regardless of locale.
- `api/caddie-voice.ts` has **no** `language` handling at all.

**This is a dated regression, not an oversight.** Before `b8159cf5` (2026-06-04, *"remove ElevenLabs
dead path"*), this route selected the voice per-language:
`ELEVEN_VOICES_BY_GENDER[gender + '_' + language]` at `api/voice.ts:116` of that revision. Removing
the dead ElevenLabs branch removed the only consumer of `language`, and nothing replaced it. It has
been dead for **98 days / 2,040 commits**.

Mitigating fact, stated plainly: `gpt-4o-mini-tts` infers pronunciation from the input characters, so
Spanish text is still *spoken in Spanish*. What is lost is the voice/accent selection and the
locale-appropriate delivery — an English-tuned `onyx` reading Spanish and Mandarin.

### 4c. Kevin's LLM system prompt — **YES, explicitly present**

`api/kevin.ts:841-844`:

```
const LANG_ENFORCEMENT: Record<string, string> = {
  es: 'CRITICAL: Respond ONLY in Spanish (español). Every word, every sentence. The user has
       explicitly set Spanish as their language. Do NOT respond in English even if the transcribed
       input looks English — the user is speaking Spanish.',
  zh: 'CRITICAL: Respond ONLY in Chinese (中文). Every word, every sentence. The user has explicitly
       set Chinese as their language. Do NOT respond in English even if the transcribed input looks
       English — the user is speaking Chinese.',
};
```

It is injected **twice** — early at `api/kevin.ts:1298` (`${langRule}`) and again as a closing
reminder at `api/kevin.ts:1652` (`LANGUAGE — FINAL REMINDER: ${langRule}`) — deliberately, per the
comment at `api/kevin.ts:836-840`, so tone instructions in between cannot override it.

`language` reaches the route at `api/kevin.ts:296` and is sent by the single payload builder at
`services/caddieRequestBody.ts:212`. There is also a `TRANSLATION_OVERRIDE` block
(`api/kevin.ts:848-856`) for "tell my partner in Chinese…", which correctly overrides the preference
for one reply.

### 4d. Pre-rendered audio — **ENGLISH ONLY. A non-English user hears English at launch and at every filler moment.**

**80 `.mp3` files ship in `assets/audio/`. Zero have a Spanish or Chinese variant.** The asset tree is
dimensioned by *persona*, never by locale — `find assets -iname "*.mp3" | grep -iE "_es|_zh|/es/|/zh/|spanish|chinese"` returns nothing.

| Directory | Files | Purpose | Locale variants |
|---|---|---|---|
| `assets/audio/greetings/` (+ `serena/`, `harry/`) | 12 + 12 + 12 = 36 | **launch greeting** | **none** |
| `assets/audio/greetings_local/` (`kevin/`, `serena/`, `harry/`) | 5 × 3 = 15 | mic-open greeting | **none** |
| `assets/audio/acks/` (`kevin/`, `serena/`, `harry/`) | 8 × 3 = 24 | quick acknowledgements | **none** |
| `assets/audio/openers/` | 3 | persona openers | **none** |
| `assets/audio/tempo/` | 2 | tempo trainer | **none** |

**Launch greeting — confirmed English for every locale.** `services/kevinGreetingManifest.ts:34-59`
statically `require()`s the 12 Kevin mp3s with no locale dimension. The text they were rendered from
is an English literal — `services/kevinGreeting.ts:46`: `"Welcome back. Let's play some golf."` The
greeting screen reads the language setting and **throws it away**: `app/greeting.tsx:98` is
`const _language = useSettingsStore(s => s.language);` — the underscore marks it deliberately unused,
and `grep -n "_language" app/greeting.tsx` returns that one line and nothing else. The clip is then
played unconditionally at `app/greeting.tsx:443`.

> **A Spanish or Chinese user opens the app and hears Kevin greet them in English.** Every launch.

**Latency-masking filler — confirmed English for every locale.** `constants/fillerPhrases.ts` holds
**58 phrases, English only**, with no `es`/`zh` fields (`grep -n "es:\|zh:\|language"` returns
nothing): `'Let me see...'`, `'Hmm, looking at it now...'`, `'One sec...'`, `'Alright, so...'`.

The filler system *looks* locale-aware and is not. `services/fillerLibrary.ts` caches per language —
`voiceHash()` returns `` `${persona}_${language}_v5` `` (`fillerLibrary.ts:36-47`) — and passes
`language` to the TTS route (`fillerLibrary.ts:214`). But the text it sends is the English
`phrase.text`, and **§4b proved `/api/voice` discards `language`**. The result is a cache slot
labelled `kevin_es_v5` containing 58 clips of English audio.

**Two secondary findings in this area, reported as facts:**

1. The 24 ack mp3s in `assets/audio/acks/` are **unreferenced by the app.**
   `services/quickAckClips.ts` — the manifest that `scripts/render-ack-clips.ts:10,103` instructs the
   author to create — **does not exist**, and no source file `require()`s anything under
   `assets/audio/acks`. Those clips ship in the binary and never play. *This accidentally helps
   i18n*: acknowledgements fall through to live TTS, and the ack text **is** fully trilingual
   (`services/caddieAckLines.ts:29-31,49-50,53-55,59-61` — en/es/zh for all four line groups), so a
   Spanish user does hear Spanish acknowledgements.
2. `services/quickGreetingClips.ts:102-113` (`resolveGreetingClip`) matches by **exact lowercased
   English text** against an English-only pool. Translated text cannot match, so it returns `null`
   and the caller falls through to live TTS. The English-only clip set fails safe here by accident,
   not by design.

### 4e. Local intent pre-classifier — **ENGLISH ONLY, but it fails safe**

`services/localIntentPrecheck.ts` holds **44 regex rules** (`grep -c 'rx:'`). It contains **0
non-ASCII characters** and **0 references to `language`**. Every pattern is English with `\b` word
boundaries — e.g. `services/localIntentPrecheck.ts:135`
`/\b(how\s+far|yardage|yards?\s+to|distance\s+to|how\s+many\s+yards?)\b/i`. `\b` does not even
function as a word boundary for Chinese, which is unspaced.

**This is a performance gap, not a functional break.** On no match the function returns `null`
(`localIntentPrecheck.ts:403-406`) and the caller falls through to the cloud classifier
(`services/voiceCommandRouter.ts:92-98`). That classifier **is** locale-aware: it emits a per-utterance
`language` field constrained to `['en','es','zh']` (`api/voice-intent.ts:92,104`), with explicit
detection instructions (`api/voice-intent.ts:701-705`), and the router threads the detected language
back into context (`services/voiceCommandRouter.ts:251-256`).

Consequence for a Spanish or Chinese speaker: **every** voice command misses the local fast path and
pays the **200-500ms round-trip and ~$0.0005** the precheck exists to avoid
(`localIntentPrecheck.ts:10-11`). Commands still work. They are uniformly slower, on 44 of the
highest-frequency phrases in the app.

---

## 5. Archaeology

| File | Last commit | Date | Subject |
|---|---|---|---|
| `i18n/index.ts` | `c0f4712f` | **2026-05-26** | Batch 35: Fix BC — language propagation (zh resources + multilingual TTS default + honest UI scope) |
| `i18n/locales/en.json` | `ba68c869` | 2026-08-25 | Rename the tank i18n namespace, and guard that no player sees a raw key |
| `i18n/locales/es.json` | `ba68c869` | 2026-08-25 | *(same commit)* |
| `i18n/locales/zh.json` | `ba68c869` | 2026-08-25 | *(same commit)* |

**Every commit that ever touched `i18n/`** — 15 total, and the shape of the story is in the subjects:

```
ba68c869 2026-08-25 Rename the tank i18n namespace, and guard that no player sees a raw key
d85bdaeb 2026-08-12 "How many putts?" — "two" — and the caddie logged an eagle
5fda5e72 2026-07-04 Elite-clean 4/4: low sweep — dead residue gone, persona-aware copy...
86289ee1 2026-06-24 fix: smoke-test blocker + auto-fix queue
70ba99ac 2026-06-24 fix(ui): final cleanups
cbeba40e 2026-06-11 Tempo Trainer (Tour Tempo) — Tank's idea v1
0bc036b7 2026-06-11 SwingLab: remove the misleading + flaky 'turn on active listening' prompt
fe054232 2026-06-11 Translate SwingLab tab (5/5 main tabs) — ES/ZH
48fa9d7d 2026-06-10 i18n: translate Play tab (EN/ES-MX/ZH) — screen 3 of 5
b3f1fb94 2026-06-10 i18n: translate Dashboard tab (EN/ES-MX/ZH) — screen 2 of 5
149738ab 2026-06-10 i18n: translate Scorecard tab (EN/ES/ZH) — screen 1 of 5 main tabs
c0f4712f 2026-05-26 Batch 35: Fix BC — language propagation
fa7cadd6 2026-05-24 feat(meta-glasses v1.2.3)
85259fc7 2026-05-24 feat(meta-glasses)
39310043 2026-05-24 feat(v1.2): EN/ES i18n + Instagram share + branding lock
```

**The most recent commit that added or verified locale support is `fe054232`, 2026-06-11** —
*"Translate SwingLab tab (5/5 main tabs)"*. **1,871 commits have landed since.**

That campaign is the whole explanation for §3. It was scoped to *"5 main tabs"*, it completed that
scope — scorecard, dashboard, play, swinglab, plus settings — and it stopped. **Those are exactly the
5 files that use `t()` today.** Everything built in the 1,871 commits since (the caddie tab, recap,
tournament, custom caddie, SmartMotion, import, family, practice) was written with hardcoded English
and never joined.

`ba68c869` (2026-08-25, **348 commits ago**) is the last touch of any kind, but it added **no
translations** — it renamed the `tank.*` namespace to `golf_advice.*` and added a sim guard that
every key the handler requests resolves in every locale. That guard is real and still passing; it
protects the 178 keys that exist. It cannot see the ~2,091 strings that never became keys.

**The gap was known and written down at the time.** `c0f4712f` (2026-05-26) recorded Tim's report —
*"when the user changes the language setting … all the text in the app as well as the audio goes to
that selected language"* — and its own audit notes said:

> *"UI text: only 5 of ~50+ screens use useTranslation(). Vast majority of in-app strings are
> hardcoded English."*

**That number is still 5 today**, 1,871 commits later. The denominator grew from ~50 to 208.

The same commit claimed *"/api/voice (multilingual TTS routes by language) … work end-to-end."* That
was true when written and was silently falsified 9 days later by `b8159cf5` (§4b).

---

## 6. Verdict

```
BROKEN — es and zh
```

**What fails, for both Spanish and Chinese:**

1. **The interface is not localized.** 5 of 208 screen/component files use `t()` (2%). ~2,091
   hardcoded English strings, ~1,100 of them on player-facing screens. `app/(tabs)/caddie.tsx` — the
   Kevin surface — has **zero**. `app/settings.tsx` has 239 hardcoded strings surrounding the
   language picker itself, so the switch is thrown on a screen that stays English.
2. **The launch greeting is English audio for every locale.** 36 pre-rendered greeting mp3s, no
   locale variants; `app/greeting.tsx:98` reads the language setting into a deliberately-unused
   `_language`.
3. **Every latency-masking filler is English audio for every locale.** 58 English-only phrases in
   `constants/fillerPhrases.ts`, cached under a per-language key that contains English audio.
4. **TTS voice selection ignores locale.** `onyx` for all three languages; `language` is destructured
   and discarded at `api/voice.ts:85`. Regressed 2026-06-04 (`b8159cf5`), dead 98 days / 2,040 commits.
5. **All 44 local intent fast-paths are English-only**, so every non-English voice command pays a
   200-500ms penalty it should not.

**Why the verdict is not `UI-ONLY`:** that string asserts *"interface is localized; Kevin
listens/speaks English only."* Both halves are the inverse of what is true here. Kevin is the part
that works — Deepgram receives a real per-locale language code (§4a), and the brain is hard-instructed
twice per request to answer only in the user's language (§4c), which `gpt-4o-mini-tts` then speaks in
that language because it follows the characters. The **interface** is the part that is
English. Reporting this as `UI-ONLY` would invert the finding.

**Why the verdict is not `FULL`:** 2% of the UI is translated.

### Bearing on the store listing

Advertising Spanish or Chinese support today would be inaccurate. A player who selects Spanish or
Chinese gets a **mostly-English app with a trilingual caddie inside it** — the caddie understands
them and answers in their language, and nearly every label, button, alert, recap and launch sound
around it is English.

The honest claim available **right now** is voice-scoped, e.g. *"Talk to your caddie in English,
Spanish or Chinese"* — which §4a and §4c support and which makes no claim about the interface. A
general "Spanish · Chinese" language claim needs §3 closed first.

**Nothing in this audit was fixed.** Read-only, as scoped.
