/**
 * Pre-beta — Discrete Mode quick-toggle handlers.
 *
 * Voice intents that move the caddie's presence to Quiet or back to Balanced without making the user
 * open the menu. Useful when the player is on the tee in a quiet group, or when they want Kevin back
 * after the hole settles down.
 *
 * 2026-10-28 (recheck VC-R3-2) — these moved ONLY the trust level. Quiet is five flags
 * (services/caddiePresence PRESENCE_PROFILES), so "Kevin, talk to me" after a Quiet set from the
 * badge, the swap or Settings flipped the layout to caddie-leads and said "Back with you." while
 * localMode and proactive-off kept him silent, and Settings still read Quiet. The badge, the swap,
 * the Tools pill and Settings all go through applyPresence; the voice now does too — one writer.
 * [[two-owners-is-the-root-cause]]
 *
 * Speak time budget ≤ 1.5s — keep responses to one short sentence.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { applyPresence } from '../caddiePresence';

export const setTrustQuietHandler: IntentHandler = {
  intent_type: 'set_trust_quiet',
  parameter_schema: {},
  examples: [
    'Kevin go quiet',
    'Kevin be quiet',
    'Kevin quiet mode',
    'Kevin quiet down',
    'Kevin shush',
    'go silent',
    'quiet please',
  ],
  async execute(): Promise<IntentResult> {
    applyPresence('quiet');
    return {
      success: true,
      voice_response: "Got it. I'll be here when you need me.",
      side_effects: ['trust:set:quiet'],
      follow_up_needed: false,
    };
  },
};

export const setTrustCompanionHandler: IntentHandler = {
  intent_type: 'set_trust_companion',
  parameter_schema: {},
  examples: [
    'Kevin come back',
    'Kevin speak up',
    'Kevin talk to me',
    'Kevin un-quiet',
    'back to normal',
  ],
  async execute(): Promise<IntentResult> {
    applyPresence('balanced');
    return {
      success: true,
      voice_response: 'Back with you.',
      side_effects: ['trust:set:companion'],
      follow_up_needed: false,
    };
  },
};
