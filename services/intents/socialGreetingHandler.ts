/**
 * 2026-06-06 — Social greeting handler. Pre-empts the brain for
 * "hey kevin" / "what's up" / "you there" style turns.
 *
 * Before this commit: voiceCommandRouter.dispatch returned
 * { success:false, side_effects:['route_to_brain:social_greeting'] }
 * for every social_greeting. useVoiceCaddie then fired the full
 * /api/kevin call (1-3s, ~$0.005). That's expensive for the most
 * predictable utterance in the app.
 *
 * After: this handler returns a per-persona canned response from a
 * small pool. Same shape any other handler returns, so the router
 * dispatch path is identical. Brain is never called for greetings.
 *
 * Pool size is small (5 per persona) to keep variety from feeling
 * random — Tim's spec was tight character voices. If a persona
 * needs more lines later, append; rotation just picks uniformly.
 *
 * NOTE: Picks WITHOUT Math.random() to keep the choice deterministic
 * for a given transcript+persona within one session (avoids the
 * "asked twice, got the same answer twice in a row" feel — we vary
 * by a transcript-length hash so different greetings rotate).
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useSettingsStore } from '../../store/settingsStore';

type Persona = 'kevin' | 'serena' | 'harry' | 'tank' | 'custom';

const GREETINGS: Record<Persona, string[]> = {
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
  // Custom caddie greeting pool — neutral / friendly, suitable for
  // any user-chosen identity. The user's own recorded clip overrides
  // this when present (see services/quickAckClips.ts pattern for the
  // recorded-clip resolution path).
  custom: [
    "Hey, what's up?",
    "I'm here. What do you need?",
    "Right here with you.",
    "Talk to me.",
    "Go ahead.",
  ],
};

function pickGreeting(persona: Persona, raw: string): string {
  const pool = GREETINGS[persona] ?? GREETINGS.kevin;
  // Hash the transcript so identical greetings produce identical
  // picks (single response per phrasing) but DIFFERENT greetings
  // rotate through the pool. Avoids same-line-twice on common reps
  // like "hey kevin" → "hey kevin".
  let hash = 0;
  for (let i = 0; i < raw.length; i++) hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  const idx = Math.abs(hash) % pool.length;
  return pool[idx];
}

export const socialGreetingHandler: IntentHandler = {
  intent_type: 'social_greeting',

  parameter_schema: {},

  examples: [
    'hey kevin',
    "what's up",
    'you there',
    'hi tank',
    'hey serena',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const persona = (useSettingsStore.getState().caddiePersonality ?? 'kevin') as Persona;
    const raw = String(intent.raw_text ?? '').toLowerCase().trim();
    const reply = pickGreeting(persona, raw);
    return {
      success: true,
      voice_response: reply,
      side_effects: ['social_greeting_local:' + persona],
      follow_up_needed: false,
    };
  },
};
