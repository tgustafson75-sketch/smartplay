/**
 * MENTAL GAME — golf-knowledge module (layer 'psychology').
 *
 * EXTENDS psychology.ts (which owns the `psych.*` ids: intention, commitment,
 * over-control, indecision, outcome-fixation, whiff-recovery, expectation).
 * This module adds the everyday tools a nervous/streaky amateur reaches for:
 * the pre-shot routine, breathing/arousal control, first-tee nerves, the
 * bounce-back after a bad hole, staying present, process self-talk, a go-to
 * shot, managing expectations, playing your own game, finishing strong, and
 * keeping the round fun + momentum-driven (the time-constrained golfer plays
 * for the RUSH, not the report card).
 *
 * IDs are namespaced `mind.*` so they never collide with psychology.ts.
 *
 * HONESTY: there is no affect/biometric SENSOR, so every entry is
 * `coaching_only` (appSignals: ['none']). The app DOES keep an in-round emotion
 * log the caddie can REFERENCE to TIME these cues (cnsPersonalize:
 * ['emotion_log']) — but that log is a user/inferred note, not a measured
 * emotional state, so it never upgrades the honesty tag.
 *
 * Drawn from established sport psychology (Rotella's "play to the target /
 * stay in the present", VISION54's Think Box / Play Box decision line,
 * pre-shot-routine + breathing + self-talk research). Synthesized, not verbatim.
 */

import type { KBEntry } from '../schema';

const MODULE = 'mental_game';

export const MENTAL_GAME: KBEntry[] = [
  {
    id: 'mind.pre-shot-routine',
    layer: 'psychology',
    module: MODULE,
    topic: 'the pre-shot routine',
    aliases: ['pre shot routine', 'i hit better on the range than the course', 'how do i stay consistent under pressure', 'whats a good routine', 'i rush my shots', 'same routine every time'],
    principle:
      'A repeatable pre-shot routine is the single biggest stabilizer under pressure — it gives the swing the same runway every time, whether it is the first tee or the 18th. Think behind the ball (pick target, picture the shot, choose the club), then step in and just react. Same steps, same tempo, every shot.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['decide behind the ball, react in front of it', 'same steps and tempo every time', 'the routine is your anchor when nerves spike'],
    related: ['mind.think-play-box', 'mind.process-self-talk', 'psych.commitment'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.think-play-box',
    layer: 'psychology',
    module: MODULE,
    topic: 'think box / play box (decision line)',
    aliases: ['stop thinking over the ball', 'too many swing thoughts', 'i overthink the shot', 'how do i clear my mind', 'analysis paralysis', 'quiet mind over the ball'],
    principle:
      'Do your thinking BEHIND the ball — read the shot, pick the club, commit — then cross an imaginary line into the shot with a quiet, reacting mind. Once you step in, the planning is done; just see the target and go. A few seconds in that "play" state is plenty; lingering lets doubt creep back.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['think behind the line, play in front of it', 'step in, see the target, go', 'a few seconds over the ball — no longer'],
    related: ['mind.pre-shot-routine', 'psych.commitment', 'psych.over-control'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.breathing-arousal',
    layer: 'psychology',
    module: MODULE,
    topic: 'breathing + arousal control',
    aliases: ['i get tense before a shot', 'how do i calm down on the course', 'my heart is racing', 'breathing technique golf', 'too amped up', 'slow my heart rate'],
    principle:
      'A slow breath is the fastest way to drop tension and steady the hands. Before the shot, take one calm breath — in through the nose, longer out through the mouth — and let the shoulders soften on the exhale. It resets a racing system so the swing flows instead of grabs.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['one slow breath, long exhale', 'soften the shoulders and grip on the way out', 'breathe before you step in, not over the ball'],
    related: ['mind.first-tee-nerves', 'psych.over-control', 'mind.pre-shot-routine'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.first-tee-nerves',
    layer: 'psychology',
    module: MODULE,
    topic: 'first-tee nerves',
    aliases: ['im so nervous on the first tee', 'first tee jitters', 'people are watching me tee off', 'i tighten up on the first hole', 'opening tee shot nerves'],
    principle:
      'First-tee nerves are normal — even pros feel them — and they are energy, not a warning. Accept the buzz instead of fighting it, take a breath, trust your routine, and pick a smaller target than usual. Aim for a committed, in-play tee shot, not a perfect one; the nerves fade once you are moving.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['nerves are fuel, not a warning', 'breathe, trust the routine, small target', 'just put it in play — perfect is not the goal'],
    related: ['mind.breathing-arousal', 'mind.go-to-shot', 'psych.expectation'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.next-shot-reset',
    layer: 'psychology',
    module: MODULE,
    topic: 'next-shot reset (bounce back from a bad hole)',
    aliases: ['i fell apart after a bad hole', 'cant let go of a bad shot', 'one bad hole ruined my round', 'how do i bounce back', 'i spiral after a double bogey', 'shake off a blow up hole'],
    principle:
      'A bad hole only becomes a bad round if you carry it to the next tee. Build a short reset: take a breath, accept the number, and consciously hand the bad hole to the past as you walk off the green. The next shot does not know what the last one did — start it clean.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['a bad hole stays one hole if you let it go', 'breathe, accept the number, walk it off', 'the next shot has no memory — start fresh'],
    related: ['psych.whiff-recovery', 'mind.one-shot-at-a-time', 'mind.finish-strong'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.one-shot-at-a-time',
    layer: 'psychology',
    module: MODULE,
    topic: 'staying present (one shot at a time)',
    aliases: ['stay in the moment', 'i get ahead of myself', 'thinking about my final score', 'one shot at a time', 'stop counting strokes mid round', 'staying present'],
    principle:
      'The only shot you can control is the one in front of you. Drop the math and the what-ifs and give full attention to THIS target — past holes are done, the scorecard can wait. Playing one shot at a time keeps the swing free and quietly takes care of the score.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['only this shot, this target', 'the scorecard can wait until 18', 'play the shot, not the total'],
    related: ['psych.outcome-fixation', 'mind.next-shot-reset', 'mind.process-self-talk'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.process-self-talk',
    layer: 'psychology',
    module: MODULE,
    topic: 'self-talk (process, not outcome)',
    aliases: ['negative self talk', 'i talk myself out of shots', 'how do i talk to myself', 'i get down on myself', 'positive self talk golf', 'stop beating myself up'],
    principle:
      'How you talk to yourself sets the tone for the next swing. Trade outcome blame ("don\'t hit it OB again") for a simple process cue ("smooth tempo to that target"), and speak to yourself like you would a playing partner you want to do well. Kind, process-focused talk steadies a streaky round.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['swap blame for a process cue', 'talk to yourself like a partner you\'re rooting for', 'one clear thought: tempo and target'],
    related: ['psych.intention-over-avoidance', 'mind.pre-shot-routine', 'mind.one-shot-at-a-time'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.go-to-shot',
    layer: 'psychology',
    module: MODULE,
    topic: 'confidence from a go-to shot',
    aliases: ['i need a reliable shot under pressure', 'whats my go to shot', 'a shot i can trust', 'safe shot when nervous', 'fall back shot', 'my bread and butter shot'],
    principle:
      'Under pressure, lean on the one shot you trust most — a stock club and stock shape you can repeat without thinking. It does not have to be your longest or prettiest; it has to be RELIABLE. Having a go-to takes the guesswork out of a tense moment and gives the nerves something solid to grab.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log', 'bag', 'tendencies'],
    coachingCues: ['pick the shot you trust, not the longest', 'reliable beats pretty when it matters', 'know your go-to before you need it'],
    related: ['mind.first-tee-nerves', 'cm.safe-miss', 'psych.commitment'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.expectations-not-the-score',
    layer: 'psychology',
    module: MODULE,
    topic: 'the score doesn\'t define the round',
    aliases: ['i had a bad round', 'my score was terrible', 'i judge myself by my score', 'the number ruined my day', 'managing expectations golf', 'i expect too much of myself'],
    principle:
      'A round is more than the final number — good swings, a clutch up-and-down, time outside, and laughs all count. Set expectations to your real game (misses included) so a high score doesn\'t erase a day that had plenty of good in it. Judge the round by how you committed and how it felt, not just the total.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log', 'tendencies'],
    coachingCues: ['the score is one part of the day, not all of it', 'expect misses — they\'re part of golf', 'count the good shots, not just the number'],
    related: ['psych.expectation', 'mind.fun-momentum', 'mind.one-shot-at-a-time'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.play-your-own-game',
    layer: 'psychology',
    module: MODULE,
    topic: 'playing your own game',
    aliases: ['my buddy outdrives me', 'i try to keep up with better players', 'i press to match the group', 'should i go for it like them', 'play my own game', 'comparing myself to my playing partners'],
    principle:
      'Play YOUR game, not your partner\'s. Trying to match someone who hits it farther or takes on heroics pulls you into shots you don\'t own and into big numbers. Pick the club and shot that fits YOUR yardages and miss, let the others do their thing, and your scoring takes care of itself.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log', 'bag', 'tendencies'],
    coachingCues: ['play your yardages, not theirs', 'don\'t borrow someone else\'s risky shot', 'your game, your plan — let them play theirs'],
    related: ['cm.safe-miss', 'mind.go-to-shot', 'psych.expectation'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.finish-strong',
    layer: 'psychology',
    module: MODULE,
    topic: 'finishing strong (don\'t give away the back nine)',
    aliases: ['i fall apart on the back nine', 'i throw away good rounds at the end', 'protecting a good score', 'finishing the round strong', 'i get tired and sloppy late', 'closing out a round'],
    principle:
      'Late in a round is where good days get thrown away — fatigue and score-protecting tighten the swing. Keep doing exactly what built the round: same routine, same commitment, one shot at a time. Don\'t play "not to lose it"; play each finishing hole on its own and let the score land where it lands.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['finish with the routine that built the round', 'play to win the hole, not to protect the score', 'one shot at a time, all the way to 18'],
    related: ['mind.one-shot-at-a-time', 'mind.next-shot-reset', 'psych.outcome-fixation'],
    source: 'sport-psychology',
  },
  {
    id: 'mind.fun-momentum',
    layer: 'psychology',
    module: MODULE,
    topic: 'fun + momentum (play for the rush)',
    aliases: ['im not having fun out here', 'golf is stressing me out', 'i play better when im loose', 'how do i enjoy the round', 'the joy of a pure shot', 'i play for the good shots'],
    principle:
      'You came out for the rush of a pure strike and the momentum of a few good holes, not to grind. Loose and present beats tight and serious — chase the next good shot, ride the confidence when it comes, and let one flushed shot carry into the next. Fun is not a reward for playing well; it is what makes you play well.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: ['chase the next good shot, not perfection', 'ride the momentum when it shows up', 'loose and present is your best golf'],
    related: ['mind.expectations-not-the-score', 'mind.go-to-shot', 'mind.finish-strong'],
    source: 'sport-psychology',
  },
];
