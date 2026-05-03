# scripts/

One-shot CLI utilities for the repo. Not part of the runtime app.

## `generate-kevin-greetings.mjs`

Renders the 12 Kevin launch greeting MP3s used by `app/greeting.tsx`
through OpenAI's `gpt-4o-mini-tts` API with the canonical Kevin voice
(`onyx`) and the shared `KEVIN_TTS_INSTRUCTIONS` (mirrored from
[api/_kevinVoice.ts](../api/_kevinVoice.ts)). Output lands in
`assets/audio/greetings/` and the resulting `.mp3` files are committed
to the repo — they ship inside the app bundle.

```bash
npm run generate:greetings
```

Reads `OPENAI_API_KEY` from `.env` (or any pre-set environment variable
of the same name). Sequential calls with a 200 ms delay between each,
single retry on failure, sanity bounds 5 KB ≤ size ≤ 500 KB per file.

**When to re-run:** only when the canonical line strings change OR when
the Kevin voice config in `api/_kevinVoice.ts` changes. Re-running
overwrites the existing MP3s in place — the next commit captures the
new audio.

## `reset-project.js`

Pre-existing project-template reset. Not part of any current workflow.
