/**
 * 2026-05-25 — Fix P: position-declaration intent.
 *
 * User speaks where they are ("I'm on the tee" / "I'm on the green" /
 * "I'm by the pin") and the system uses that as a SOFT validation
 * signal for GPS — NOT a hard write (Mark Tee/Mark Green is the
 * deliberate-mark path). Three outcomes based on how close GPS thinks
 * the player is to the declared spot:
 *   - close (≤30y)  → confirm with current yardage; GPS is trustworthy
 *   - medium (30-100y) → confirm but hedge ("got you a bit off the X");
 *                        no auto-action
 *   - far (>100y)   → GPS drift detected → trigger force-refresh and
 *                     tell the user it's settling
 *
 * Different from Mark Tee/Green:
 *   - Position declaration validates GPS against a known anchor
 *   - Mark Tee/Green captures the CURRENT GPS as ground truth (writes
 *     an override)
 * Different from state_yardage:
 *   - state_yardage feeds a NUMBER the caddie should use
 *   - position_declaration confirms WHERE you are physically
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { getLastFix, forceRefreshGps } from '../gpsManager';
import { haversineYards } from '../../utils/geoDistance';
import type { ShotLocation } from '../../store/roundStore';

const CLOSE_YARDS = 30;
const FAR_YARDS = 100;

type DeclaredSpot = 'tee' | 'green';

function inferSpot(raw: string): DeclaredSpot {
  const t = raw.toLowerCase();
  if (/(on|at|by)\s+(the\s+)?(green|pin|flag|hole)/.test(t)) return 'green';
  if (/(on|at|by)\s+(the\s+)?(tee|teebox|tee\s*box)/.test(t)) return 'tee';
  // fallback: any mention of green/pin without "on" — favor green
  if (/\b(green|pin|flag)\b/.test(t)) return 'green';
  return 'tee';
}

export const positionDeclareHandler: IntentHandler = {
  intent_type: 'position_declaration',

  parameter_schema: {
    spot: '"tee" | "green" — which anchor the player is declaring',
  },

  examples: [
    "I'm on the tee",
    "I'm on the tee box",
    "I'm at the tee",
    "I'm on the green",
    "I'm at the pin",
    "I'm by the pin",
    "I'm on the green now",
    "we're on the green",
    "I'm at the flag",
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive || round.activeCourseId == null) {
      return {
        success: false,
        voice_response: "No round active — start a round and I can validate your position against the hole.",
        side_effects: ['position_declare:no_round'],
        follow_up_needed: false,
      };
    }

    const spotParam = String(intent.parameters.spot ?? '').toLowerCase() as DeclaredSpot;
    const spot: DeclaredSpot = spotParam === 'tee' || spotParam === 'green'
      ? spotParam
      : inferSpot(intent.raw_text ?? '');

    const hole = round.currentHole;
    const holeData = round.courseHoles.find(h => h.hole === hole);
    if (!holeData) {
      return {
        success: false,
        voice_response: `I don't have geometry for hole ${hole} — can't validate yet.`,
        side_effects: ['position_declare:no_hole_data'],
        follow_up_needed: false,
      };
    }

    const anchorLat = spot === 'tee' ? holeData.teeLat : holeData.middleLat;
    const anchorLng = spot === 'tee' ? holeData.teeLng : holeData.middleLng;
    if (!anchorLat || !anchorLng) {
      return {
        success: false,
        voice_response: `I don't have a ${spot} coord for hole ${hole}.`,
        side_effects: ['position_declare:no_anchor'],
        follow_up_needed: false,
      };
    }

    const fix = getLastFix();
    if (!fix) {
      return {
        success: true,
        voice_response: `Got it — you're on the ${spot}. No GPS fix yet; refreshing now.`,
        side_effects: ['position_declare:no_fix'],
        follow_up_needed: false,
      };
    }

    const anchor: ShotLocation = { lat: anchorLat, lng: anchorLng };
    const here: ShotLocation = { lat: fix.lat, lng: fix.lng };
    const yardsOff = Math.round(haversineYards(here, anchor));

    if (yardsOff <= CLOSE_YARDS) {
      return {
        success: true,
        voice_response: spot === 'tee'
          ? `Got it — on the tee at hole ${hole}.`
          : `Got it — on the green at hole ${hole}.`,
        side_effects: [`position_declare:close:${spot}:${yardsOff}y`],
        follow_up_needed: false,
      };
    }

    if (yardsOff <= FAR_YARDS) {
      return {
        success: true,
        voice_response: `Got you on the ${spot}, but GPS has you ${yardsOff} yards off. Could be a soft fix — speak up if it feels wrong.`,
        side_effects: [`position_declare:medium:${spot}:${yardsOff}y`],
        follow_up_needed: false,
      };
    }

    // Far — drift detected. Force-refresh and tell the user.
    void forceRefreshGps().catch(() => undefined);
    return {
      success: true,
      voice_response: `GPS has you ${yardsOff} yards off the ${spot} — that's drift. Refreshing now; give me a few seconds.`,
      side_effects: [`position_declare:far:${spot}:${yardsOff}y:refresh`],
      follow_up_needed: false,
    };
  },
};
