/**
 * SHORT GAME — ADVANCED golf-knowledge module (layer 'short_game').
 *
 * EXTENDS modules/shortGame.ts (chipping basics + greenside bunker basics) into
 * the shots that actually save scores for 12–30 handicaps:
 *   - PITCHING : the clock/length system for distance control, landing-spot
 *     touch, the flop (when + how + when NOT to), and the bump-and-run.
 *   - CHIPPING BY LIE : tight/hardpan, fluffy rough, ball above/below feet,
 *     uphill/downhill — same fundamentals, lie-specific adjustments.
 *   - DECISION : "putt when you can, chip when you can't, pitch only when you
 *     must" — the highest-ROI thinking around the green.
 *   - BUNKER (the harder lies): fairway bunker, buried/fried-egg, long
 *     greenside, downhill/uphill.
 *
 * HONESTY: there is NO app sensor for short-game contact — no precise launch,
 * spin, or carry read on a pitch/chip/bunker shot. Every entry here is
 * `coaching_only`. Tracked carry distance exists for FULL shots only, so even
 * the clock system is taught as feel, not a measured matrix. UNDER-claim
 * always: this is teaching wisdom, not a measurement.
 *
 * Sources synthesized (no verbatim): Pelz clock/length distance system, Utley
 * greenside touch, modern short-game decision teaching, Golf Distillery /
 * GOLFTEC lie + bunker instruction.
 */

import type { KBEntry } from '../schema';

const MODULE = 'short_game';

export const SHORT_GAME_ADVANCED: KBEntry[] = [
  // ── DECISION ───────────────────────────────────────────────────────────────
  {
    id: 'sg.decision.putt-chip-pitch',
    layer: 'short_game',
    module: MODULE,
    topic: 'greenside decision — putt / chip / pitch',
    aliases: [
      'should i putt or chip',
      'chip or pitch',
      'what shot around the green',
      'best shot from the fringe',
      'do i need to chip this',
      'how do i get up and down',
    ],
    principle:
      'Putt when you can, chip when you can\'t, and pitch only when you must. The lower-risk shot is almost always the smarter shot — keep the ball on the ground whenever grass and slope allow, and only reach for loft when something forces you to.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['lowest-risk shot that works', 'ground game first', 'loft only when forced'],
    related: ['sg.bumprun.basics', 'sg.chip.landing-spot', 'sg.pitch.clock'],
    source: 'short-game-decision',
  },
  {
    id: 'sg.decision.short-sided',
    layer: 'short_game',
    module: MODULE,
    topic: 'greenside decision — short-sided',
    aliases: [
      'short sided',
      'short-sided chip',
      'no green to work with',
      'pin right by the edge',
      'i have no room to land it',
    ],
    principle:
      'When you are short-sided — little green between you and the pin — accept that the smart miss is the middle of the green, not a hero flop. Take your medicine: aim for the fat of the green or the safe side of the hole and two-putt rather than short-siding yourself again.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['the smart miss is the middle of the green', 'avoid the double short-side', 'a 20-footer beats a re-chip'],
    related: ['sg.decision.putt-chip-pitch', 'sg.flop.when', 'cm.expected-value'],
    source: 'short-game-decision',
  },

  // ── PITCHING ─────────────────────────────────────────────────────────────────
  {
    id: 'sg.pitch.clock',
    layer: 'short_game',
    module: MODULE,
    topic: 'pitching — clock/length distance system',
    aliases: [
      'pitch shot distance',
      'how far do i swing for a pitch',
      'clock system wedge',
      '50 yard wedge',
      'partial wedge distance control',
      'how to control wedge distance',
    ],
    principle:
      'Control pitch distance with backswing LENGTH, not effort. Use three repeatable lengths — hands to about hip (short), to chest/9-o\'clock (medium), and near-full — at one constant tempo. Three lengths across your wedges give you a reliable ladder of carry numbers you can trust.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['length, not power, sets distance', 'three swings, same tempo', 'learn the carry of each length on the range'],
    related: ['sg.pitch.landing-control', 'sg.pitch.setup', 'practice.feel-distance'],
    source: 'pelz-clock-system',
  },
  {
    id: 'sg.pitch.setup',
    layer: 'short_game',
    module: MODULE,
    topic: 'pitching — setup & strike',
    aliases: [
      'how to hit a pitch shot',
      'pitch shot technique',
      'i chunk my pitches',
      'i thin my pitches',
      'crisp pitch shot',
    ],
    principle:
      'A pitch is a longer, softer-landing cousin of the chip: narrow stance, ball centered, weight slightly lead, and a turning chest with quiet hands. Let the loft and bounce work — rotate your body through and the ball comes off soft. The chunk and the thin both come from trying to lift it.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['turn through, don\'t lift', 'use the bounce, brush the turf', 'quiet hands, busy chest'],
    related: ['sg.pitch.clock', 'sg.chip.low-point', 'contact.low-point'],
    source: 'short-game-fundamentals',
  },
  {
    id: 'sg.pitch.landing-control',
    layer: 'short_game',
    module: MODULE,
    topic: 'pitching — landing spot & spin reality',
    aliases: [
      'where do i land a pitch',
      'how much does a pitch roll out',
      'stop a pitch on the green',
      'check spin pitch',
      'control pitch trajectory',
    ],
    principle:
      'Pick the landing spot and accept that a pitch checks a little but still releases — you don\'t need tour spin to get close. Land it a third to halfway to the pin on a fast green, closer on a slow one, and let predictable rollout do the rest. Clean contact and a good lie matter far more than trying to suck it back.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['land it, then let it release', 'clean contact beats spin', 'fast green = land it shorter'],
    related: ['sg.pitch.clock', 'sg.chip.landing-spot', 'putt.read.firmness'],
    source: 'short-game-fundamentals',
  },
  {
    id: 'sg.flop.when',
    layer: 'short_game',
    module: MODULE,
    topic: 'flop / high-soft shot — when (and when NOT)',
    aliases: [
      'when do i hit a flop',
      'should i flop it',
      'high soft shot',
      'lob shot when to use',
      'is a flop a good idea',
    ],
    principle:
      'The flop is a last-resort shot: you only need it when you\'re short-sided over a hazard or onto a tight pin with no room to run it up. It REQUIRES a good lie — ball sitting up on soft turf. Off a tight/bare lie, downhill, or when you have green to work with, choose a chip or pitch instead; the flop is the highest-risk shot in the bag.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['last resort, not a default', 'needs a ball sitting up', 'no good lie = no flop'],
    related: ['sg.flop.how', 'sg.decision.short-sided', 'sg.lie.tight'],
    source: 'short-game-flop',
  },
  {
    id: 'sg.flop.how',
    layer: 'short_game',
    module: MODULE,
    topic: 'flop / high-soft shot — how',
    aliases: [
      'how to hit a flop',
      'how do i hit a flop shot',
      'flop shot technique',
      'open the face flop',
      'high soft pitch technique',
    ],
    principle:
      'Open the face FIRST (then grip), open your stance, ball forward, weight even, and exposing the bounce — then make a longer, fully-committed accelerating swing that slides the club under the ball with a high finish. The face stays open through impact; the height comes from loft and speed, never from flipping or quitting.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['open the face before you grip', 'commit — accelerate, never quit', 'slide under, high finish'],
    related: ['sg.flop.when', 'sg.bunker.energy-transfer', 'psych.commitment'],
    source: 'short-game-flop',
  },
  {
    id: 'sg.bumprun.basics',
    layer: 'short_game',
    module: MODULE,
    topic: 'bump-and-run',
    aliases: [
      'bump and run',
      'how to hit a bump and run',
      'low running chip',
      'run it up to the green',
      'links style chip',
    ],
    principle:
      'The bump-and-run is the safest greenside shot: a low-lofted club (7–9 iron or hybrid) played like a long chip so the ball spends most of its trip rolling like a putt. Land it on the first available flat, predictable turf and let it release — fewer moving parts means fewer ways to miss.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: ['putt-like stroke, less-lofted club', 'land it early, let it roll', 'fewest moving parts wins'],
    related: ['sg.decision.putt-chip-pitch', 'sg.chip.landing-spot', 'sg.chip.club-selection'],
    source: 'short-game-fundamentals',
  },

  // ── CHIPPING BY LIE ───────────────────────────────────────────────────────────
  {
    id: 'sg.lie.tight',
    layer: 'short_game',
    module: MODULE,
    topic: 'chipping by lie — tight / hardpan',
    aliases: [
      'tight lie chip',
      'chip off hardpan',
      'bare lie chip',
      'i blade chips off tight lies',
      'no grass under the ball',
    ],
    principle:
      'Off a tight or bare lie, use the LEADING EDGE, not the bounce: a lower-bounce wedge or even a less-lofted club, ball slightly back, hands forward, and a shallow ball-first brush. Pick a club you can run along the ground — there\'s no cushion of grass, so the margin is thin; the safer play is often a low runner.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: ['leading edge, low bounce', 'ball back, hands forward, ball-first', 'when in doubt, run it'],
    related: ['sg.lie.fluffy', 'sg.bumprun.basics', 'sg.chip.low-point'],
    source: 'short-game-lies',
  },
  {
    id: 'sg.lie.fluffy',
    layer: 'short_game',
    module: MODULE,
    topic: 'chipping by lie — fluffy / deep rough',
    aliases: [
      'chip out of thick rough',
      'fluffy lie',
      'ball sitting up in rough',
      'deep rough chip',
      'greenside rough chip',
    ],
    principle:
      'Out of fluffy rough, open the face to use the bounce so it slides rather than snags, hover the club, and make a slightly longer, committed swing — the grass steals speed. Expect less spin and more release, so plan for rollout. When the ball sits up, this is also where a higher, softer pitch becomes available.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['open face, use the bounce, slide through', 'grass steals speed — swing a touch more', 'expect release, plan for rollout'],
    related: ['sg.lie.tight', 'sg.flop.when', 'sg.bunker.energy-transfer'],
    source: 'short-game-lies',
  },
  {
    id: 'sg.lie.slope',
    layer: 'short_game',
    module: MODULE,
    topic: 'chipping by lie — ball above/below feet, uphill/downhill',
    aliases: [
      'ball above my feet chip',
      'ball below my feet chip',
      'uphill chip',
      'downhill chip',
      'chip off a slope',
      'sidehill chip',
    ],
    principle:
      'Set your body to the slope. Uphill: weight a bit back, swing up the hill — it launches higher and lands softer. Downhill: weight forward, follow the slope down, ball back, expect lower and longer. Ball above feet aims the shot left (right for lefties); ball below feet aims it right — choke down and allow for it.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['match shoulders to the slope', 'uphill = higher/softer, downhill = lower/longer', 'above feet pulls, below feet pushes'],
    related: ['sg.chip.low-point', 'sg.bunker.slope', 'ball.lie-effects'],
    source: 'short-game-lies',
  },

  // ── BUNKER (advanced lies) ─────────────────────────────────────────────────────
  {
    id: 'sg.bunker.fairway',
    layer: 'short_game',
    module: MODULE,
    topic: 'fairway bunker',
    aliases: [
      'fairway bunker shot',
      'how to hit out of a fairway bunker',
      'long bunker shot off the fairway',
      'i chunk fairway bunkers',
      'distance bunker shot',
    ],
    principle:
      'A fairway bunker is the opposite of a greenside splash: catch the ball FIRST, not the sand. Take one extra club, choke down, set your feet only lightly, keep your lower body quiet, and make a smooth ball-first swing. Clean contact and clearing the lip matter far more than max distance — prioritize getting out and advancing.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: ['ball first, not sand first', 'one extra club, choke down', 'clear the lip — out beats greedy'],
    related: ['sg.bunker.energy-transfer', 'cm.expected-value', 'sg.lie.tight'],
    source: 'bunker-instruction',
  },
  {
    id: 'sg.bunker.buried',
    layer: 'short_game',
    module: MODULE,
    topic: 'greenside bunker — buried / fried-egg lie',
    aliases: [
      'buried lie bunker',
      'fried egg bunker',
      'plugged in the sand',
      'ball plugged bunker',
      'how to hit a buried bunker lie',
    ],
    principle:
      'A buried or fried-egg lie needs the club to DIG, not splash: square (or slightly closed) the face, ball back a touch, weight forward, and drive the leading edge down a couple inches behind the ball. Expect a low, hot runner with no spin — plan for lots of rollout and just getting it onto the green.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['square/closed face, dig don\'t splash', 'ball back, steep down behind it', 'it comes out hot — plan for rollout'],
    related: ['sg.bunker.energy-transfer', 'sg.bunker.entry-zone', 'sg.bunker.long'],
    source: 'bunker-instruction',
  },
  {
    id: 'sg.bunker.long',
    layer: 'short_game',
    module: MODULE,
    topic: 'greenside bunker — long / 30+ yard',
    aliases: [
      'long bunker shot',
      'how to hit a long greenside bunker',
      '30 yard bunker shot',
      'in between bunker distance',
      'far bunker shot',
    ],
    principle:
      'The long greenside bunker is golf\'s hardest in-between shot. Take less sand than a splash and less loft (sand or gap wedge, face only slightly open), enter closer to the ball, and make a fuller, committed swing. Distance comes from a longer swing through a thinner cut of sand — never from quitting.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: ['less sand, less loft, longer swing', 'enter nearer the ball', 'commit — deceleration leaves it in'],
    related: ['sg.bunker.energy-transfer', 'sg.bunker.follow-through', 'sg.bunker.buried'],
    source: 'bunker-instruction',
  },
  {
    id: 'sg.bunker.slope',
    layer: 'short_game',
    module: MODULE,
    topic: 'greenside bunker — uphill / downhill lie',
    aliases: [
      'uphill bunker shot',
      'downhill bunker shot',
      'ball on a slope in the bunker',
      'sloped bunker lie',
      'bunker shot off a downslope',
    ],
    principle:
      'Match your swing to the slope. Uphill: lean with the hill (weight back), swing up the slope — it pops up high and short, so use less loft or swing bigger. Downhill: weight forward, ball back, follow the sand down the slope and chase the finish low — it comes out lower and runs, so allow for it.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['set your body to the slope', 'uphill = high/short, club up', 'downhill = low/runner, chase it down the hill'],
    related: ['sg.bunker.energy-transfer', 'sg.lie.slope', 'sg.bunker.follow-through'],
    source: 'bunker-instruction',
  },
];
