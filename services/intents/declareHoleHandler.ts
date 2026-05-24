/**
 * 2026-05-24 — Declared-position cross-check (Flow C, GPS verify).
 *
 * "I'm teeing off on hole 4" / "starting hole 7" / "on hole 3 now" →
 *   1. Parse the hole number from the utterance / classifier params
 *   2. Set currentHole context (Tim's downstream yardage + scorecard
 *      now reference this hole)
 *   3. resolveTeeCoords(N) for the expected tee position
 *   4. getOneShotFix() for the current GPS
 *   5. haversineYards(tee, fix) = delta
 *   6. delta <= ~22 yards (the ~20m threshold per the integration map;
 *      tee boxes are wide, so the band is more forgiving than greens):
 *      → brief confirm only, no Mark
 *   7. delta > ~22 yards:
 *      → silent Mark via setTeeOverride(courseId, N, fix.lat/lng)
 *      → push to undoMarkStore so the UndoMarkBanner can offer revert
 *      → voice line: "where you told me and my GPS don't line up —
 *        Marked you at N's tee, tap undo if that's off"
 *
 * The Mark is SILENT (no UI prompt before the write) per the
 * locked decision in GPS-VERIFY-DISCOVERY.md Flow C — a routed
 * screen would yank the user out of their round; the spoken-undo
 * affordance via the banner is the in-flow correction path.
 *
 * Honest degradation paths:
 *   - No tee coords for N → set context, skip cross-check
 *   - No GPS fix          → set context, skip cross-check
 *   - No active course id → set context, skip cross-check (no key
 *     to mark against)
 *   - Mark write throws   → set context, log, skip the undo push
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';
import { resolveTeeCoords } from '../smartFinderService';
import { getOneShotFix } from '../gpsManager';
import { haversineYards } from '../../utils/geoDistance';
import { setTeeOverride, getTeeOverride } from '../courseTeeOverrides';
import { useUndoMarkStore } from '../../store/undoMarkStore';

/** Tee-box divergence threshold in yards. ~20m ≈ 22 yards.
 *  Tee boxes are physically wider than greens; the threshold here is
 *  intentionally more forgiving than what a green Mark would use. */
const TEE_DIVERGENCE_THRESHOLD_YARDS = 22;

function parseHole(raw: unknown, fallback: unknown): number | null {
  // Param path (classifier-emitted).
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 18) return raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\b(1[0-8]|[1-9])\b/);
    if (m) return parseInt(m[1], 10);
  }
  // Verbatim utterance fallback — catches "I'm on hole 4" / "teeing off 7".
  if (typeof fallback === 'string') {
    const m = fallback.match(/\bhole\s+(\d{1,2})\b/i) ?? fallback.match(/\b(?:teeing|tee|starting|on)\s+(?:off\s+)?(?:hole\s+)?(\d{1,2})\b/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 18) return n;
    }
  }
  return null;
}

export const declareHoleHandler: IntentHandler = {
  intent_type: 'declare_hole',

  parameter_schema: {
    hole_number: 'integer 1..18 — the hole the player is declaring',
  },

  examples: [
    "I'm teeing off on hole 4",
    "I'm on hole 7",
    "starting hole 3",
    "on hole 5 now",
    "teeing off 12",
    "hole 9",
    "I'm on hole 4",
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const params = (intent.parameters ?? {}) as Record<string, unknown>;
    const hole = parseHole(params.hole_number, intent.raw_text);
    if (hole == null) {
      return {
        success: false,
        voice_response: "Which hole? Tell me a number.",
        side_effects: ['declare_hole:unparsable'],
        follow_up_needed: true,
      };
    }

    const round = useRoundStore.getState();
    // Set the hole context regardless of cross-check outcome — the
    // declaration itself is the truth the rest of the pipeline (Flow
    // A yardage, scorecard, ghost match) should respect.
    if (round.isRoundActive && round.currentHole !== hole) {
      round.setCurrentHole(hole);
    }

    const courseId = round.activeCourseId ?? null;
    if (!courseId) {
      return {
        success: true,
        voice_response: `Got you on hole ${hole}.`,
        side_effects: ['declare_hole:no_course'],
        follow_up_needed: false,
      };
    }

    // Cross-check: expected tee vs current GPS.
    const teeResolved = resolveTeeCoords(hole);
    if (!teeResolved.tee) {
      return {
        success: true,
        voice_response: `Got you on ${hole} — no tee data for that hole, but you're on it.`,
        side_effects: ['declare_hole:no_tee_data'],
        follow_up_needed: false,
      };
    }

    const fix = await getOneShotFix({ maxAgeMs: 5_000 });
    if (!fix) {
      return {
        success: true,
        voice_response: `Got you on ${hole} — can't read GPS to cross-check right now.`,
        side_effects: ['declare_hole:no_gps'],
        follow_up_needed: false,
      };
    }

    const delta = Math.round(haversineYards({ lat: fix.lat, lng: fix.lng }, teeResolved.tee));

    if (delta <= TEE_DIVERGENCE_THRESHOLD_YARDS) {
      // Lined up — declared position agrees with GPS. Brief confirm.
      return {
        success: true,
        voice_response: `Got you on hole ${hole}.`,
        side_effects: [
          'declare_hole:confirmed',
          `delta_yards:${delta}`,
          `tee_source:${teeResolved.source}`,
        ],
        follow_up_needed: false,
      };
    }

    // Divergence > threshold — silent Mark. Snapshot the previous
    // override BEFORE writing so the undo path can restore it
    // precisely (whether or not one existed).
    const prevOverride = getTeeOverride(courseId, hole);
    try {
      await setTeeOverride(courseId, hole, { lat: fix.lat, lng: fix.lng });
    } catch (e) {
      console.log('[declareHole] setTeeOverride failed (non-fatal):', e);
      return {
        success: true,
        voice_response: `Got you on ${hole}. Couldn't save the Mark — GPS will keep using the original tee data.`,
        side_effects: ['declare_hole:mark_failed', `delta_yards:${delta}`],
        follow_up_needed: false,
      };
    }

    // Push the undo affordance into the banner store. 30-second
    // visibility window; older entries are filtered at read-time.
    useUndoMarkStore.getState().setMark({
      markedAt: Date.now(),
      courseId,
      hole,
      prevOverride: prevOverride ?? null,
      accuracy_m: fix.accuracy_m,
      delta_yards: delta,
    });

    return {
      success: true,
      voice_response:
        `Where you told me and my GPS don't line up — I'm off by about ${delta} yards. ` +
        `Marked you at hole ${hole}'s tee — tap undo if that's off.`,
      side_effects: [
        'declare_hole:divergent_silent_mark',
        `delta_yards:${delta}`,
        `accuracy_m:${fix.accuracy_m != null ? Math.round(fix.accuracy_m) : 'unknown'}`,
        `tee_source:${teeResolved.source}`,
      ],
      follow_up_needed: false,
    };
  },
};
