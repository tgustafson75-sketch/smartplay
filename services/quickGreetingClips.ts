/**
 * 2026-06-06 — Pre-rendered persona greeting clips manifest.
 *
 * Mirror of services/quickAckClips.ts pattern, but for the
 * socialGreetingHandler pool. When a user says "hey kevin" /
 * "what's up" / etc., the handler picks a canned line from
 * services/intents/socialGreetingHandler.ts GREETINGS pool and
 * speak()s it. With clips bundled, playLocalFile fires the
 * pre-rendered MP3 directly — same savings as ack clips
 * (~$0.001 + 400ms per greeting).
 *
 * The handler picks by hashing the transcript (deterministic per
 * phrasing). resolveGreetingClip below takes the SAME picked text
 * and returns the bundled asset module id if available, null
 * otherwise. Caller (useVoiceCaddie speak path) falls back to
 * runtime TTS via speak() when null.
 *
 * Custom persona deliberately has no greeting clips — the user's
 * own recorded clips (customCaddieClips) carry their greetings.
 */

type Persona = 'kevin' | 'serena' | 'harry' | 'tank' | 'custom';

// Slug → text. Slugs must match scripts/render-greeting-clips.ts.
// Keep ALL entries from each persona's pool in services/intents/
// socialGreetingHandler.ts GREETINGS in sync — the lookup matches
// on lowercased trimmed text.
export const GREETING_TEXTS: Record<string, string[]> = {
  kevin: [
    "Hey, what do you need?",
    "Right here. What's up?",
    "I'm with you. What are we working on?",
    "Talk to me.",
    "Go ahead.",
  ],
  tank: [
    "Yeah, what do you got?",
    "Talk to me.",
    "Go ahead, I'm listening.",
    "What do you need?",
    "Here. What's up?",
  ],
  serena: [
    "I'm here. What are you thinking?",
    "Go ahead.",
    "Talk to me.",
    "What's on your mind?",
    "Right here with you.",
  ],
  harry: [
    "Go.",
    "Here.",
    "What do you need?",
    "Talk to me.",
    "Go ahead.",
  ],
};

// Per-persona × per-slug clip manifest. Slugs are 0-indexed positions
// in each pool (greeting_0, greeting_1, ...). Same null-or-asset-id
// pattern as quickAckClips.
type ClipMap = Record<string, number | null>;
const EMPTY: ClipMap = {
  greeting_0: null,
  greeting_1: null,
  greeting_2: null,
  greeting_3: null,
  greeting_4: null,
};
const CLIPS: Record<Persona, ClipMap> = {
  kevin: {
    greeting_0: require('../assets/audio/greetings_local/kevin/greeting_0.mp3'),
    greeting_1: require('../assets/audio/greetings_local/kevin/greeting_1.mp3'),
    greeting_2: require('../assets/audio/greetings_local/kevin/greeting_2.mp3'),
    greeting_3: require('../assets/audio/greetings_local/kevin/greeting_3.mp3'),
    greeting_4: require('../assets/audio/greetings_local/kevin/greeting_4.mp3'),
  },
  serena: {
    greeting_0: require('../assets/audio/greetings_local/serena/greeting_0.mp3'),
    greeting_1: require('../assets/audio/greetings_local/serena/greeting_1.mp3'),
    greeting_2: require('../assets/audio/greetings_local/serena/greeting_2.mp3'),
    greeting_3: require('../assets/audio/greetings_local/serena/greeting_3.mp3'),
    greeting_4: require('../assets/audio/greetings_local/serena/greeting_4.mp3'),
  },
  harry: {
    greeting_0: require('../assets/audio/greetings_local/harry/greeting_0.mp3'),
    greeting_1: require('../assets/audio/greetings_local/harry/greeting_1.mp3'),
    greeting_2: require('../assets/audio/greetings_local/harry/greeting_2.mp3'),
    greeting_3: require('../assets/audio/greetings_local/harry/greeting_3.mp3'),
    greeting_4: require('../assets/audio/greetings_local/harry/greeting_4.mp3'),
  },
  tank: {
    greeting_0: require('../assets/audio/greetings_local/tank/greeting_0.mp3'),
    greeting_1: require('../assets/audio/greetings_local/tank/greeting_1.mp3'),
    greeting_2: require('../assets/audio/greetings_local/tank/greeting_2.mp3'),
    greeting_3: require('../assets/audio/greetings_local/tank/greeting_3.mp3'),
    greeting_4: require('../assets/audio/greetings_local/tank/greeting_4.mp3'),
  },
  // Custom persona: no server-rendered greetings. The user's own
  // recorded voice clips (customCaddieClips) carry their greetings
  // via the existing custom-caddie playback path.
  custom: { ...EMPTY },
};

/**
 * Resolve a pre-rendered greeting clip for the given text + persona.
 * Matches by exact text (lowercased trimmed) against the pool for that
 * persona; falls back to null when no match. Caller plays via
 * playLocalFile if not null, else speak() runs the runtime TTS path.
 */
export function resolveGreetingClip(text: string | null | undefined, persona: string): number | null {
  if (!text) return null;
  const personaKey = (persona as Persona);
  const pool = GREETING_TEXTS[personaKey] ?? GREETING_TEXTS.kevin;
  const idx = pool.findIndex(g => g.toLowerCase().trim() === String(text).toLowerCase().trim());
  if (idx < 0) return null;
  const slug = `greeting_${idx}`;
  const personaMap = CLIPS[personaKey] ?? CLIPS.kevin;
  return personaMap[slug] ?? null;
}
