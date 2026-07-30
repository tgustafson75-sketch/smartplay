// Shared TTS voice settings for all Kevin speech paths.
// Import into any Vercel API route that generates Kevin audio via gpt-4o-mini-tts.

export const KEVIN_TTS_VOICE = 'onyx' as const;

// 2026-07-18 (Tim — "talk a little faster, respond a little faster, get really optimal") —
// pace nudged from "measured" to brisk. A caddie between shots is efficient, not languid.
// 2026-07-30 (Tim — voice_silent_fail 500 "Voice generation failed" started "since we adjusted
// speed"): ROOT CAUSE — the `speed` parameter is NOT supported by gpt-4o-mini-tts (only tts-1 /
// tts-1-hd), so OpenAI rejected every REAL speech.create that passed it → 500 (the warmup calls,
// which never sent speed, kept succeeding — exactly what the boot logs showed). The `speed` param
// is removed everywhere; pace is now carried ENTIRELY by these instructions, which explicitly ask
// for a quick clip so the caddie still feels snappy.
export const KEVIN_TTS_INSTRUCTIONS =
  "Warm and conversational — like a seasoned caddie who genuinely cares — but efficient with the " +
  "listener's time. Speak at a brisk, slightly quick pace — a little faster than a typical " +
  "narrator, snappy but never rushed or clipped. Never preachy or performatively enthusiastic. " +
  "Slight forward lean on key words. When encouraging, sound like you mean it. When delivering " +
  "facts, plain and direct. Never melancholy. Family-appropriate in all contexts.";
