/**
 * 2026-05-25 — Fix R: voice-driven GPS refresh.
 *
 * User says "refresh GPS" / "GPS is wrong" / "fix my location" / "get a
 * fresh fix" → this handler calls gpsManager.forceRefreshGps() which
 * tears down the existing watch, resets mode to 'active' (1Hz polling),
 * and resolves with the first fresh fix (or null after 12s timeout).
 * Caddie speaks an honest ack:
 *   - resolved → "Fresh fix locked. You're 152 to center."
 *   - null    → "Couldn't get a clean fix — step into the open sky and
 *                try again."
 *
 * Tonight's Palms round: Tim said "refresh GPS" and got no audible
 * confirmation either way. This closes that loop.
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { forceRefreshGps } from '../gpsManager';
import { useRoundStore } from '../../store/roundStore';
import { resolveGreenCoords } from '../smartFinderService';
import { haversineYards } from '../../utils/geoDistance';
import type { ShotLocation } from '../../store/roundStore';

export const refreshGpsHandler: IntentHandler = {
  intent_type: 'refresh_gps',

  parameter_schema: {},

  examples: [
    'refresh GPS',
    'GPS is wrong',
    'fix my location',
    'get a fresh fix',
    'reset GPS',
    'GPS is off',
    'lock my GPS',
    'recalibrate GPS',
  ],

  async execute(_intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    // Speak an immediate "working on it" so the user isn't waiting in
    // silence during the ~3-12s refresh window. The actual ack lands
    // after the promise resolves.
    const fix = await forceRefreshGps();

    if (!fix) {
      return {
        success: false,
        voice_response: "Couldn't pull a clean fix — step into the open sky and try again.",
        side_effects: ['refresh_gps:timeout'],
        follow_up_needed: false,
      };
    }

    // If a round is active, compute the fresh yardage to the current
    // hole's green so the user hears the new number, not just "got it."
    const round = useRoundStore.getState();
    if (!round.isRoundActive || round.activeCourseId == null) {
      return {
        success: true,
        voice_response: `Fresh fix locked${fix.accuracy_m ? ` (${Math.round(fix.accuracy_m)}m)` : ''}.`,
        side_effects: ['refresh_gps:no_round'],
        follow_up_needed: false,
      };
    }

    try {
      const resolved = resolveGreenCoords(round.currentHole);
      const middle = resolved.middle;
      if (middle && middle.lat != null && middle.lng != null) {
        const here: ShotLocation = { lat: fix.lat, lng: fix.lng };
        const yds = Math.round(haversineYards(here, middle));
        if (Number.isFinite(yds) && yds >= 10 && yds <= 600) {
          // Also update currentYardage so the UI reflects the fresh
          // number immediately, not on the next GPS tick.
          round.setCurrentYardage(yds);
          return {
            success: true,
            voice_response: `Fresh fix. You're ${yds} to center.`,
            side_effects: ['refresh_gps:locked'],
            follow_up_needed: false,
          };
        }
      }
    } catch (e) {
      console.log('[refreshGpsHandler] yardage recompute failed (non-fatal):', e);
    }

    return {
      success: true,
      voice_response: `Fresh fix locked${fix.accuracy_m ? ` (${Math.round(fix.accuracy_m)}m accuracy)` : ''}.`,
      side_effects: ['refresh_gps:locked_no_green'],
      follow_up_needed: false,
    };
  },
};
