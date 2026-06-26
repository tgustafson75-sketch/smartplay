/**
 * WARM-UP — golf-knowledge module (layer 'practice', module 'warmup').
 *
 * How to get ready to PLAY (not to practice) before a round, tuned for the
 * time-constrained golfer who may have 15 minutes or none. Complements the
 * app's Pre-Round Warm Up and the pre-round dynamic-stretch feature: these are
 * the principles the caddie speaks while it walks you through them.
 *
 * HONESTY (the #1 law): warm-up wisdom is teaching → 'coaching_only'
 * throughout. The app can read a warm-up swing's tempo/strike as an OUTCOME,
 * but the routine itself is coaching, not a measurement. We never put a number
 * on a warm-up. We UNDER-CLAIM.
 *
 * Pure data — client + server safe.
 */

import type { KBEntry } from '../schema';

const MODULE = 'warmup';

export const WARMUP: KBEntry[] = [
  {
    id: 'warmup.efficient',
    layer: 'practice',
    module: MODULE,
    topic: 'efficient pre-round warm-up when short on time',
    aliases: [
      'how do i warm up',
      'quick warm up before golf',
      'pre round warm up',
      'i only have a few minutes to warm up',
      'efficient golf warm up',
    ],
    principle:
      'You don\'t need a big session — 15 focused minutes gets your body ready to compete. The goal is readiness, NOT improvement: you\'re waking up the swing and finding your tempo, not fixing anything. A few minutes of movement, a handful of building shots, and a few putts beat a rushed full bucket every time.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'warm up to play, not to practice — no swing changes today',
      '15 focused minutes is plenty',
      'a little movement, a few building shots, a few putts',
    ],
    related: ['warmup.order', 'warmup.body-not-swing', 'warmup.no-range'],
    source: 'pre-round warm-up fundamentals',
  },
  {
    id: 'warmup.order',
    layer: 'practice',
    module: MODULE,
    topic: 'the warm-up order: short to long, putts last',
    aliases: [
      'what order should i warm up',
      'warm up order',
      'should i start with driver',
      'warm up sequence',
      'what club first warming up',
    ],
    principle:
      'Work short to long. Start with easy half-swing wedges to wake up the bottom of the swing and your feel, move to a mid-iron (7 or 8) for full swings, then a few drivers — and save the putting green for last so your speed and feel are fresh going to the first tee. Starting with the driver is the classic mistake; it strains a cold body and rushes your tempo.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'wedges → mid-iron → driver → then putting',
      'never open with the driver on a cold body',
      'putt last so your speed is fresh on the first green',
    ],
    related: ['warmup.efficient', 'warmup.putting-speed', 'warmup.end-on-good'],
    source: 'pre-round warm-up sequencing',
  },
  {
    id: 'warmup.body-not-swing',
    layer: 'practice',
    module: MODULE,
    topic: 'warm up the body, not the swing',
    aliases: [
      'should i stretch before golf',
      'dynamic stretch before golf',
      'warm up my body for golf',
      'golf stretches before a round',
      'loosen up before golf',
    ],
    principle:
      'Before you touch a club, move. A few minutes of DYNAMIC stretches — trunk rotations, arm and leg swings, hip openers — raise your temperature and mobilize the joints the swing uses, which protects your back and frees up your turn. Keep it dynamic, not long static holds. The app\'s pre-round stretch routine walks you through this and can flag health-aware moves.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'move before you swing — dynamic, not long static holds',
      'trunk rotations, arm/leg swings, hip openers',
      'use the app\'s pre-round stretch — it\'s health-aware',
    ],
    related: ['warmup.efficient', 'warmup.first-tee', 'warmup.order'],
    source: 'dynamic warm-up / app pre-round stretch',
  },
  {
    id: 'warmup.end-on-good',
    layer: 'practice',
    module: MODULE,
    topic: 'end on a good swing',
    aliases: [
      'how should i finish my warm up',
      'end on a good shot',
      'last swing before the round',
      'finish warming up',
      'what to do at the end of warm up',
    ],
    principle:
      'Walk off the range on a shot you liked, not a search for a fix. The last feeling you carry to the first tee is the one your brain holds onto, so finish with a club and a shot you trust — even an easy wedge — and stop. Hunting for a missing piece on your final balls only loads doubt onto the first swing that counts.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'leave on a shot you liked, then stop',
      'the last feel is the one you carry to the tee',
      'don\'t go hunting for a fix on your final balls',
    ],
    related: ['warmup.first-tee', 'warmup.mental', 'warmup.order'],
    source: 'pre-round readiness',
  },
  {
    id: 'warmup.putting-speed',
    layer: 'practice',
    module: MODULE,
    topic: 'the putting / speed warm-up',
    aliases: [
      'how do i warm up putting',
      'putting before a round',
      'green speed warm up',
      'warm up on the practice green',
      'lag putting warm up',
    ],
    principle:
      'On the practice green, prioritize SPEED over line. Roll a few long lag putts to feel the day\'s green speed, then finish with a handful of short putts to leave with confidence and a sense of holing out. Most early three-putts come from misjudged speed on greens you haven\'t felt yet — a few lags fixes that.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'feel the day\'s speed first — roll long lags',
      'finish on short putts to leave confident',
      'speed, not line, is what you\'re calibrating',
    ],
    related: ['warmup.order', 'warmup.first-tee', 'warmup.no-range'],
    source: 'pre-round putting warm-up',
  },
  {
    id: 'warmup.first-tee',
    layer: 'practice',
    module: MODULE,
    topic: 'first-tee readiness',
    aliases: [
      'how do i hit a good first tee shot',
      'first tee nerves',
      'ready for the first tee',
      'first tee jitters',
      'opening tee shot',
    ],
    principle:
      'The first tee asks for a committed, smooth swing on a body that\'s ready — not a hero shot. Pick a conservative target and the club you trust most (it doesn\'t have to be driver), run your full routine, and swing at about 80% to find the fairway. Accept that you\'re still warming up the first couple of holes; a calm, in-play start beats a forced one.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: [
      'commit to a smooth 80% swing, not a hero shot',
      'play the club you trust — it needn\'t be driver',
      'first couple holes you\'re still warming up; in-play wins',
    ],
    related: ['warmup.end-on-good', 'warmup.mental', 'warmup.order'],
    source: 'first-tee readiness',
  },
  {
    id: 'warmup.no-range',
    layer: 'practice',
    module: MODULE,
    topic: 'warming up with no range',
    aliases: [
      'no range before my round',
      'how do i warm up without a range',
      'course has no driving range',
      'warm up with no balls',
      'rushing to the first tee',
    ],
    principle:
      'No range is fine — most courses don\'t have a great one and you\'ll often be rushing from the car. Do dynamic stretches, take slow rehearsal swings building from short to full to find tempo, and if there\'s a putting green, roll a few lags for speed. You can be ready to play without hitting a single ball; movement and tempo matter more than range reps.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'stretch, then rehearse swings short-to-full for tempo',
      'a few lag putts for speed if there\'s a green',
      'you can be ready without hitting a ball',
    ],
    related: ['warmup.body-not-swing', 'warmup.putting-speed', 'warmup.first-tee'],
    source: 'no-range warm-up',
  },
  {
    id: 'warmup.mental',
    layer: 'practice',
    module: MODULE,
    topic: 'the mental warm-up',
    aliases: [
      'mental warm up golf',
      'get in the right headspace before golf',
      'how do i get focused before a round',
      'pre round mindset',
      'mentally prepare for golf',
    ],
    principle:
      'Warm up your head too. Set a simple intention for the round — a process focus like "smooth tempo and commit to every target," not a score — and a forgiving attitude for the inevitable bad shots. Picture a couple of good shots, take a few easy breaths, and decide you\'re here to enjoy it. A calm, committed mindset travels further than a perfect range session.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['emotion_log'],
    coachingCues: [
      'pick a process intention, not a score',
      'decide in advance to shrug off the bad ones',
      'a few easy breaths and a couple of good pictures',
    ],
    related: ['warmup.first-tee', 'warmup.end-on-good', 'warmup.efficient'],
    source: 'mental pre-round preparation',
  },
];
