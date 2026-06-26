/**
 * PUTTING — golf-knowledge module (layer 'putting').
 *
 * THE BIGGEST GAP in the caddie brain, so this is the richest module.
 *
 * HONESTY: the app has NO putt-stroke sensor yet — there is no pose/acoustic
 * read of a putting stroke. So almost everything here is `coaching_only`. The
 * one exception: on-course GPS elevation can HINT uphill/downhill on a long
 * putt, which makes pace guidance `directional` (never a precise read).
 */

import type { KBEntry } from '../schema';

const MODULE = 'putting';

export const PUTTING: KBEntry[] = [
  {
    id: 'putt.read.slope',
    layer: 'putting',
    module: MODULE,
    topic: 'green reading — slope',
    aliases: [
      'how do i read this green',
      'read the green',
      'green reading',
      'which way does it break',
      'reading the break',
      'how much does this break',
    ],
    principle:
      'Read the overall tilt first: low point of the green pulls the ball. Walk to the low side and behind the ball, pick an apex the putt rolls over, and aim the start line at that apex — not at the hole.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['find the low side', 'aim at the apex, not the cup', 'trust your first read'],
    related: ['putt.read.grain', 'putt.speed.affects-break', 'putt.read.uphill-downhill'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.read.grain',
    layer: 'putting',
    module: MODULE,
    topic: 'green reading — grain',
    aliases: ['grain', 'which way is the grain', 'reading grain', 'fast or slow grain'],
    principle:
      'Grain is the direction the grass grows. Down-grain (shiny, grass laying away) putts run faster and break more; into-grain (dull) putts are slower and break less. Grain usually follows drainage / the setting sun.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['shiny = down-grain = faster', 'dull = into-grain = slower'],
    related: ['putt.read.slope', 'putt.speed.pace'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.read.uphill-downhill',
    layer: 'putting',
    module: MODULE,
    topic: 'green reading — uphill vs downhill pace',
    aliases: ['uphill putt', 'downhill putt', 'is this uphill', 'fast downhill putt'],
    principle:
      'Uphill putts need firmer pace and break less; downhill putts need a softer, dying pace and break more. On a downhiller, pick a smaller target short of the hole and let gravity finish it.',
    // GPS elevation can hint general uphill/downhill on a longer putt — a hint, not a green-contour read.
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['uphill = firmer, less break', 'downhill = softer, more break'],
    related: ['putt.read.slope', 'putt.speed.pace', 'putt.speed.die-it-in'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.speed.pace',
    layer: 'putting',
    module: MODULE,
    topic: 'speed / pace control',
    aliases: ['putting speed', 'pace control', 'speed control', 'how hard do i hit it', 'distance control putting'],
    principle:
      'Speed controls both break and outcome more than line does — a putt rolled at the right pace finishes near the hole even off a slightly wrong line. Match stroke LENGTH to distance and keep tempo constant; never hit harder, swing longer.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['length, not force', 'pace beats line', 'same tempo every putt'],
    related: ['putt.speed.lag', 'putt.speed.die-it-in', 'putt.read.slope'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.speed.lag',
    layer: 'putting',
    module: MODULE,
    topic: 'lag putting — distance buckets',
    aliases: ['lag putt', 'long putt', 'lag putting', 'two putt from distance', 'long range putt'],
    principle:
      'On long putts the goal is a tap-in, not a make. Aim at a 3-foot circle around the hole. Think in distance buckets — feel the pace for "this is a 30-footer" — and prioritize leaving it pin-high so the second putt is straight.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['lag to a 3-foot circle', 'pin-high beats on-line', 'never leave it short of the hole'],
    related: ['putt.speed.pace', 'putt.avoid.three-putt'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.speed.die-it-in',
    layer: 'putting',
    module: MODULE,
    topic: 'die-it-in vs firm',
    aliases: ['die it in the hole', 'how firm should i putt', 'firm putt or soft', 'should i ram it'],
    principle:
      'A ball dying at the hole uses the whole cup and takes the most break — best on fast and downhill putts. A firmer putt holds its line and takes out break but punishes a miss with a longer comeback. Match the strategy to the speed.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['die it on fast/downhill', 'firm it on slow/uphill short ones'],
    related: ['putt.speed.pace', 'putt.read.uphill-downhill'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.stroke.eyes-over-ball',
    layer: 'putting',
    module: MODULE,
    topic: 'stroke fundamentals — setup',
    aliases: ['putting setup', 'putting stance', 'eyes over the ball', 'how should i stand to putt'],
    principle:
      'Set your eyes directly over (or just inside) the ball so your sightline matches the true line. Ball slightly forward of center, weight balanced, arms hanging so the putter swings like a pendulum from the shoulders.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['eyes over the ball', 'ball just forward of center', 'arms hang under the shoulders'],
    related: ['putt.stroke.pendulum', 'putt.stroke.face-square'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.stroke.pendulum',
    layer: 'putting',
    module: MODULE,
    topic: 'stroke fundamentals — pendulum',
    aliases: ['putting stroke', 'pendulum stroke', 'how to make a good putting stroke', 'wristy putting'],
    principle:
      'Rock the stroke from the shoulders, keeping the wrists quiet and the lower body still. Equal length back and through with constant tempo — a longer stroke makes a longer putt, not a faster hit.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['quiet wrists', 'shoulders rock', 'equal back and through'],
    related: ['putt.stroke.eyes-over-ball', 'putt.speed.pace'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.stroke.face-square',
    layer: 'putting',
    module: MODULE,
    topic: 'stroke fundamentals — face at impact',
    aliases: ['putter face square', 'i keep missing left', 'i keep missing right', 'putts not starting on line', 'pushing putts'],
    principle:
      'On short putts the face angle at impact owns roughly 80–90% of the start direction. Pick a spot an inch in front of the ball on your line and roll the ball over it with a square face — start line is everything from short range.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['square face owns start direction', 'roll it over a near spot', 'see the line, then trust it'],
    related: ['putt.routine.short', 'putt.stroke.pendulum'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.routine.short',
    layer: 'putting',
    module: MODULE,
    topic: 'short-putt routine',
    aliases: ['short putt', 'short putt routine', 'i miss short putts', 'three footer', 'how to make short putts'],
    principle:
      'Short putts are made by routine and commitment, not effort. Read it once, pick the line, set the face, then make a confident accelerating stroke through the ball. Tentative deceleration is what pushes and pulls them.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['commit, then go', 'accelerate through it', 'no deceleration'],
    related: ['putt.stroke.face-square', 'putt.avoid.three-putt', 'psych.commitment'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.avoid.three-putt',
    layer: 'putting',
    module: MODULE,
    topic: '3-putt avoidance',
    aliases: ['stop three putting', 'avoid three putt', 'three putting', '3 putt', 'too many putts'],
    principle:
      'Three-putts are a speed problem, not a line problem. Win the first putt on PACE — leave it pin-high inside three feet — and the second becomes a tap-in. On long putts, fear leaving it short less than racing it past.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first putt = pace', 'pin-high to a 3-foot circle', 'speed kills three-putts'],
    related: ['putt.speed.lag', 'putt.speed.pace', 'putt.routine.short'],
    source: 'putting-fundamentals',
  },
];
