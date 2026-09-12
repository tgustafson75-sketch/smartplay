/**
 * 2026-09-12 (Tim) — TELL THE CADDIE WHAT BALL YOU ARE PLAYING, IN PASSING.
 *
 * "I'm gonna tee off here with a Chromesoft, and just ingest that data. Right? Somewhat in the
 *  background, but it does need to be ticked in the fit profile and wherever you see relevant."
 *
 * THE HALF THAT WAS MISSING. `playerProfileStore.currentBall` already existed. It was set in exactly
 * ONE place — typing into a text field on app/ball-fit — and read by cnsBallFitting and nothing
 * else. The caddie never saw it, and no round carried it, so the app could know which ball you play
 * and still be unable to use the fact or compare it to anything.
 * [[sweep-the-missing-half-not-the-unused-export]]
 *
 * This is the spoken half. It writes the same field the ball-fit screen writes — one owner — and
 * the round record stamps it at the end, which is what makes services/ballPerformance able to
 * answer "which ball scores better for me".
 *
 * DELIBERATELY NOT MATCHING a question about balls ("what ball should I play" → the fitting
 * recommendation) or a rules/ball-position remark ("my ball is in the rough" → at_ball / lie). This
 * handler only claims an explicit DECLARATION of the ball in play.
 */

import type { IntentHandler, IntentResult } from '../../types/voiceIntent';
import { usePlayerProfileStore } from '../../store/playerProfileStore';
import { track } from '../analytics';

/**
 * Ball names are brand nouns, not a closed set — new models ship every season and he tests them.
 * A whitelist would silently drop whatever is newest, which is exactly the ball he is testing. So we
 * take what he said and only clean it up: strip a leading article and any trailing filler.
 */
function cleanBallName(phrase: string): string | null {
  const cleaned = phrase
    .trim()
    .replace(/^(a|an|the|my|some)\s+/i, '')
    .replace(/\s+(ball|balls|today|this round|out here)\b.*$/i, '')
    .replace(/[.,!?]+$/, '')
    .trim();
  if (cleaned.length < 2 || cleaned.length > 40) return null;
  return cleaned;
}

export const setBallHandler: IntentHandler = {
  intent_type: 'set_ball',

  parameter_schema: {
    ball_phrase: 'the ball model named (Chrome Soft / Pro V1 / TP5x)',
    raw_utterance: 'full original phrase verbatim',
  },

  examples: [
    "I'm teeing off with a Chromesoft",
    "I'm playing a Pro V1 today",
    'switching to TP5x',
    "I've got a Chrome Soft in play",
    'put me down for a Pro V1x',
    'using the Q-Star this round',
  ],

  async execute(intent): Promise<IntentResult> {
    const raw = String(intent.parameters.ball_phrase ?? intent.raw_text ?? '').trim();
    const ball = cleanBallName(raw);
    if (!ball) {
      return {
        success: false,
        voice_response: 'Which ball are you playing?',
        side_effects: ['set_ball:unparsed'],
        follow_up_needed: true,
      };
    }

    const profile = usePlayerProfileStore.getState();
    const previous = profile.currentBall;
    profile.setCurrentBall(ball);
    track('set_ball', { ball: ball.slice(0, 40), changed: previous !== ball });

    /**
     * Deliberately quiet. Tim asked for this to happen "somewhat in the background" — he is walking
     * onto a tee, not configuring an app. Acknowledge in one clause and get out of the way.
     */
    return {
      success: true,
      voice_response: previous && previous !== ball
        ? `Got it — ${ball} instead of the ${previous}. I'll track how it scores.`
        : `Got it — ${ball}. I'll track how it scores.`,
      side_effects: [`set_ball:${ball}`],
      follow_up_needed: false,
    };
  },
};

export default setBallHandler;
