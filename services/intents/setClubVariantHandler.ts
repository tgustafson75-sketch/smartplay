/**
 * 2026-09-12 (Tim) — DECLARE WHICH OF SEVERAL PHYSICAL CLUBS IS IN THE BAG TODAY.
 *
 * "I have 3 drivers, all different shafts — so if I say I am going to use the TaylorMade X shaft vs
 *  Burner 2 stock shaft, that provides some degree of feedback data."
 *
 * Said in passing, like the ball. The bag models a club SLOT with one set of numbers; a player
 * testing shafts has several physical clubs in that slot whose numbers genuinely differ, which is
 * the whole reason he is testing. Undeclared, they average into one blurred driver and the test can
 * never conclude.
 *
 * DELIBERATELY NOT MATCHING a distance statement ("my 3 wood goes 230" → set_club_distance), a club
 * CHOICE for the shot in hand ("I'll hit the 7 iron" → club_change), or a removal ("take the 7 wood
 * out" → remove_club). This handler only claims a declaration of WHICH model of a club is in play.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { normalizeClub } from '../clubNormalize';
import { useClubVariantStore } from '../../store/clubVariantStore';
import { track } from '../analytics';

/**
 * Variant labels are brand-and-spec nouns with no closed set — shafts, lofts, model years, and
 * whatever he is testing this month. A whitelist would drop exactly the newest one. Clean it up
 * only: strip a leading article and trailing filler, and keep his words.
 */
function cleanVariant(phrase: string): string | null {
  const cleaned = phrase
    .trim()
    .replace(/^(a|an|the|my|with the|using the)\s+/i, '')
    .replace(/\s+(today|this round|out here|in the bag)\b.*$/i, '')
    .replace(/[.,!?]+$/, '')
    .trim();
  if (cleaned.length < 2 || cleaned.length > 60) return null;
  return cleaned;
}

export const setClubVariantHandler: IntentHandler = {
  intent_type: 'set_club_variant',

  parameter_schema: {
    club_phrase: 'the club slot (driver / 3 wood / 7 iron)',
    variant_phrase: 'which model or spec of it (TaylorMade X shaft / Burner 2 stock)',
    raw_utterance: 'full original phrase verbatim',
  },

  examples: [
    "I'm using the TaylorMade X shaft driver today",
    'driver today is the Burner 2 stock shaft',
    'putting the stiff shaft 3 wood in the bag',
    "I've got the old Ping 7 iron in play",
  ],

  async execute(intent): Promise<IntentResult> {
    const clubRaw = String(intent.parameters.club_phrase ?? '').trim();
    const variantRaw = String(intent.parameters.variant_phrase ?? '').trim();
    const club = normalizeClub(clubRaw);
    const variant = cleanVariant(variantRaw);

    if (!club) {
      return {
        success: false,
        voice_response: 'Which club is that?',
        side_effects: ['set_club_variant:unparsed_club'],
        follow_up_needed: true,
      };
    }
    if (!variant) {
      return {
        success: false,
        voice_response: `Which ${club} are you putting in?`,
        side_effects: ['set_club_variant:unparsed_variant'],
        follow_up_needed: true,
      };
    }

    const store = useClubVariantStore.getState();
    const previous = store.variantFor(club);
    store.setVariant(club, variant);
    track('set_club_variant', { club, variant: variant.slice(0, 40), changed: previous !== variant });

    return {
      success: true,
      voice_response: previous && previous !== variant
        ? `Got it — ${variant} ${club} instead of the ${previous}. I'll track it separately.`
        : `Got it — ${variant} ${club}. I'll track it separately.`,
      side_effects: [`set_club_variant:${club}:${variant}`],
      follow_up_needed: false,
    };
  },
};

export default setClubVariantHandler;
