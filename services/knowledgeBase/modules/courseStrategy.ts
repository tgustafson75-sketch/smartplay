/**
 * COURSE STRATEGY — golf-knowledge module (layer 'course_mgmt').
 *
 * EXTENDS modules/courseMgmt.ts (the DECADE / tour-caddie dispersion + expected-
 * value spine) into hole-by-hole STRATEGY for the mid-to-high handicap player:
 * tee-shot club choice and angles, par-3 / par-4 / par-5 plans, when to attack vs
 * play safe by pin colour, scrambling and the smart escape, scoring math by
 * handicap (eliminate the double, par-5s as scoring holes), and the core
 * "hit it to where the next shot is easy" mindset.
 *
 * AUDIENCE: 12-30 handicaps. Wider targets, center-green, take-your-medicine,
 * avoid the big number — NOT tour pin-hunting. Simple decision rules, encouraging,
 * "play the percentages."
 *
 * HONESTY: this is where the app has real signals. `gps` feeds the actual distance
 * / plays-like number, and `tracked_dispersion` is the player's measured left/right
 * + long/short spread. Strategy that leans on those is DIRECTIONAL — the read is
 * real, the recommendation is judgment grounded in it. Pure doctrine (commit, take
 * your medicine, mindset) is coaching_only. We never invent a yardage; when a
 * number drives the call, the caddie grounds it in the app's number.
 */

import type { KBEntry } from '../schema';

const MODULE = 'course_mgmt';

export const COURSE_STRATEGY: KBEntry[] = [
  {
    id: 'cm.find-the-fairway',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'tee shot — find the fairway',
    aliases: [
      'how do i hit more fairways',
      'should i hit driver or less club off the tee',
      'i keep missing fairways',
      'find the fairway',
      'club down off the tee',
    ],
    principle:
      'On a tight or trouble-lined hole, the club that keeps your whole pattern in play beats the one that maxes distance. Trading a little length for a tee shot in the short grass is almost always the higher-scoring play — a 150-yard approach from the fairway beats a 110-yard approach from the trees.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['fairway first, distance second', 'club that fits your pattern in play', 'short grass beats a few extra yards'],
    related: ['cm.tee-strategy', 'cm.dispersion-cone', 'cm.next-shot-easy'],
    source: 'decade',
  },
  {
    id: 'cm.tee-angles',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'tee shot — angles and tee-box position',
    aliases: [
      'which side of the tee box should i tee up',
      'best angle off the tee',
      'how to play a dogleg',
      'aim away from the trouble',
      'tee it up on which side',
    ],
    principle:
      'Tee up on the SAME side as the trouble and aim away from it — that opens the widest safe angle into the hole. On a dogleg, favour the side that shortens the corner only if your pattern clears it; otherwise play to the fat outside and accept a slightly longer next shot.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['tee up on the trouble side, aim away', 'angle that opens the hole', 'fat side of the dogleg if in doubt'],
    related: ['cm.find-the-fairway', 'cm.tee-strategy', 'cm.next-shot-easy'],
    source: 'tour-caddie',
  },
  {
    id: 'cm.par3-strategy',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'par-3 strategy — enough club to center',
    aliases: [
      'how to play a par 3',
      'what club on a par 3',
      'par 3 strategy',
      'should i aim at the pin on a par 3',
      'i come up short on par 3s',
    ],
    principle:
      'Take ENOUGH club to reach the center of the green and aim there — most par-3 trouble (and the short miss) is front and short. Use the app distance to club for the middle, not the flag, and let center-green turn a miss into a long putt instead of a bunker shot.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['enough club to the center', 'most misses are short — take more', 'green is the target, not the flag'],
    related: ['cm.center-green', 'cm.miss-fat-side', 'cm.find-the-fairway'],
    source: 'decade',
  },
  {
    id: 'cm.miss-fat-side',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'miss to the fat side',
    aliases: [
      'which side should i miss',
      'short side',
      'dont short side yourself',
      'miss to the big side of the green',
      'fat side of the green',
    ],
    principle:
      'Aim so your miss leaves the most green to work with — never short-side yourself next to the pin. A long putt or a chip from the fat side is a routine two; a short-sided chip over a bunker is where doubles come from.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['leave yourself the most green', 'never short-side it', 'fat side, every time'],
    related: ['cm.par3-strategy', 'cm.center-green', 'cm.around-green-plan'],
    source: 'tour-caddie',
  },
  {
    id: 'cm.par4-position',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'par-4 strategy — position over distance',
    aliases: [
      'how to play a par 4',
      'par 4 strategy',
      'should i lay back off the tee on a par 4',
      'position over distance',
      'best number into the green',
    ],
    principle:
      'On a par-4, play backwards from the green: pick the spot that gives the easiest approach, then choose the tee club that lands you there in play. A comfortable full-club number from the fairway beats a few extra yards that bring trouble or an awkward half-wedge into reach.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['work back from the green', 'leave a number you like', 'position, then distance'],
    related: ['cm.next-shot-easy', 'cm.find-the-fairway', 'cm.tee-strategy'],
    source: 'decade',
  },
  {
    id: 'cm.par5-three-shot-plan',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'par-5 strategy — three-shot plan vs go-for-it',
    aliases: [
      'should i go for this par 5',
      'how to play a par 5',
      'par 5 strategy',
      'lay up or go for the green',
      'reachable par 5',
    ],
    principle:
      'Treat most par-5s as a three-shot scoring hole: a fairway tee shot, an easy advance, and a full wedge you trust. Only go for it in two when the long shot is in your bag, the lie is clean, and a miss still leaves a simple up-and-down — otherwise the lay-up to a comfortable wedge number is the lower-scoring play.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['par-5s are scoring holes', 'three good shots beat one hero', 'go only if the lie + safe miss agree'],
    related: ['cm.par5-layup-number', 'cm.par5-scoring-hole', 'cm.attack-vs-safe'],
    source: 'lowest-score-wins',
  },
  {
    id: 'cm.par5-layup-number',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'lay up to a number',
    aliases: [
      'what number should i lay up to',
      'lay up to a yardage',
      'best wedge distance',
      'how far to lay up',
      'leave myself a full wedge',
    ],
    principle:
      'When you lay up, lay up to a NUMBER you love, not just "short of the trouble." Use the app distance to leave a full, comfortable wedge rather than a half-shot — golfers score better from 90 full than from 50 in-between. Pick the spot, then the club to reach it.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['lay up to a number you love', 'full wedge beats an in-between', 'pick the spot, then the club'],
    related: ['cm.par5-three-shot-plan', 'cm.next-shot-easy'],
    source: 'lowest-score-wins',
  },
  {
    id: 'cm.attack-vs-safe',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'attack vs play safe — pin colour',
    aliases: [
      'should i go at this pin',
      'when to attack the flag',
      'green light or red light pin',
      'attack or play safe',
      'is this a sucker pin',
    ],
    principle:
      'Read the pin like a traffic light. GREEN (middle of the green, safe miss both sides): you can take it on. YELLOW (one side guarded): aim to the fat side of the flag. RED (tucked behind a bunker or water, short-side miss): forget it — center-green, take your par and walk.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['green pin: go', 'yellow pin: fat side', 'red pin: center and move on'],
    related: ['cm.center-green', 'cm.miss-fat-side', 'cm.expected-value'],
    source: 'decade',
  },
  {
    id: 'cm.take-your-medicine',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'recovery — take your medicine',
    aliases: [
      'i hit it in the trees',
      'should i punch out',
      'take my medicine',
      'recovery shot',
      'try the hero shot or chip out',
      'i hit it in the junk',
    ],
    principle:
      'After a wayward shot, the first job is to get the ball back in play — a clean punch-out to the fairway turns a likely double into a bogey or saved par. Take the gap you can actually fit your pattern through; the hero shot through a two-foot window usually costs two strokes, not saves one.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['get it back in play first', 'punch out to a number', 'one bad shot, not two'],
    related: ['cm.smart-escape', 'cm.eliminate-doubles', 'cm.safe-miss'],
    source: 'tour-caddie',
  },
  {
    id: 'cm.smart-escape',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'recovery — the smart escape',
    aliases: [
      'best way out of trouble',
      'how to escape the rough',
      'whats my escape route',
      'smart recovery',
      'get out sideways',
    ],
    principle:
      'Pick the escape that the LIE will actually allow, not the one you wish for. From deep rough or behind a tree, the widest opening — even sideways or backwards — that returns you to a clean full swing is the win. Match the club to the lie, then aim at the biggest gap to your next good number.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['let the lie pick the shot', 'biggest gap to a clean swing', 'sideways is fine if it saves a stroke'],
    related: ['cm.take-your-medicine', 'cond.lie-rough', 'cond.lie-hardpan'],
    source: 'tour-caddie',
  },
  {
    id: 'cm.eliminate-doubles',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'scoring — eliminate doubles, bogey math',
    aliases: [
      'how do i shoot lower scores',
      'how to break 90',
      'how to break 80',
      'avoid big numbers',
      'eliminate double bogeys',
      'stop the blow up holes',
    ],
    principle:
      'Lower scores come from killing the doubles, not chasing birdies. Bogey is a perfectly good result on a hard hole — play for it on purpose and your blow-up holes disappear. Most strokes are lost to penalties, three-putts, and short-side chips, so manage those out and pars take care of themselves.',
    appSignals: ['tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['kill the doubles, not the pars', 'bogey is a good score on a hard hole', 'no penalties, no three-putts, no short-sides'],
    related: ['cm.take-your-medicine', 'cm.safe-miss', 'cm.scoring-by-handicap'],
    source: 'lowest-score-wins',
  },
  {
    id: 'cm.scoring-by-handicap',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'scoring strategy by handicap',
    aliases: [
      'how should i play for my handicap',
      'realistic strategy for my level',
      'bogey golfer strategy',
      'whats a good target score',
      'play for my level',
    ],
    principle:
      'Match ambition to your handicap. Higher handicaps: take the trouble out of play, aim center, and let bogey be par on the hard holes — pars will come as bonuses. Mid handicaps: protect the good holes and refuse to compound a mistake. At every level, the par-5s and short par-4s are your scoring holes — get aggressive there, conservative on the hard ones.',
    appSignals: ['tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies', 'bag'],
    coachingCues: ['ambition to match your level', 'bogey is par on the hard holes', 'pick your spots to attack'],
    related: ['cm.eliminate-doubles', 'cm.par5-scoring-hole', 'cm.attack-vs-safe'],
    source: 'lowest-score-wins',
  },
  {
    id: 'cm.par5-scoring-hole',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'par-5s as scoring holes',
    aliases: [
      'where do i make up shots',
      'par 5 scoring',
      'easiest holes to score on',
      'make birdies on par 5s',
      'where to get aggressive',
    ],
    principle:
      'Par-5s and short par-4s are where you make up shots — three controlled swings on a par-5 gives a real look at par or birdie with almost no risk. Be patient and disciplined here: a fairway, an easy advance, and a wedge you trust, and the good numbers come on their own.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['par-5s are where you score', 'three smart swings, one good look', 'patience pays on the reachables'],
    related: ['cm.par5-three-shot-plan', 'cm.scoring-by-handicap', 'cm.eliminate-doubles'],
    source: 'lowest-score-wins',
  },
  {
    id: 'cm.around-green-plan',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'around-the-green up-and-down planning',
    aliases: [
      'how to plan an up and down',
      'whats the easiest chip here',
      'chip or pitch',
      'where to land my chip',
      'get it up and down',
    ],
    principle:
      'Plan the up-and-down backwards from the hole: pick the spot you want to putt FROM, then choose the simplest shot that gets there. Take the lowest-risk option that fits the lie — putt or bump when you can, only loft it when you must — and aim to leave a stress-free uphill putt.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['putt from where you want, work back', 'lowest-risk shot that fits the lie', 'leave the uphill putt'],
    related: ['cm.miss-fat-side', 'cm.next-shot-easy'],
    source: 'tour-caddie',
  },
  {
    id: 'cm.next-shot-easy',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'mindset — hit it to where the next shot is easy',
    aliases: [
      'whats the smartest way to play this hole',
      'course management mindset',
      'how do good players think',
      'play the hole backwards',
      'make the next shot easy',
    ],
    principle:
      'Every shot exists to make the NEXT one easier. Stand on the tee and plan the hole backwards from the flag — pick the spots that give you the most comfortable next shot, and the score takes care of itself. Good golf is a chain of easy shots, not a string of heroes.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['make the next shot easy', 'play the hole backwards from the flag', 'a chain of easy shots'],
    related: ['cm.par4-position', 'cm.par5-layup-number', 'cm.expected-value'],
    source: 'decade',
  },
];
