/**
 * EQUIPMENT — golf-knowledge module (layer 'equipment').
 *
 * Honest, high-ROI equipment wisdom for the mid/high-handicap golfer: gap the
 * bag so you're never stuck between clubs, give yourself loft and forgiveness,
 * match the ball to YOUR game, and get fit instead of guessing. No gearhead
 * micro-optimization — the stuff that actually drops scores for a busy golfer.
 *
 * COMPLEMENTS the app's features, doesn't duplicate them:
 *   - Ball Fitting (services/ballFitting.ts) + the Fit Profile already RUN the
 *     fitting; these entries are the KNOWLEDGE behind the advice so the caddie
 *     can explain WHY.
 *
 * HONESTY (the #1 law):
 *   - GAPPING can lean 'directional' on ['tracked_distance']: the app logs a
 *     real CARRY per club from confirmed tracked shots, so it can SEE that two
 *     clubs go the same distance or that a gap is too wide. That's directional
 *     evidence of a gap, NOT a launch-monitor fitting.
 *   - Everything about loft, forgiveness, shaft flex, bounce and ball CHOICE is
 *     'coaching_only' — we have NO launch monitor, so we never claim a measured
 *     spin rate, smash factor, launch angle, ball speed or compression. We
 *     UNDER-CLAIM and point to a real fitting for the numbers.
 *
 * Pure data — client + server safe.
 */

import type { KBEntry } from '../schema';

const MODULE = 'equipment';

export const EQUIPMENT: KBEntry[] = [
  // ══ GAPPING (grounded to tracked carry — directional) ════════════════════
  {
    id: 'equip.gapping-even',
    layer: 'equipment',
    module: MODULE,
    topic: 'even yardage gaps through the bag',
    aliases: [
      'club gapping',
      'how should my clubs be gapped',
      'even gaps between clubs',
      'are my clubs gapped right',
      'yardage gaps',
    ],
    principle:
      'A well-set bag has roughly even carry gaps — about 10-15 yards between full clubs — so you always have a club for the number in front of you. The goal isn\'t more distance, it\'s no holes: never being stuck between two clubs on an approach. The app tracks your real carry per club, so it can show where your gaps are even and where they drift.',
    appSignals: ['tracked_distance'],
    honesty: 'directional',
    cnsPersonalize: ['bag'],
    coachingCues: [
      'aim for ~10-15 yard gaps between full clubs',
      'even gaps beat raw distance — no holes to get stuck in',
      'we read your tracked carries to find the gaps, not a launch monitor',
    ],
    related: ['equip.find-the-gaps', 'equip.wedge-gapping', 'equip.get-fit'],
    source: 'gapping fundamentals / Vokey-style',
  },
  {
    id: 'equip.find-the-gaps',
    layer: 'equipment',
    module: MODULE,
    topic: 'finding your gaps from tracked carry',
    aliases: [
      'my gaps are off',
      'two clubs go the same distance',
      'i have a gap in my bag',
      'find my yardage gaps',
      'which clubs overlap',
    ],
    principle:
      'Two clubs that carry the same number are a wasted slot; a 25-yard hole between two clubs leaves you guessing on approaches. As you log tracked shots, the app builds your real carry per club and can flag an overlap (clubs doubling up) or a too-wide gap to close — directional evidence from YOUR shots, not a guess off a chart.',
    appSignals: ['tracked_distance'],
    honesty: 'directional',
    cnsPersonalize: ['bag'],
    coachingCues: [
      'overlapping clubs = a wasted slot; a wide gap = a guess on approach',
      'the more shots you track, the clearer your real gaps get',
      'close the biggest gap first — it\'s the most-used part of the bag',
    ],
    related: ['equip.gapping-even', 'equip.wedge-gapping', 'equip.get-fit'],
    source: 'gapping fundamentals',
  },
  {
    id: 'equip.wedge-gapping',
    layer: 'equipment',
    module: MODULE,
    topic: 'gapping the wedges',
    aliases: [
      'how should i gap my wedges',
      'wedge gapping',
      'how many wedges should i carry',
      'wedge lofts',
      'gap between my wedges',
    ],
    principle:
      'Most of your scoring shots live inside the pitching wedge, so even wedge gaps matter most. Check your PW loft, then build the rest around it in steps of about 4-6 degrees (e.g. 46-50-54-58 or 46-52-58) so each wedge has its own clear full-swing number — that\'s what kills the awkward in-between wedge. The app\'s tracked carries help confirm the gaps are real.',
    appSignals: ['tracked_distance'],
    honesty: 'directional',
    cnsPersonalize: ['bag'],
    coachingCues: [
      'check your PW loft first, then build the wedges off it',
      'about 4-6 degrees between wedges keeps the carries spaced',
      'even wedge gaps cut out the half-shot guesswork inside 100',
    ],
    related: ['equip.wedge-bounce', 'equip.gapping-even', 'equip.find-the-gaps'],
    source: 'wedge fitting / Vokey gapping',
  },
  {
    id: 'equip.wedge-bounce',
    layer: 'equipment',
    module: MODULE,
    topic: 'wedge bounce basics for turf and sand',
    aliases: [
      'what is wedge bounce',
      'how much bounce do i need',
      'wedge bounce for my swing',
      'low or high bounce wedge',
      'bounce for sand',
    ],
    principle:
      'Bounce is the angle that lets the sole glide instead of dig. More bounce (12 degrees+) forgives soft turf, fluffy sand and a steeper, divot-taking swing; low bounce (4-8 degrees) suits firm turf and tight lies. For most golfers, a mid-bounce sand/lob wedge (around 8-12 degrees) is the versatile, dig-resistant choice that keeps chunked chips and buried bunker shots down.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'more bounce = the club skids, not digs — friendlier on most lies',
      'steep swing or soft conditions? lean toward more bounce',
      'a mid-bounce wedge is the safe all-rounder',
    ],
    related: ['equip.wedge-gapping', 'equip.get-fit'],
    source: 'wedge bounce fundamentals',
  },

  // ══ FORGIVENESS & LOFT (coaching_only — no launch monitor) ═══════════════
  {
    id: 'equip.forgiveness-helps',
    layer: 'equipment',
    module: MODULE,
    topic: 'why forgiveness helps mid/high handicaps',
    aliases: [
      'do i need forgiving clubs',
      'what does forgiveness mean',
      'game improvement clubs',
      'most forgiving clubs',
      'should i play forgiving irons',
    ],
    principle:
      'You miss the center far more than you flush it, so forgiveness — game-improvement irons and high-MOI heads — is the highest-ROI gear choice for most golfers. A forgiving head holds ball speed and line on off-center hits, so your mishits fly straighter and lose less distance. It won\'t fix a swing, but it makes a bad day far less costly.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'forgiveness protects your MISSES, which is most of them',
      'game-improvement gear is the easy win — no swing change needed',
      'blades and low-spin heads punish off-center; you don\'t need that yet',
    ],
    related: ['equip.more-loft', 'equip.driver-basics', 'equip.get-fit'],
    source: 'game-improvement / forgiveness fundamentals',
  },
  {
    id: 'equip.more-loft',
    layer: 'equipment',
    module: MODULE,
    topic: 'why more loft helps the average golfer',
    aliases: [
      'should i use more loft',
      'do i need more loft on my driver',
      'why more loft',
      'more loft for distance',
      'higher lofted driver',
    ],
    principle:
      'Unless you swing very fast, more loft usually helps. It launches the ball higher and easier for more carry, and the extra backspin reduces the sidespin that turns into your slice or hook — so the ball flies straighter too. Most golfers leave distance and fairways on the table by playing too little loft (a sub-10 degree driver they can\'t launch).',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'more loft = easier launch AND straighter (less sidespin)',
      'most golfers play too little driver loft, not too much',
      '10.5 degrees or higher is the friendly default off the tee',
    ],
    related: ['equip.driver-basics', 'equip.forgiveness-helps', 'equip.get-fit'],
    source: 'driver loft fundamentals / Golf Digest equipment',
  },
  {
    id: 'equip.driver-basics',
    layer: 'equipment',
    module: MODULE,
    topic: 'driver basics for the average golfer',
    aliases: [
      'what driver should i use',
      'driver for high handicap',
      'how to pick a driver',
      'beginner driver',
      'best driver setup',
    ],
    principle:
      'For the average golfer the driver job is fairways, not bombs. Reach for plenty of loft (10.5 degrees+), a high-forgiveness head, and a shaft you can control — that combination launches the ball, keeps it in play and softens mishits. Chasing the lowest-loft, lowest-spin "tour" setup is the most common gear mistake amateurs make.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'pick the driver that finds fairways, not the one that "could" go furthest',
      'loft + forgiveness + a controllable shaft is the recipe',
      'a fairway in play beats 15 lost yards in the trees',
    ],
    related: ['equip.more-loft', 'equip.forgiveness-helps', 'equip.shaft-flex', 'equip.get-fit'],
    source: 'driver fitting fundamentals',
  },
  {
    id: 'equip.shaft-flex',
    layer: 'equipment',
    module: MODULE,
    topic: 'shaft flex basics',
    aliases: [
      'what shaft flex do i need',
      'stiff or regular shaft',
      'shaft flex for my swing',
      'do i need a stiffer shaft',
      'wrong shaft flex',
    ],
    principle:
      'Shaft flex should match how fast and hard you swing, and most golfers play too STIFF a shaft for their speed — which costs launch, distance and feel. If you\'re unsure, a regular (or senior) flex usually serves the average swing better than an ego-driven stiff. Flex is directional comfort, not a number we can measure for you; a fitting confirms it.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'most amateurs play too stiff — it robs launch and feel',
      'match flex to your real speed, not your ego',
      'unsure? lean softer; a fitting settles it',
    ],
    related: ['equip.get-fit', 'equip.driver-basics'],
    source: 'shaft fitting fundamentals',
  },

  // ══ BALL SELECTION (ties to Ball Fitting; coaching_only) ═════════════════
  {
    id: 'equip.ball-match-game',
    layer: 'equipment',
    module: MODULE,
    topic: 'match the ball to your game',
    aliases: [
      'what ball should i play',
      'what golf ball is best for me',
      'how to pick a golf ball',
      'which ball should i use',
      'choosing a golf ball',
    ],
    principle:
      'There\'s no single best ball — there\'s the best ball for YOUR priorities: distance and straightness, soft feel, or greenside spin. For most mid/high handicaps a softer, lower-spin two-piece ball flies straighter (less sidespin on your slice) and feels good around the green, which is the smart default. Pick one model and stick with it so your feel and distances stay consistent.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'choose for your priority: straight/distance, feel, or spin',
      'a softer low-spin ball straightens the slice for most golfers',
      'commit to one ball — consistency beats chasing a new model',
    ],
    related: ['equip.ball-fitting-feature', 'equip.ball-spin-tradeoff'],
    source: 'ball selection fundamentals',
  },
  {
    id: 'equip.ball-fitting-feature',
    layer: 'equipment',
    module: MODULE,
    topic: 'using the in-app Ball Fitting',
    aliases: [
      'fit me for a ball',
      'ball fitting',
      'recommend a golf ball',
      'use the ball fitter',
      'which ball fits me',
    ],
    principle:
      'The app\'s Ball Fitting matches a ball PROFILE to your game from the signals it can honestly read — your priorities and your shot tendencies — and suggests a direction (straighter/distance vs feel/spin). It\'s an honest directional fit, not a launch-monitor test: we don\'t measure your spin or compression, so think of it as a smart starting point to try, not a verdict.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'Ball Fitting points you to a profile, then you confirm it on the course',
      'honest fit on what we can read — no spin or compression numbers',
      'try the suggestion for a few rounds before judging',
    ],
    related: ['equip.ball-match-game', 'equip.ball-spin-tradeoff'],
    source: 'app Ball Fitting (services/ballFitting.ts)',
  },
  {
    id: 'equip.ball-spin-tradeoff',
    layer: 'equipment',
    module: MODULE,
    topic: 'spin vs distance vs feel tradeoff',
    aliases: [
      'high spin or low spin ball',
      'soft or hard golf ball',
      'distance ball vs tour ball',
      'do i need a spin ball',
      'should i play a tour ball',
    ],
    principle:
      'Ball design is a trade-off. Higher-spin tour balls reward a player who already controls the ball with extra greenside bite — but that same spin amplifies a slice or hook. Lower-spin distance/soft balls give up a little greenside grab for straighter flight and feel. Until your misses are tight, the straighter, softer side of the trade usually scores better.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'more spin grabs greens but exaggerates your curve',
      'straighter + softer usually scores better while misses are wide',
      'earn the tour ball once your dispersion tightens',
    ],
    related: ['equip.ball-match-game', 'equip.ball-fitting-feature'],
    source: 'ball construction fundamentals',
  },

  // ══ GET FIT vs GUESS ══════════════════════════════════════════════════════
  {
    id: 'equip.get-fit',
    layer: 'equipment',
    module: MODULE,
    topic: 'getting fit vs guessing',
    aliases: [
      'should i get fitted',
      'is a club fitting worth it',
      'getting fit for clubs',
      'do i need a fitting',
      'fitting vs off the rack',
    ],
    principle:
      'A real fitting on a launch monitor measures the things this app honestly can\'t — your spin, launch, smash and dispersion — and dials lie, loft, length, shaft and head to your swing. For loft, shaft and gapping calls it removes the guesswork. Use the app to spot the symptoms (gaps, a one-way miss) and to walk in knowing what to ask; let the fitting supply the numbers.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: [
      'a fitting measures spin/launch/smash — things we don\'t pretend to',
      'we flag the symptom (a gap, a miss); the fitter dials the spec',
      'even a quick driver-and-gapping fit is high value',
    ],
    related: ['equip.gapping-even', 'equip.driver-basics', 'equip.shaft-flex', 'equip.wedge-gapping'],
    source: 'fitting fundamentals',
  },
];
