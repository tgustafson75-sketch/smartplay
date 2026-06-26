/**
 * PUTTING — ADVANCED golf-knowledge module (layer 'putting').
 *
 * EXTENDS modules/putting.ts (slope/grain reads, pace, lag, stroke, short-putt
 * routine) into the next layer that lowers scores for 12–30 handicaps:
 *   - READING : grain depth, double-breakers, reading from the low side,
 *     reading the last third / around the hole.
 *   - DISTANCE : a feel-based lag system and the "first-putt speed" priority.
 *   - TARGETING : putt to a spot, putt to the high (pro) side, never-up vs
 *     run-it-by balance.
 *   - CONDITIONS : firm/fast greens, wind on putts.
 *   - ROUTINE : the full see-it-then-go pre-putt routine.
 *
 * HONESTY: the app has NO putt-stroke sensor — no pose/acoustic read of a
 * putting stroke, no green-contour scan. Everything here is `coaching_only`
 * EXCEPT pace cues that GPS elevation can hint as generally uphill/downhill on
 * a longer putt, which are `directional` (a hint, never a contour read).
 * UNDER-claim: never imply the app measured the read or the stroke.
 *
 * Sources synthesized (no verbatim): Stockton green-reading/routine & low-side
 * read, Utley/feel distance teaching, ladder-drill lag systems, modern putting
 * instruction.
 */

import type { KBEntry } from '../schema';

const MODULE = 'putting';

export const PUTTING_ADVANCED: KBEntry[] = [
  // ── READING ────────────────────────────────────────────────────────────────
  {
    id: 'putt.read.low-side',
    layer: 'putting',
    module: MODULE,
    topic: 'green reading — read from the low side',
    aliases: [
      'where do i read a putt from',
      'read from the low side',
      'best angle to read a putt',
      'which side do i read from',
      'how to see the break better',
    ],
    principle:
      'Take your first read from the LOW side of the putt, standing between the ball and the hole at the lowest point — that\'s where the slope shows itself most clearly. Confirm from behind the ball, then trust the first read. Most amateurs under-read because they only look from straight behind.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['first look from the low side', 'confirm from behind the ball', 'trust the first read'],
    related: ['putt.read.slope', 'putt.read.last-third', 'putt.routine.full'],
    source: 'stockton-green-reading',
  },
  {
    id: 'putt.read.last-third',
    layer: 'putting',
    module: MODULE,
    topic: 'green reading — the last third matters most',
    aliases: [
      'where does a putt break the most',
      'break near the hole',
      'reading around the hole',
      'why did my putt break at the end',
      'last third of the putt',
    ],
    principle:
      'The ball breaks most in the last third as it slows down, so read the area AROUND the hole most carefully — that\'s where slope and grain steal the line. Picture the speed the ball will arrive with and read the break for that dying roll, not for the faster section near the ball.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['the break lives in the last third', 'read around the hole hardest', 'read for the dying speed'],
    related: ['putt.read.slope', 'putt.read.low-side', 'putt.speed.affects-break'],
    source: 'stockton-green-reading',
  },
  {
    id: 'putt.read.double-breaker',
    layer: 'putting',
    module: MODULE,
    topic: 'green reading — double-breakers (S-curves)',
    aliases: [
      'double breaker',
      's curve putt',
      'putt breaks both ways',
      'how to read a double breaking putt',
      'two way break',
    ],
    principle:
      'On a putt that breaks both ways, the second break — the one nearer the hole — wins, because the ball is slower and most affected there. Favor that final break, pick the high point the ball must cross to enter from the pro side, and let speed simplify the rest.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['the second break wins', 'pick the apex near the hole', 'good speed flattens the first wiggle'],
    related: ['putt.read.last-third', 'putt.target.high-side', 'putt.read.slope'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.read.grain-depth',
    layer: 'putting',
    module: MODULE,
    topic: 'green reading — grain & fringe edge',
    aliases: [
      'how much does grain affect putts',
      'grain near the hole',
      'reading grain on bermuda',
      'which way does grain grow',
      'ragged edge of the hole',
    ],
    principle:
      'On grainy (often Bermuda) greens, grain matters most near the hole and on short putts: look at the cup — the ragged, brown-burned side is where grain grows TOWARD, and the ball drifts that way. Down-grain runs out, into-grain dies; account for it on top of the slope, not instead of it.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['look at the cup — ragged side = grain direction', 'grain bites hardest near the hole', 'grain on top of slope, not instead'],
    related: ['putt.read.grain', 'putt.read.last-third', 'putt.read.firmness'],
    source: 'putting-fundamentals',
  },

  // ── DISTANCE / TARGETING ───────────────────────────────────────────────────
  {
    id: 'putt.speed.first-putt-priority',
    layer: 'putting',
    module: MODULE,
    topic: 'speed — the first putt is a speed play',
    aliases: [
      'i keep leaving putts short',
      'i keep racing putts past',
      'first putt speed',
      'how hard to hit a long putt',
      'lag putt speed',
    ],
    principle:
      'On every approach putt, SPEED is the job — get the first putt pin-high inside a 3-foot circle and the second is a tap-in. A great line at poor speed three-putts; decent line at good speed almost never does. Make the first putt a speed decision, then commit to it.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['first putt = speed, not make', 'pin-high to a 3-foot circle', 'commit to the pace you picked'],
    related: ['putt.speed.lag', 'putt.distance.feel-system', 'putt.avoid.three-putt'],
    source: 'putting-fundamentals',
  },
  {
    id: 'putt.distance.feel-system',
    layer: 'putting',
    module: MODULE,
    topic: 'distance control — a feel/ladder system',
    aliases: [
      'how do i control putting distance',
      'distance control drill',
      'lag putting system',
      'judge long putt speed',
      'green speed feels different today',
    ],
    principle:
      'Build distance control as feel, not mechanics: look at the target, not the ball, and let your eyes set the stroke length — like a soft toss. Calibrate on the practice green with a ladder (putts to growing distances) so you learn today\'s green speed before the round. Stroke LENGTH scales distance; tempo stays the same.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['look at the target, toss it there', 'ladder-putt to feel today\'s speed', 'length scales distance, tempo stays constant'],
    related: ['putt.speed.lag', 'putt.speed.first-putt-priority', 'putt.read.firmness'],
    source: 'lag-ladder-drill',
  },
  {
    id: 'putt.target.to-a-spot',
    layer: 'putting',
    module: MODULE,
    topic: 'targeting — putt to a spot, not the hole',
    aliases: [
      'putt to a spot',
      'intermediate target putting',
      'how to aim a putt',
      'pick a spot in front of the ball',
      'i cant aim my putts',
    ],
    principle:
      'Aim at a small intermediate spot a few inches in front of the ball on your start line, then roll the ball over it — it\'s far easier to start the ball at something close than to aim at a hole 30 feet away. The only truly precise part of any putt is that first inch; control it and let your read do the rest.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['pick a spot an inch or two ahead', 'roll the ball over the spot', 'control the first inch, trust the read'],
    related: ['putt.stroke.face-square', 'putt.routine.full', 'putt.target.high-side'],
    source: 'stockton-routine',
  },
  {
    id: 'putt.target.high-side',
    layer: 'putting',
    module: MODULE,
    topic: 'targeting — play the high (pro) side',
    aliases: [
      'high side of the hole',
      'pro side putt',
      'amateur side miss',
      'i always miss below the hole',
      'never up never in',
    ],
    principle:
      'Miss on the HIGH side — a putt above the hole still has a chance to fall in; one below the hole (the amateur side) never does. Pair that with enough pace to reach: "never up, never in" is true, but the balance is firm enough to get there at good speed, not a charge that wrecks the comebacker.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['give it the high side', 'below the hole has no chance', 'reach the hole, but not by much'],
    related: ['putt.read.double-breaker', 'putt.speed.die-it-in', 'putt.speed.first-putt-priority'],
    source: 'putting-fundamentals',
  },

  // ── CONDITIONS ─────────────────────────────────────────────────────────────
  {
    id: 'putt.read.firmness',
    layer: 'putting',
    module: MODULE,
    topic: 'conditions — firm/fast greens & wind',
    aliases: [
      'fast greens',
      'firm greens putting',
      'slow greens',
      'does wind affect putts',
      'windy day putting',
      'how does green speed change my putt',
    ],
    principle:
      'Faster/firmer greens break MORE and need a dying pace; slow/wet greens break less and need firmer speed. Strong wind genuinely affects long putts — it pushes the ball, adds break downwind, and on really fast greens a wide stance steadies you. Adjust speed first, then re-read the break for that speed.',
    // GPS elevation can hint general uphill/downhill, but green speed/firmness is not sensed.
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['fast = more break, softer pace', 'slow/wet = less break, firmer pace', 'wind matters on the long ones'],
    related: ['putt.read.uphill-downhill', 'putt.distance.feel-system', 'putt.speed.die-it-in'],
    source: 'putting-fundamentals',
  },

  // ── ROUTINE ────────────────────────────────────────────────────────────────
  {
    id: 'putt.routine.full',
    layer: 'putting',
    module: MODULE,
    topic: 'pre-putt routine — see it, then go',
    aliases: [
      'pre putt routine',
      'putting routine',
      'how to set up over a putt',
      'i think too much over putts',
      'putting pre shot routine',
    ],
    principle:
      'Build one short, repeatable routine and run it every time: read it, pick the line and a spot, take one or two looks at the target to feel the speed, then step in and go before doubt creeps in. The routine\'s job is to quiet the mind — see the ball going in, set the face, and make a committed stroke.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['same routine every putt', 'look at the target to feel speed', 'see it in, then commit — no second-guessing'],
    related: ['putt.routine.short', 'putt.target.to-a-spot', 'putt.read.low-side', 'psych.commitment'],
    source: 'stockton-routine',
  },
];
