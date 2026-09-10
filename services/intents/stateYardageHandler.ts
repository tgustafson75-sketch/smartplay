/**
 * 2026-05-25 — Tier 3 of the GPS yardage resolver.
 *
 * Voice intent for user-stated yardage. Tonight's Palms round caught the
 * gap: Tim was using Golfshot as a backup, fed Kevin "I'm 142 from my
 * second shot", and the system had no slot to put that number. Now:
 * the utterance routes here, the number lands in
 * roundStore.userStatedYardage with an `asOf` timestamp + source label,
 * and Kevin acknowledges so the user knows it took.
 *
 * Source inferred from phrasing:
 *   - "Golfshot says 156" → 'golfshot'
 *   - "rangefinder reads 178" / "Bushnell shows 178" → 'rangefinder'
 *   - "I'm 142" / "call it 165" / bare number → 'user'
 *   - anything else → 'other'
 *
 * Lifetime: cleared on next hole advance (in roundStore setCurrentHole),
 * on next shot logged (TODO — wire into logShotHandler in a follow-up),
 * or when the user states a new yardage (latest wins).
 *
 * Number parsing: yards-only, integers 10-400 (covers any realistic
 * shot). Out-of-range numbers reject with an honest clarifier so we
 * don't store a misheard "fifty four" as 54y when the user meant 154.
 */

import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { useRoundStore } from '../../store/roundStore';

type StatedSource = 'user' | 'rangefinder' | 'golfshot' | 'other';

function inferSource(raw: string): StatedSource {
  const t = raw.toLowerCase();
  if (t.includes('golfshot')) return 'golfshot';
  if (t.includes('rangefinder') || t.includes('bushnell') || t.includes('garmin')) return 'rangefinder';
  if (t.includes('arccos') || t.includes('shot scope') || t.includes('shotscope')) return 'other';
  return 'user';
}

function extractYardage(raw: string, paramYards: unknown): number | null {
  // Prefer the classifier-extracted number if present and sane.
  if (typeof paramYards === 'number' && Number.isFinite(paramYards) && paramYards >= 10 && paramYards <= 400) {
    return Math.round(paramYards);
  }
  // Fallback regex on the raw utterance: first integer 10-400.
  const m = raw.match(/\b(\d{2,3})\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (!Number.isFinite(n) || n < 10 || n > 400) return null;
  return n;
}

/**
 * 2026-09-10 — does this utterance carry a number that could only be a YARDAGE?
 *
 * Lives here because this file already owns "what counts as a stated yardage" (extractYardage
 * above); the follow-up path in hooks/useVoiceCaddie needed the question answered and must not grow
 * a second opinion about it. [[two-owners-is-the-root-cause]]
 *
 * Used for ONE decision: whether a reply given while the caddie is awaiting a follow-up should still
 * reach the intent router. It is deliberately not a yardage PARSER — it decides only whether routing
 * is worth doing, and the router's classifier makes the actual call.
 *
 * The floor is 30 rather than extractYardage's 10 because this runs on ANSWERS to the caddie's own
 * questions, where small numbers are common and mean other things: hole numbers (1-18), scores and
 * putts (1-12), club numbers (3-9). Nobody corrects a caddie's distance with "twelve". Above 30 the
 * only thing a bare golf number means is yards, so "no, 165" routes and "twelve" stays a
 * conversational answer — as does "send it home", which carries no number at all and is the
 * utterance the follow-up bypass was written for in the first place.
 */
const MIN_FOLLOWUP_YARDAGE = 30;

export function carriesYardageCorrection(raw: string): boolean {
  const text = String(raw ?? '');
  for (const m of text.matchAll(/\b(\d{2,3})\b/g)) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n >= MIN_FOLLOWUP_YARDAGE && n <= 400) return true;
  }
  return false;
}

export const stateYardageHandler: IntentHandler = {
  intent_type: 'state_yardage',

  parameter_schema: {
    yards: 'number — the yardage the player just stated (10-400)',
    source: 'optional source hint: golfshot / rangefinder / arccos',
  },

  examples: [
    "I'm 142",
    "I'm 142 out",
    "I'm 156 to the pin",
    "Golfshot says 156",
    "Golfshot reads 165",
    "rangefinder reads 178",
    "Bushnell shows 178",
    "Garmin says 190",
    "call it 165",
    "let's call it 145",
    "make it 138",
    "it's 142",
    "I'm at 142",
    "the number is 165",
    "playing 180",
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const raw = String(intent.raw_text ?? '').trim();
    const yards = extractYardage(raw, intent.parameters.yards);

    if (yards == null) {
      return {
        success: false,
        voice_response: "Didn't catch a yardage — try again with the number (like 'I'm 142').",
        side_effects: ['state_yardage:no_number'],
        follow_up_needed: true,
      };
    }

    const round = useRoundStore.getState();
    if (!round.isRoundActive) {
      return {
        success: false,
        voice_response: "No round active — start a round first and I can hold that yardage for the shot.",
        side_effects: ['state_yardage:no_round'],
        follow_up_needed: false,
      };
    }

    const source: StatedSource =
      typeof intent.parameters.source === 'string'
        ? (intent.parameters.source as StatedSource)
        : inferSource(raw);

    round.setUserStatedYardage(yards, source);

    // Build a natural ack that reflects what the user said.
    const sourceLabel =
      source === 'golfshot' ? 'Golfshot' :
      source === 'rangefinder' ? 'the rangefinder' :
      source === 'other' ? 'the app' :
      null;
    const ack = sourceLabel
      ? `Got it — ${yards} from ${sourceLabel}. I'll use that for this shot.`
      : `Got it — ${yards} to center. I'll use that for this shot.`;

    return {
      success: true,
      voice_response: ack,
      side_effects: ['state_yardage:set'],
      follow_up_needed: false,
    };
  },
};
