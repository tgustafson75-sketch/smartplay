/**
 * Phase 405 wave 3 — "I'm at my ball" shot flow.
 *
 * When the player walks to their ball after a shot, this intent captures
 * the current GPS as the end_location of the last shot on the current
 * hole. That fills in the "shot start → ball location" segment so the
 * yardage of the previous shot reads honestly in recap (otherwise the
 * last shot's end_location stays null until the next shot is logged,
 * and the distance has to be reconstructed from greens centroids — a
 * fallback that's correct but not as precise as actually walking to
 * the ball).
 *
 * Voice phrases:
 *   "I'm at my ball"
 *   "at my ball"
 *   "found my ball"
 *   "I'm at the ball"
 *   "ball position"
 *
 * Gated on an active round. If no shots have been logged on the current
 * hole, responds honestly (no shot to attach the end_location to).
 *
 * Pairs with the existing closeHoleEndLocation mutator in roundStore.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { useRoundStore, type ShotLocation } from '../../store/roundStore';
import { getLastFix as getSmartFinderLastFix } from '../smartFinderService';
import { getLastFix as getGpsLastFix } from '../gpsManager';
import { track } from '../analytics';

function snapshotLocation(): ShotLocation | null {
  const sf = getSmartFinderLastFix();
  if (sf) return sf.location;
  const gps = getGpsLastFix();
  if (gps) return { lat: gps.lat, lng: gps.lng };
  return null;
}

export const atBallHandler: IntentHandler = {
  intent_type: 'at_my_ball',

  parameter_schema: {},

  examples: [
    "I'm at my ball",
    "at my ball",
    "found my ball",
    "I'm at the ball",
    "ball position",
    "got my ball",
  ],

  async execute(): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) {
      return {
        success: false,
        voice_response: "You're not in a round right now.",
        side_effects: ['round:no_active'],
        follow_up_needed: false,
      };
    }

    const loc = snapshotLocation();
    if (!loc) {
      return {
        success: false,
        voice_response: "Can't read GPS right now — tap the Mark button when you're at the ball.",
        side_effects: ['gps:no_fix'],
        follow_up_needed: false,
      };
    }

    const hole = round.currentHole;
    const lastShotOnHole = [...round.shots].reverse().find(s => s.hole === hole);
    if (!lastShotOnHole) {
      // No shot has been logged on this hole yet — there's nothing to
      // attach an end_location to. Honest about it.
      return {
        success: false,
        voice_response: "I don't have a shot logged on this hole yet — log a shot first.",
        side_effects: ['shots:none_on_hole'],
        follow_up_needed: false,
      };
    }
    if (lastShotOnHole.end_location) {
      // Already closed — re-confirm honestly without spamming a duplicate
      // mutation.
      track('at_ball_already_closed', { hole, shot_id: lastShotOnHole.id });
      return {
        success: true,
        voice_response: "Already got that one.",
        side_effects: ['shot:end_location_already_set'],
        follow_up_needed: false,
      };
    }

    round.closeHoleEndLocation(hole, loc);
    track('at_ball_logged', {
      hole,
      shot_id: lastShotOnHole.id,
      lat: loc.lat,
      lng: loc.lng,
    });

    return {
      success: true,
      voice_response: "Got it — ball position locked.",
      side_effects: [`shot:end_location_set:${hole}`],
      follow_up_needed: false,
    };
  },
};
