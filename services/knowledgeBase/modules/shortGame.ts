/**
 * SHORT GAME — golf-knowledge module (layer 'short_game').
 *
 * Two pillars:
 *   - CHIPPING : a controlled, forward low point + landing-spot-FIRST thinking
 *     (lead-weight, hands forward, lead-arm dominant, "brush don't lift",
 *     ball-back = lower & more roll).
 *   - GREENSIDE BUNKER : sand as the energy-transfer medium (open face scaled
 *     to sand depth, weight forward, enter the "dollar-bill" zone behind the
 *     ball, full follow-through — "you don't hit the ball").
 *
 * HONESTY: there is no app sensor for chip/bunker contact; this is
 * `coaching_only` (low-point intent overlaps with pose's directional proxy on
 * full swings, but greenside touch is not measured).
 */

import type { KBEntry } from '../schema';

const MODULE = 'short_game';

export const SHORT_GAME: KBEntry[] = [
  {
    id: 'sg.chip.low-point',
    layer: 'short_game',
    module: MODULE,
    topic: 'chipping — controlled low point',
    aliases: ['chipping', 'how to chip', 'chip shot', 'i chunk my chips', 'i blade my chips', 'crisp chip'],
    principle:
      'A solid chip is a mini ball-first strike: 80–90% of weight on the lead foot, hands forward, lead-arm dominant, and the chest turning through. "Brush the grass, don’t lift the ball" — the loft does the lifting, you control the low point.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['weight forward, hands forward', 'lead arm leads', 'brush the grass, don’t lift'],
    related: ['sg.chip.landing-spot', 'sg.chip.ball-position-flight', 'contact.low-point'],
    source: 'short-game-fundamentals',
  },
  {
    id: 'sg.chip.landing-spot',
    layer: 'short_game',
    module: MODULE,
    topic: 'chipping — landing spot first',
    aliases: ['where do i land a chip', 'landing spot', 'chip and run', 'how far to carry a chip', 'read the chip'],
    principle:
      'Pick the LANDING SPOT, not the hole — predict where the ball must land to release the rest of the way. Choose the least-lofted club that carries the trouble and lands on green so the ball spends most of its trip rolling like a putt.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['land it, then let it roll', 'least loft that carries onto green', 'putt-like release'],
    related: ['sg.chip.ball-position-flight', 'sg.chip.low-point', 'putt.speed.pace'],
    source: 'short-game-fundamentals',
  },
  {
    id: 'sg.chip.ball-position-flight',
    layer: 'short_game',
    module: MODULE,
    topic: 'chipping — ball position controls flight',
    aliases: ['lower chip', 'higher chip', 'flight my chips', 'ball back chip', 'control chip trajectory'],
    principle:
      'Ball position dials the trajectory: ball back of center delofts the club for a lower, longer-rolling chip; ball forward (with weight still lead) adds height and check. Change the flight with ball position and club selection, not by manipulating the hands.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['ball back = lower, more roll', 'ball forward = higher, more check', 'let the club do it'],
    related: ['sg.chip.landing-spot', 'setup.ball-position'],
    source: 'short-game-fundamentals',
  },
  {
    id: 'sg.chip.club-selection',
    layer: 'short_game',
    module: MODULE,
    topic: 'chipping — club selection',
    aliases: ['what club to chip with', 'chip with a wedge or 8 iron', 'bump and run club', 'chipping club choice'],
    principle:
      'Match the club to the carry-to-roll ratio you need. Lots of green to work with → less loft (8–9 iron) for a low runner; short-sided with little green → more loft (56–60°) to land soft. The simplest shot that gets it close is the right one.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: ['more green = less loft', 'short-sided = more loft', 'simplest shot that works'],
    related: ['sg.chip.landing-spot', 'cm.expected-value'],
    source: 'short-game-fundamentals',
  },
  {
    id: 'sg.bunker.energy-transfer',
    layer: 'short_game',
    module: MODULE,
    topic: 'greenside bunker — sand as energy transfer',
    aliases: ['bunker shot', 'greenside bunker', 'sand shot', 'how to hit out of a bunker', 'i leave it in the bunker', 'splash shot'],
    principle:
      'In a greenside bunker you don’t hit the ball — you hit the SAND, and the cushion of sand throws the ball out. Open the face, enter the sand a couple inches behind the ball, and let the bounce splash through. Speed plus sand, not a steep dig at the ball.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['hit the sand, not the ball', 'open face, use the bounce', 'splash, don’t dig'],
    related: ['sg.bunker.entry-zone', 'sg.bunker.follow-through'],
    source: 'short-game-fundamentals',
  },
  {
    id: 'sg.bunker.entry-zone',
    layer: 'short_game',
    module: MODULE,
    topic: 'greenside bunker — entry zone & face scaling',
    aliases: ['dollar bill bunker', 'where to enter the sand', 'how far behind the ball in a bunker', 'fluffy vs firm sand', 'open the face how much'],
    principle:
      'Aim to take a "dollar-bill" length of sand starting a couple inches behind the ball, weight favoring the lead side throughout. Scale the open face to the sand: fluffy/deep sand → more open and shallower; firm/wet sand → less open to avoid skulling.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['dollar-bill of sand behind the ball', 'weight stays lead', 'fluffy = more open, firm = less open'],
    related: ['sg.bunker.energy-transfer', 'sg.bunker.follow-through'],
    source: 'short-game-fundamentals',
  },
  {
    id: 'sg.bunker.follow-through',
    layer: 'short_game',
    module: MODULE,
    topic: 'greenside bunker — full follow-through',
    aliases: ['bunker follow through', 'i decelerate in the bunker', 'quit on the bunker shot', 'accelerate through sand'],
    principle:
      'The most common bunker fault is quitting — decelerating into the sand leaves it in the trap. Commit to a FULL, accelerating follow-through so the sand (and the ball with it) gets thrown out. Bigger swing, soft landing — the sand absorbs the speed.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['full finish, never quit', 'accelerate through the sand', 'commit to the splash'],
    related: ['sg.bunker.energy-transfer', 'psych.commitment'],
    source: 'short-game-fundamentals',
  },
];
