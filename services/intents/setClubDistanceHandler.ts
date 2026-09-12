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
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * 2026-09-12 (Tim) — CARRY AND TOTAL ARE DIFFERENT NUMBERS AND THIS STAMPED BOTH AS CARRY.
 *
 * "We need to make sure user sets total and carry distances during profile setup, then it will
 *  dynamically update over rounds adjusting obviously truthfully by total, then we extrapolate as
 *  honestly as possible average carry — that really makes a huge difference in overall strategy."
 *
 * The model he is describing already exists and is good: clubStatsStore keeps TWO ladders with a
 * roll model between them, GPS shot tracking writes the TOTAL ladder (tee→rest is what GPS can
 * actually see), and carry falls back to tracked total minus typical roll. registerBagFromSpeech
 * has taken `kind: 'carry' | 'total'` the whole time.
 *
 * This handler passed `kind: 'carry'` unconditionally. So "my 3 wood goes 230" — where 230 is plainly
 * the number he watches the ball stop at — was recorded as 230 of CARRY, overstating it by the roll.
 * That errs in the one direction that costs a ball: the caddie thinks he flies a hazard he does not.
 *
 * THE VERB DECIDES, because it already means something:
 *   "carries" / "carry is" / "flies"  → CARRY. All three describe the flight.
 *   "goes"                            → TOTAL. Where it ended up, which is what a golfer watches.
 * And when he states both in one breath — "goes 230, carries 215" — both ladders get their own
 * number and nothing is inferred at all, which is the best case.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { registerBagFromSpeech } from '../bagVoiceRegistration';
import { track } from '../analytics';

export const setClubDistanceHandler: IntentHandler = {
  intent_type: 'set_club_distance',

  parameter_schema: {
    club_phrase: 'the club named (7 iron / driver / 56 degree)',
    yards: 'the stated distance in yards',
    distance_kind: "'carry' if they said carries/flies, 'total' if they said goes",
    carry_yards: 'the carry number, when they stated carry AND total in one sentence',
    total_yards: 'the total number, when they stated carry AND total in one sentence',
    raw_utterance: 'full original phrase verbatim',
  },

  examples: [
    'my 7-iron goes 165',
    'my driver carries 250',
    'my pitching wedge goes about 120',
    'my 5 wood carries around 210',
    'my 3 wood goes 230 and carries 215',
  ],

  async execute(intent): Promise<IntentResult> {
    const club = String(intent.parameters.club_phrase ?? '').trim();
    const num = (v: unknown): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    /**
     * Both numbers when he gave both; otherwise the one he gave, filed under the verb he used.
     * Defaulting to 'total' for an unstated kind is deliberate and is the SAFE direction: reading a
     * total as carry tells the caddie he flies a hazard he does not, and that loses a ball. Reading
     * a carry as total costs a few yards of club, which costs nothing.
     */
    const carry = num(intent.parameters.carry_yards);
    const total = num(intent.parameters.total_yards);
    const single = num(intent.parameters.yards);
    const singleKind: 'carry' | 'total' = intent.parameters.distance_kind === 'carry' ? 'carry' : 'total';

    const distances: { club: string; yards: number; kind: 'carry' | 'total' }[] = [];
    if (carry != null) distances.push({ club, yards: carry, kind: 'carry' });
    if (total != null) distances.push({ club, yards: total, kind: 'total' });
    if (distances.length === 0 && single != null) distances.push({ club, yards: single, kind: singleKind });

    const yards = distances[0]?.yards ?? Number(intent.parameters.yards);
    const result = registerBagFromSpeech({ distances });
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
