/**
 * PSYCHOLOGY — golf-knowledge module (layer 'psychology').
 *
 * The mental side: INTENTION over avoidance ("define the target + safe miss",
 * never "don't hit it in the water"), detecting fear / over-control /
 * indecision / outcome-fixation, commitment, whiff-recovery reset, and
 * expectation management.
 *
 * HONESTY: there is no biometric/affect SENSOR, so every entry is
 * `coaching_only` (appSignals: ['none']). NOTE for Increment 3: the app DOES
 * keep an in-round emotion log the caddie can REFERENCE (cnsPersonalize:
 * ['emotion_log']) to time these — but the log is a user/inferred note, not a
 * measured emotional state, so it never upgrades the honesty tag.
 */

import type { KBEntry } from '../schema';

const MODULE = 'psychology';

export const PSYCHOLOGY: KBEntry[] = [
  {
    id: 'psych.intention-over-avoidance',
    layer: 'psychology',
    module: MODULE,
    topic: 'intention over avoidance',
    aliases: ['dont hit it in the water', 'i think about the hazard', 'negative thoughts over the ball', 'stop thinking about the trouble', 'positive target'],
    principle:
      'The mind steers toward whatever you picture, so "don’t hit it in the water" plants the water. Replace avoidance with INTENTION: name a specific positive target and an acceptable safe miss, then commit to the target. Define where you’re going, not what you fear.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['pick a target, not a hazard', 'define the safe miss, then forget the trouble', 'go toward, not away'],
    related: ['cm.safe-miss', 'psych.commitment', 'psych.outcome-fixation'],
    source: 'sport-psychology',
  },
  {
    id: 'psych.commitment',
    layer: 'psychology',
    module: MODULE,
    topic: 'commitment',
    aliases: ['commit', 'i dont commit', 'half hearted swing', 'doubt over the ball', 'full commitment'],
    principle:
      'Commitment is decided before the swing, not during it. Choose the shot fully, then give it a free, committed motion — doubt mid-swing causes deceleration and steering. A committed swing on an okay plan beats a tentative swing on a perfect one.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['decide, then go', 'free and full, no steering', 'commitment beats perfection'],
    related: ['cm.commitment', 'psych.over-control', 'putt.routine.short'],
    source: 'sport-psychology',
  },
  {
    id: 'psych.over-control',
    layer: 'psychology',
    module: MODULE,
    topic: 'over-control / steering',
    aliases: ['steering the ball', 'guiding it', 'tense over the ball', 'gripping too tight', 'trying too hard', 'tight swing'],
    principle:
      'Trying to manually control the clubface tightens the body and produces the very miss you’re guarding against. Trust your setup and target, soften the grip pressure, and let the swing release freely — control comes from commitment and rhythm, not muscle.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['soften the grip', 'let it release, don’t steer', 'trust the setup'],
    related: ['psych.commitment', 'fs.finish.balance', 'contact.center-strike-speed'],
    source: 'sport-psychology',
  },
  {
    id: 'psych.indecision',
    layer: 'psychology',
    module: MODULE,
    topic: 'indecision',
    aliases: ['i cant decide', 'between clubs', 'second guessing', 'indecisive', 'not sure what to hit'],
    principle:
      'Indecision over the ball is the enemy of a free swing. When stuck between two options, pick the one with the safer miss, commit, and play it without revisiting — a clear decision matters more than the "right" one. Settle it behind the ball, not over it.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['pick the safer-miss option', 'settle it behind the ball', 'a decision beats the perfect choice'],
    related: ['cm.commitment', 'psych.commitment'],
    source: 'sport-psychology',
  },
  {
    id: 'psych.outcome-fixation',
    layer: 'psychology',
    module: MODULE,
    topic: 'outcome fixation',
    aliases: ['i think about my score', 'pressure of the number', 'protecting my score', 'result anxiety', 'cant stop thinking about the result'],
    principle:
      'Fixating on the score or result hijacks attention from the one shot in front of you and tightens execution. Anchor on the PROCESS — target, picture, commit, swing — and let outcomes accumulate. Play the shot you have, not the number you want.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['process, not score', 'one shot at a time', 'control the controllables'],
    related: ['psych.expectation', 'psych.intention-over-avoidance'],
    source: 'sport-psychology',
  },
  {
    id: 'psych.whiff-recovery',
    layer: 'psychology',
    module: MODULE,
    topic: 'whiff / blow-up recovery reset',
    aliases: ['i just hit a bad shot', 'recover from a blow up', 'reset after a bad hole', 'shake off a bad shot', 'i topped it', 'i whiffed'],
    principle:
      'One bad shot only costs strokes if it spreads. Use a reset: take a breath, accept it as done, re-anchor on a clear target for the NEXT shot, and lower the ambition to a safe, simple recovery. The goal after a mistake is to stop the bleeding, not to make it back in one swing.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['breathe, accept, reset', 'simple safe recovery next', 'don’t chase it back in one shot'],
    related: ['cm.safe-miss', 'psych.expectation'],
    source: 'sport-psychology',
  },
  {
    id: 'psych.expectation',
    layer: 'psychology',
    module: MODULE,
    topic: 'expectation management',
    aliases: ['my expectations', 'i get frustrated', 'realistic expectations', 'pro level expectations', 'managing frustration'],
    principle:
      'Frustration is the gap between expectation and reality. Set expectations to your real game — even tour pros miss greens and make bogeys — so a normal miss doesn’t trigger a spiral. Accept that bad shots are part of the round and play the next one clean.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log', 'tendencies'],
    coachingCues: ['expect misses, they’re normal', 'match expectations to your game', 'no spiral, next shot'],
    related: ['psych.outcome-fixation', 'psych.whiff-recovery'],
    source: 'sport-psychology',
  },
];
