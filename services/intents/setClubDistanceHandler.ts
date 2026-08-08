/**
 * 2026-08-08 (Tim — "tell the caddie what's in my bag and my yardages and it gets registered").
 *
 * OFFLINE/deterministic half of bag-by-voice: the crisp declarative form — "my 7-iron goes 165",
 * "my driver carries about 250" — registers instantly with no cloud round-trip, via the SAME seam
 * the brain's register_bag tool uses (services/bagVoiceRegistration). Rich multi-club sentences
 * ("I carry driver, 3-wood, 5 through PW…") ride the brain tool, which can expand ranges.
 *
 * Deliberately NOT matching "I hit my 7-iron 165" — that's a SHOT report (log_shot) in a round.
 * The declarative "goes/carries" phrasing is unambiguous bag fact in any context.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { registerBagFromSpeech } from '../bagVoiceRegistration';
import { track } from '../analytics';

export const setClubDistanceHandler: IntentHandler = {
  intent_type: 'set_club_distance',

  parameter_schema: {
    club_phrase: 'the club named (7 iron / driver / 56 degree)',
    yards: 'the stated distance in yards',
    raw_utterance: 'full original phrase verbatim',
  },

  examples: [
    'my 7-iron goes 165',
    'my driver carries 250',
    'my pitching wedge goes about 120',
    'my 5 wood carries around 210',
  ],

  async execute(intent): Promise<IntentResult> {
    const club = String(intent.parameters.club_phrase ?? '').trim();
    const yards = Number(intent.parameters.yards);
    const result = registerBagFromSpeech({ distances: [{ club, yards, kind: 'carry' }] });
    if (result.distancesSet.length === 0) {
      track('set_club_distance_miss', { phrase: club.slice(0, 40), yards });
      return {
        success: false,
        voice_response: Number.isFinite(yards) && (yards < 30 || yards > 400)
          ? `${yards} yards doesn't sound right for a club — what's the real number?`
          : 'Which club was that?',
        side_effects: ['set_club_distance:miss'],
        follow_up_needed: true,
      };
    }
    track('set_club_distance', { club: result.distancesSet[0].label, yards: result.distancesSet[0].yards });
    return {
      success: true,
      voice_response: result.confirmLine,
      side_effects: [`set_club_distance:${result.distancesSet[0].label}:${result.distancesSet[0].yards}`],
      follow_up_needed: false,
    };
  },
};
