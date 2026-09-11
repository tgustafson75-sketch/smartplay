/**
 * 2026-09-10 (Tim: "We have to keep digging. I am tired of half done work.") — THE BAG HAD NO EXIT.
 *
 * A store sweep found `clubBagStore.removeClub` and `clearBag` defined and called by NOTHING, in
 * any file, in any call style. Meanwhile three paths ADD to the bag: the guided camera scan in
 * SmartMotion (twice) and app/bag-scan. So a club could go in and could never come out.
 *
 * That is not tidy-up, it is a live defect with a blast radius. The bag is read by the fit profile,
 * the practice session picker, the dashboard, and — through the learned-bag path — the caddie's club
 * recommendation. Camera recognition is good, not perfect; the one thing a player must be able to do
 * when it puts a 7 wood in the bag they don't own is take it back out. Until now the only remedy was
 * reinstalling the app. [[orphans-are-live-bugs-not-dead-code]] [[two-owners-is-the-root-cause]]
 *
 * WHY VOICE AND NOT A BUTTON. SmartVision and the app layout are under Tim's 2026-07-29 whole-app
 * freeze — a delete control on app/bag-scan is a visual change and needs his per-change OK. Speaking
 * to the caddie needs no new pixels, and it is the interface this app is actually built around.
 * [[hands-free-zero-setup-is-the-product]]
 *
 * Deliberately NOT matching a distance statement ("my 7 iron goes 165" → set_club_distance) or a
 * shot report ("I hit 7 iron" → log_shot). This handler only claims an explicit REMOVAL.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { parseSpokenClub } from '../clubRecognition';
import { useClubBagStore } from '../../store/clubBagStore';
import { track } from '../analytics';

/**
 * Spoken club → canonical ClubId via the one parser that already owns that job
 * (`parseSpokenClub`, which handles "seven iron", "fifty six degree", "three wood"). A second
 * phrase→club table here is exactly the split that produced the 7-wood-called-5-wood defect.
 */
function clubIdFrom(phrase: string): string | null {
  const parsed = parseSpokenClub(phrase);
  if (!parsed || parsed.club_id === 'unknown') return null;
  return parsed.club_id;
}

export const bagRemoveHandler: IntentHandler = {
  intent_type: 'remove_club',

  parameter_schema: {
    club_phrase: 'the club to take out of the bag (7 iron / 3 wood / 56 degree)',
    raw_utterance: 'full original phrase verbatim',
  },

  examples: [
    'take the 7 wood out of my bag',
    'remove the 3 hybrid from my bag',
    "I don't carry a 2 iron",
    'delete the 5 wood from my bag',
    "that's not my club, take it out",
    'get rid of the 60 degree',
  ],

  async execute(intent): Promise<IntentResult> {
    const raw = String(intent.parameters.club_phrase ?? intent.raw_text ?? '').trim();
    const clubId = clubIdFrom(raw);
    if (!clubId) {
      return {
        success: false,
        voice_response: 'Which club should I take out?',
        side_effects: ['remove_club:unparsed'],
        follow_up_needed: true,
      };
    }

    const store = useClubBagStore.getState();
    const present = !!store.clubs[clubId as keyof typeof store.clubs];
    if (!present) {
      /**
       * Honest, not silent. Reporting "removed" for a club that was never there would teach the
       * player the command works when it has done nothing — the same class of lie as the imagery
       * toggle that confirmed a change it never made. [[illustration-data-points]]
       */
      track('remove_club_absent', { club: clubId });
      return {
        success: false,
        voice_response: `There's no ${clubId} in your bag to take out.`,
        side_effects: [`remove_club:absent:${clubId}`],
        follow_up_needed: false,
      };
    }

    store.removeClub(clubId as Parameters<typeof store.removeClub>[0]);
    track('remove_club', { club: clubId });
    return {
      success: true,
      voice_response: `Done — ${clubId} is out of your bag.`,
      side_effects: [`removeClub:${clubId}`],
      follow_up_needed: false,
    };
  },
};
