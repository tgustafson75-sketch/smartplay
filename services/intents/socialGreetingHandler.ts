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

// 2026-06-24 (Tim) — warmer, slightly-longer greetings: they answer "how are you?"
// naturally AND cover the brain's behind-the-scenes warm-up (kicked off in the
// greeting fast-path) so the user's real follow-up lands on a hot chain. In-character
// per persona. NOTE: changing this text means the pre-rendered clips no longer match
// (resolveGreetingClip → null → warm live TTS, ~1-2s). To restore instant playback,
// re-run scripts/render-greeting-clips.ts + update GREETING_TEXTS in quickGreetingClips.ts.
const GREETINGS: Record<Persona, string[]> = {
  kevin: [
    "Doing great — fresh and ready. What are we working on today?",
    "All good here. Let's get after it — what's the plan?",
    "I'm right here with you. What do you want to work on?",
    "Feeling good. Talk to me — what's up?",
    "Ready when you are. What are we hitting today?",
  ],
  tank: [
    "Let's go — I'm fired up. What are we working on?",
    "Feeling great, ready to work. What do you got?",
    "All day. Talk to me — what's the mission?",
    "I'm locked in. What are we hitting today?",
    "Let's get after it. What do you need?",
  ],
  serena: [
    "I'm good — calm and ready. What are you thinking about today?",
    "Doing well, thanks. What's on your mind?",
    "Right here with you. What would you like to work on?",
    "Feeling steady. Talk to me — where do we start?",
    "All good. Let's ease in — what are we working on?",
  ],
  harry: [
    "Good, good. What do you need?",
    "All set here. What are we working on?",
    "Right with you. Talk to me — what's up?",
    "Ready. What's the plan?",
    "Doing well. Where do we start?",
  ],
  // Custom caddie greeting pool — neutral / friendly, suitable for
  // any user-chosen identity. The user's own recorded clip overrides
  // this when present (see services/quickAckClips.ts pattern for the
  // recorded-clip resolution path).
  custom: [
    "Doing great — ready to roll. What are we working on?",
    "All good here. What's on your mind?",
    "Right here with you. What do you want to work on?",
    "Feeling good. Talk to me — what's up?",
    "Ready when you are. Where do we start?",
  ],
};

/**
 * Whole-utterance greeting / chit-chat detector. Conservative: a greeting PREFIX
 * followed by a real ask ("hey kevin, what should I hit") must NOT match — only a
 * PURE greeting ("hey kevin", "how are you", "what's up"), so it can short-circuit
 * the brain (instant, no cold pipecat turn). (2026-06-24, Tim — demo speed.)
 */
export function isSocialGreeting(raw: string): boolean {
  let t = String(raw ?? '').toLowerCase().trim().replace(/[?.!,]+$/g, '').replace(/\s+/g, ' ');
  if (!t || t.length > 40) return false;
  t = t.replace(/^(hey|hi|hello|yo|ok|okay|good morning|good afternoon|good evening)\b[\s,]*/g, '');
  t = t.replace(/^(kevin|tank|serena|harry|caddie|caddy)\b[\s,]*/g, '');
  t = t.trim();
  return t === '' || /^(how are you( doing| feeling)?|how are we|how'?s it going|how you doing|how is everything|what'?s up|whats up|sup|wassup|you there|are you there|how'?s things)$/.test(t);
}

export function pickGreeting(persona: Persona, raw: string): string {
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
