// Shared TTS voice settings for all Kevin speech paths.
// Import into any Vercel API route that generates Kevin audio via gpt-4o-mini-tts.

export const KEVIN_TTS_VOICE = 'onyx' as const;

// 2026-07-18 (Tim — "talk a little faster, respond a little faster, get really optimal") —
// pace nudged from "measured" to brisk. A caddie between shots is efficient, not languid; the
// paired `speed` bump on the API call adds a touch more without clipping words.
export const KEVIN_TTS_INSTRUCTIONS =
  "Warm and conversational — like a seasoned caddie who genuinely cares — but efficient with the " +
  "listener's time. Brisk, natural pace; don't drag. Never preachy or performatively enthusiastic. " +
  "Slight forward lean on key words. When encouraging, sound like you mean it. When delivering " +
  "facts, plain and direct. Never melancholy. Family-appropriate in all contexts.";

// Playback speed multiplier for gpt-4o-mini-tts (1.0 = natural). A modest bump so the caddie feels
// snappy without sounding rushed or chipmunky. Applied on every speech.create call.
export const KEVIN_TTS_SPEED = 1.08;
