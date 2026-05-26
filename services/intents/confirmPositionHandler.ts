/**
 * 2026-05-26 — Voice "confirm or fix my position" intent.
 *
 * User utters a self-locating statement that combines a known anchor
 * (hole pin / green) with a distance:
 *
 *   "I'm 140 out from hole 2 on Palms"
 *   "140 from the pin on hole 5"
 *   "I'm 200 yards out, hole 12"
 *   "Palms hole 2, 140 to the pin"
 *
 * Behavior:
 *   1. Resolve course (param or active round's course)
 *   2. Resolve hole (param or current hole)
 *   3. Get green coord (override > courseHoles geometry)
 *   4. Get tee coord (for bearing direction)
 *   5. Compute "implied GPS" = walk `distance` yards from green back
 *      along the green→tee bearing
 *   6. Compare implied vs actual GPS:
 *        close (≤30y)  → confirm; GPS trustworthy
 *        medium (30-100y) → confirm but note drift
 *        far (>100y)   → flag drift; force GPS refresh and prefer the
 *                        stated position for the next yardage
 *
 * Different from state_yardage:
 *   - state_yardage stores a NUMBER for the next shot ("use 142")
 *   - confirm_position GROUNDS the player's location and reconciles
 *     it against GPS — distance is interpreted geometrically
 *
 * Different from position_declaration:
 *   - position_declaration anchors to a categorical spot (tee/green)
 *   - confirm_position adds a quantitative distance from that anchor
 *
 * NOTE 2026-05-26 — v1 emits the spoken reconciliation but does NOT
 * yet write a "manual position override" to the round store. Adding
 * that field + the smart-yardage consumer wiring is a follow-up
 * batch; for now Tim hears the verbal confirm/fix and the system
 * triggers force-refresh on drift, which is the same correction path
 * positionDeclareHandler uses.
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { getLastFix, forceRefreshGps } from '../gpsManager';
import {
  haversineYards,
  bearingDegrees,
  destinationPoint,
  type ShotLocation,
} from '../../utils/geoDistance';

const CLOSE_YARDS = 30;
const FAR_YARDS = 100;

function extractDistance(raw: string, paramYards: unknown): number | null {
  if (typeof paramYards === 'number' && Number.isFinite(paramYards) && paramYards >= 10 && paramYards <= 600) {
    return Math.round(paramYards);
  }
  // Prefer the LAST 2-3 digit integer in the utterance — the hole
  // number ("hole 2") usually precedes the distance ("140 out").
  const matches = Array.from(raw.matchAll(/\b(\d{2,3})\b/g));
  for (let i = matches.length - 1; i >= 0; i--) {
    const n = parseInt(matches[i][1], 10);
    if (Number.isFinite(n) && n >= 10 && n <= 600) return n;
  }
  return null;
}

function extractHole(raw: string, paramHole: unknown): number | null {
  if (typeof paramHole === 'number' && paramHole >= 1 && paramHole <= 18) return Math.round(paramHole);
  // "hole 2", "hole two", "on 12" — prefer explicit "hole N" first
  const m = raw.match(/\bhole\s+(\d{1,2})\b/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n >= 1 && n <= 18) return n;
  }
  return null;
}

export const confirmPositionHandler: IntentHandler = {
  intent_type: 'confirm_position',

  parameter_schema: {
    distance_to_pin: 'number — yards from the player to the pin (10-600)',
    hole: 'optional hole number 1-18 if the user named one ("hole 2")',
    course_name: 'optional course name fragment if the user named one ("Palms")',
  },

  examples: [
    "I'm 140 out from hole 2 on Palms",
    "140 from the pin on hole 5",
    "I'm 200 out, hole 12",
    "Palms hole 2, 140 to the pin",
    "I'm 180 from the flag on the third",
    "150 to the pin",
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const raw = String(intent.raw_text ?? '').trim();
    const round = useRoundStore.getState();

    if (!round.isRoundActive || round.activeCourseId == null) {
      return {
        success: false,
        voice_response: "No round active — start a round and I can ground that position against the hole.",
        side_effects: ['confirm_position:no_round'],
        follow_up_needed: false,
      };
    }

    const distance = extractDistance(raw, intent.parameters.distance_to_pin);
    if (distance == null) {
      return {
        success: false,
        voice_response: "Didn't catch a distance — try again with the yardage (like 'I'm 140 from the pin').",
        side_effects: ['confirm_position:no_distance'],
        follow_up_needed: true,
      };
    }

    const namedHole = extractHole(raw, intent.parameters.hole);
    const hole = namedHole ?? round.currentHole;
    const holeData = round.courseHoles.find(h => h.hole === hole);
    if (!holeData) {
      return {
        success: false,
        voice_response: `I don't have geometry for hole ${hole} — can't ground that position yet.`,
        side_effects: ['confirm_position:no_hole_data'],
        follow_up_needed: false,
      };
    }

    // Green = middle coord (the pin lives in here for most courses);
    // tee = the back-along-axis anchor for bearing.
    const green: ShotLocation | null =
      holeData.middleLat && holeData.middleLng
        ? { lat: holeData.middleLat, lng: holeData.middleLng }
        : null;
    const tee: ShotLocation | null =
      holeData.teeLat && holeData.teeLng
        ? { lat: holeData.teeLat, lng: holeData.teeLng }
        : null;
    if (!green || !tee) {
      return {
        success: false,
        voice_response: `Hole ${hole} doesn't have both tee and green coords yet — can't compute that.`,
        side_effects: ['confirm_position:missing_coords'],
        follow_up_needed: false,
      };
    }

    // Bearing FROM green TO tee, then walk `distance` yards from green
    // in that direction. The result is the implied GPS position.
    const greenToTeeBearing = bearingDegrees(green, tee);
    const implied = destinationPoint(green, greenToTeeBearing, distance);

    // If the user did NOT name a hole and we used currentHole as the
    // fallback, this is just a soft self-locator; if they named it
    // explicitly, this is the player declaring they switched holes.
    if (namedHole && namedHole !== round.currentHole) {
      round.setCurrentHole(namedHole);
    }

    const fix = getLastFix();
    if (!fix) {
      return {
        success: true,
        voice_response: `Got it — ${distance} from the pin on hole ${hole}. No GPS fix yet; refreshing now.`,
        side_effects: [`confirm_position:no_fix:${distance}y:hole${hole}`],
        follow_up_needed: false,
      };
    }

    const here: ShotLocation = { lat: fix.lat, lng: fix.lng };
    const yardsOff = Math.round(haversineYards(here, implied));

    if (yardsOff <= CLOSE_YARDS) {
      return {
        success: true,
        voice_response: `Confirmed — ${distance} from the pin on hole ${hole}. GPS lines up.`,
        side_effects: [`confirm_position:close:${distance}y:hole${hole}:off${yardsOff}y`],
        follow_up_needed: false,
      };
    }

    if (yardsOff <= FAR_YARDS) {
      return {
        success: true,
        voice_response: `Got you ${distance} out on hole ${hole}, but GPS has you about ${yardsOff} yards off that — using your number for this shot.`,
        side_effects: [`confirm_position:medium:${distance}y:hole${hole}:off${yardsOff}y`],
        follow_up_needed: false,
      };
    }

    // Far — drift detected. Force-refresh and tell the user.
    void forceRefreshGps().catch(() => undefined);
    return {
      success: true,
      voice_response: `GPS is ${yardsOff} yards off from ${distance} on hole ${hole} — that's drift. Refreshing now and using your number for this shot.`,
      side_effects: [`confirm_position:far:${distance}y:hole${hole}:off${yardsOff}y:refresh`],
      follow_up_needed: false,
    };
  },
};
