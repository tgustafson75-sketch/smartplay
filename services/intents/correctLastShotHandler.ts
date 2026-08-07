/**
 * 2026-08-07 (Tim — "at any point I can give the Caddie updated info … 'I hit 3 hybrid for that last
 * shot' and shot info, location, brain, history, scorecard etc. is updated").
 *
 * CORRECTS the club (and optionally distance/direction) of the ALREADY-LOGGED previous shot — as
 * opposed to:
 *   • log_shot   — appends a NEW shot ("I hit driver 240 left")
 *   • club_change — sets the CURRENT club for the NEXT shot ("I'm hitting 5-wood off this tee")
 *
 * The scorecard, recap, learned bag (CNS), long-drive and adherence stats all read from
 * roundStore.shots, so an editShot on the target is the single source-of-truth update — every derived
 * surface reflects it on the next read (no separate re-index). Kevin-adherence is recomputed against
 * the shot's stamped recommendation so "did I take his club" stays honest after a correction.
 *
 * Gated on an active round with at least one real (non-synthetic) shot. Ambiguous club → an honest
 * follow-up ("which club was it?") rather than a silent no-op.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { useRoundStore, type ShotResult } from '../../store/roundStore';
import { parseSpokenClub, clubLabel } from '../clubRecognition';
import { normalizeClub } from '../clubNormalize';
import { parseStatedYardage } from './clubHandler';
import { track } from '../analytics';

function noActiveRound(): IntentResult {
  return {
    success: false,
    voice_response: "You're not in a round right now, so there's no shot to correct.",
    side_effects: ['correctLastShot:no_active_round'],
    follow_up_needed: false,
  };
}

// The most recent REAL shot to amend. Excludes synthetic quick-score placeholders
// (ids prefixed `qs-`) and pure score rows, which aren't "shots" the player hit with
// a club. Most-recent by timestamp so it's robust to any out-of-order append.
function lastRealShot(shots: ShotResult[]): ShotResult | null {
  const real = shots.filter(
    s => typeof s.id === 'string' && !s.id.startsWith('qs-'),
  );
  if (real.length === 0) return null;
  return real.reduce((a, b) => (b.timestamp >= a.timestamp ? b : a));
}

export const correctLastShotHandler: IntentHandler = {
  intent_type: 'correct_last_shot',

  parameter_schema: {
    club_phrase: 'verbatim club the shot was actually hit with (driver / 3-hybrid / 7-iron / etc.)',
    distance_yards: 'integer yards if the user is also correcting the distance',
    raw_utterance: 'full original phrase verbatim',
  },

  examples: [
    'I hit 3-hybrid for that last shot',
    'that last one was actually a 5-iron',
    'change my last shot to driver',
    'the last shot was a 7-iron, not a 6',
    'correct my last shot to pitching wedge',
    'actually that was a 4 hybrid',
    'my last shot was a 3 wood',
  ],

  async execute(intent): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) return noActiveRound();

    const target = lastRealShot(round.shots);
    if (!target) {
      return {
        success: false,
        voice_response: "I don't have a shot logged yet to correct — tell me the club and I'll log it.",
        side_effects: ['correctLastShot:no_shot'],
        follow_up_needed: false,
      };
    }

    const params = intent.parameters as {
      club_phrase?: string;
      distance_yards?: number;
      raw_utterance?: string;
    };
    const phrase = String(params.club_phrase ?? intent.raw_text ?? '').trim();
    const parsed = parseSpokenClub(phrase);
    if (!parsed) {
      track('correct_last_shot_ambiguous', { phrase: phrase.slice(0, 60) });
      return {
        success: false,
        voice_response: 'Which club was that last shot?',
        side_effects: ['correctLastShot:ambiguous_club'],
        follow_up_needed: true,
      };
    }

    const newClub = normalizeClub(parsed.club_id) ?? parsed.club_id;

    // Recompute Kevin-adherence against the shot's stamped recommendation so the
    // "did I take his club" record stays truthful after the correction.
    const kevinRecClub = target.kevin_rec_club ?? null;
    const kevinAdhered =
      kevinRecClub != null && parsed.club_id != null
        ? normalizeClub(parsed.club_id) === normalizeClub(kevinRecClub)
        : null;

    // Optional distance correction in the same breath ("... it was a 5-iron from 190").
    // Same 1–500y sanity clamp as logShot so a stray number can't corrupt the shot.
    const statedYds =
      typeof params.distance_yards === 'number' && Number.isFinite(params.distance_yards)
        ? Math.round(params.distance_yards)
        : parseStatedYardage(String(params.raw_utterance ?? intent.raw_text ?? phrase));
    const distancePatch =
      statedYds != null && statedYds >= 1 && statedYds <= 500 ? { distance_yards: statedYds } : {};

    const patch: Partial<ShotResult> = {
      club: newClub,
      kevin_rec_club: kevinRecClub,
      kevin_adhered: kevinAdhered,
      ...distancePatch,
    };
    round.editShot(target.id as string, patch);
    track('shot_corrected_voice', {
      club_id: parsed.club_id,
      hole: target.hole,
      corrected_distance: 'distance_yards' in distancePatch,
    });

    // Visual confirmation to match the voice ack (parity with logShot's toast).
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const t = require('../../store/toastStore') as typeof import('../../store/toastStore');
      const distTag = 'distance_yards' in distancePatch ? ` · ${statedYds}y` : '';
      t.useToastStore.getState().show(`Last shot → ${clubLabel(parsed.club_id)}${distTag}`);
    } catch (e) { console.log('[correctLastShot] toast failed (non-fatal):', e); }

    const distSay = 'distance_yards' in distancePatch ? ` from ${statedYds}` : '';
    return {
      success: true,
      voice_response: `Fixed — your last shot was ${clubLabel(parsed.club_id)}${distSay}.`,
      side_effects: [`correctLastShot:updated:${parsed.club_id}`],
      follow_up_needed: false,
    };
  },
};
