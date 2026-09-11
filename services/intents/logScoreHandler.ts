import type { IntentHandler, IntentResult, VoiceIntent, AppContext } from '../../types/voiceIntent';
import { holePar } from '../smartFinderService';
import { useRoundStore } from '../../store/roundStore';
import { track } from '../analytics';
// 2026-08-10 — score-utterance parsing lives in a PURE module so it is reachable from the logic
// test suite (this file imports roundStore → bundled image assets, which jest can't load).
import { resolveStrokes, parsePutts, mentionsScoreName, scoreLabel } from './scoreParse';

/**
 * 2026-05-19 — Score-by-voice intent. The shot-by-shot logShotHandler
 * captures individual swings ("I hit 7-iron 165 left"); this handler
 * captures the FINAL total for a hole ("I made a five", "I shot a 7
 * on hole 4", "score me 6"). Previously the user could only tap the
 * scorecard or use cockpit steppers — voice score never landed because
 * no intent handler matched.
 *
 * Hole number defaults to roundStore.currentHole; user can override with
 * "on hole N". Strokes must be 1..12 (gates against transcription
 * artifacts like "score me one hundred").
 */

function parseHole(raw: unknown, fallback: number): number {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 && raw <= 18) return raw;
  if (typeof raw === 'string') {
    const m = raw.match(/\b(1[0-8]|[1-9])\b/);
    if (m) return parseInt(m[1], 10);
  }
  return fallback;
}

export const logScoreHandler: IntentHandler = {
  intent_type: 'log_score',

  parameter_schema: {
    strokes: 'integer 1..12, or word ("five", "seven")',
    hole_number: 'optional integer 1..18; defaults to current hole',
  },

  examples: [
    'I made a five',
    'I shot a 7',
    'I had a five',
    'score me a six',
    'put me down for a 4',
    'five on this hole',
    'score me a 5 on hole 7',
    'I bogeyed seven',
  ],

  async execute(intent: VoiceIntent, _context: AppContext): Promise<IntentResult> {
    const round = useRoundStore.getState();
    if (!round.isRoundActive) {
      return {
        success: false,
        voice_response: 'Start a round and I can keep score.',
        side_effects: ['logScore:no_active_round'],
        follow_up_needed: false,
      };
    }
    // 2026-05-21 — Fix P: par lookup MUST happen before strokes parsing
    // now, because the par-relative score-name parser ("par" / "bogey" /
    // "birdie" / "double_bogey" / "triple_bogey" / "eagle") needs the
    // par to resolve to a stroke count. Numeric strokes parsing
    // (parseStrokes) doesn't need par; we just want par available for
    // BOTH branches.
    const params = (intent.parameters ?? {}) as Record<string, unknown>;
    // 2026-08-09 (on-course audit C2) — a bare score (no hole spoken) targets the lowest UNSCORED hole
    // at/behind currentHole, NOT the nav currentHole (which GPS/first-score auto-advance move on their
    // own). An explicit spoken hole still wins.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { voiceScoreHole } = require('../../store/roundStore') as typeof import('../../store/roundStore');
    const hole = parseHole(params.hole_number, voiceScoreHole(round));
    const par = holePar(hole);
    // Numeric parsing first (params.strokes is the classifier's primary
    // emit; raw_text is the verbatim utterance fallback). If neither
    // yields a number, fall through to par-relative score-name parsing
    // for "par" / "bogey" / "birdie" / "double_bogey" / "triple_bogey"
    // / "eagle" — both as the classifier's canonical string strokes
    // value AND as a verbatim hit on the user's utterance.
    // 2026-08-10 — one resolver reads the WHOLE utterance (see services/intents/scoreParse.ts):
    // a NAMED score beats a stray number, and putt counts / distances are stripped before any
    // number hunting. "I got a par with two putts" is a par, not an eagle.
    const strokes = resolveStrokes(params.strokes, intent.raw_text, par);
    if (strokes == null) {
      /**
       * 2026-09-11 — "I GOT A BOGEY" WITH NO PAR IS HOW THE EAGLE HAPPENS.
       *
       * parseScoreName returns null the moment par is unknown, so a NAMED score fell into this
       * generic clarifier and logged nothing. The clarifier then asked "How many strokes?" — which
       * to a player who has just been asked about putts on every other hole sounds exactly like the
       * putt question. He answers "2", there is no open putt question because nothing was logged,
       * and 2 goes in as the STROKE COUNT. On a par 4 that is the eagle, and it is the caddie's own
       * question that set the trap.
       *
       * He told us what he made. Asking him to say it again as a number is the canned thing; the
       * fact we are missing is PAR. So ask for the one we are missing, and never invite a bare
       * number that a stroke parser will happily read as an albatross.
       */
      if (mentionsScoreName(intent.raw_text)) {
        (require('../pendingParAsk') as typeof import('../pendingParAsk')).markAwaitingPar(hole, intent.raw_text);
        return {
          success: false,
          voice_response: `I don't have the par for ${hole === round.currentHole ? 'this hole' : `hole ${hole}`} — what is it?`,
          side_effects: [`logScore:named_score_no_par:hole_${hole}`],
          follow_up_needed: true,
        };
      }
      // Genuine ambiguity — classifier saw a log_score but couldn't
      // pin a number or score name. ONE brief clarifier; the user's
      // next utterance will be parsed fresh. (Tim's Fix P spec: clear
      // score reports like "I got a 4" must NOT trigger this; only
      // genuinely ambiguous "score me" / "log a score" do.)
      return {
        success: false,
        voice_response: "How many strokes? Tell me a number.",
        side_effects: ['logScore:unparsable'],
        follow_up_needed: true,
      };
    }
    // Once-per-hole mental-state advance (mirrors caddie.tsx handleLogHole).
    // round.logScore is ALSO the per-tap edit primitive, so only advance the
    // spiral on a GENUINE hole completion — the FIRST score for this hole.
    // Snapshot whether the hole was already scored (>0) BEFORE logScore
    // overwrites it; skip updateMentalState on a re-log/edit.
    const alreadyScored = (round.scores[hole] ?? 0) > 0;
    round.logScore(hole, strokes);
// 2026-08-11 (adversarial audit) — REMOVED. roundStore.logScore now DERIVES the mental state from
// the scorecard at the single seam every score path funnels through. This call ran immediately
// AFTER logScore and re-accumulated on top of it, so the old per-surface tally won and the derived
// value was discarded — my "forget the last three" fix did nothing on the paths Tim actually uses.
// It also passed `par ?? 4`, which made a par on a par-5 read as a bogey.
    void alreadyScored;
    track('log_score_voice', { hole, strokes, par });
    const label = scoreLabel(strokes, par);
    const holePart = hole === round.currentHole ? `Got it` : `Got it, hole ${hole}`;
    const scoreText = par != null
      ? `${holePart} — ${strokes} (${label}).`
      : `${holePart} — ${strokes}.`;

    // If the classifier already extracted num_putts, log them now and skip the follow-up.
    // 2026-08-10 — also read the putt count out of the UTTERANCE, not just the classifier param.
    // "I got a par with two putts" states both facts; discarding the second and then asking
    // "how many putts?" is what made this exchange feel robotic.
    const inlinePutts = typeof params.num_putts === 'number' && params.num_putts >= 0 && params.num_putts <= 6
      ? params.num_putts
      : parsePutts(intent.raw_text);
    if (inlinePutts !== null) {
      round.logPutts(hole, inlinePutts);
      track('log_putts_voice', { hole, putts: inlinePutts, source: 'inline' });
      return {
        success: true,
        voice_response: scoreText,
        side_effects: [`logScore:hole_${hole}:strokes_${strokes}`, `logPutts:hole_${hole}:putts_${inlinePutts}`],
        follow_up_needed: false,
      };
    }

    /**
     * 2026-08-12 — record that a putt question is OPEN, and for which hole.
     *
     * Without this, the player's "two" reaches the score parser on any path except the auto
     * follow-up loop and is read as a two on the hole — an eagle that overwrites the bogey he just
     * logged correctly. See services/pendingPuttAsk.
     */
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('../pendingPuttAsk') as typeof import('../pendingPuttAsk')).markAwaitingPutts(hole);
    return {
      success: true,
      voice_response: `${scoreText} How many putts?`,
      side_effects: [`logScore:hole_${hole}:strokes_${strokes}`],
      follow_up_needed: true,
    };
  },
};
