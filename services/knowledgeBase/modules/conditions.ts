/**
 * PLAYING CONDITIONS — golf-knowledge module (layer 'course_mgmt', module
 * 'conditions').
 *
 * Wind, elevation, temperature/altitude, firm-vs-wet ground, and the uneven /
 * trouble lies. Classic wind-and-lie adjustment teaching, curated for the mid-to-
 * high handicap player: simple, conservative rules ("take more club, swing easy")
 * over precise yardage math.
 *
 * HONESTY — this is the ONE place the app has real environmental signals. It
 * computes a plays-like number from GPS distance, wind, and elevation, so the
 * WIND / ELEVATION / PLAYS-LIKE entries are tagged ['gps'] DIRECTIONAL: the app
 * already feeds the adjusted number, and the caddie's job is to ground its advice
 * in THAT number — never to invent a yardage. The pure ball-striking adjustments
 * (lie aim, trajectory, balance) are coaching_only; the app cannot sense the lie.
 * Where a tagged signal appears, it is the input the advice is built on, not a
 * claim of precision.
 */

import type { KBEntry } from '../schema';

const MODULE = 'conditions';

export const CONDITIONS: KBEntry[] = [
  {
    id: 'cond.into-wind',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'into the wind — club up, swing easy',
    aliases: [
      'how much does wind affect my shot',
      'playing into the wind',
      'into a headwind what club',
      'wind in my face',
      'how much more club into the wind',
    ],
    principle:
      'Into the wind, take MORE club and swing easy — a smooth, lower shot holds its line where a hard one balloons and gets eaten. "When it\'s breezy, swing easy." Use the app\'s plays-like number to pick the club; the extra spin from a hard swing is what the wind punishes most.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['club up, swing easy', 'when it\'s breezy, swing easy', 'flight it down, take more club', 'trust the plays-like number'],
    related: ['cond.flight-it-down', 'cond.plays-like', 'cm.par3-strategy'],
    source: 'wind-teaching',
  },
  {
    id: 'cond.downwind',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'downwind — club down, expect release',
    aliases: [
      'playing downwind',
      'wind at my back what club',
      'downwind club selection',
      'wind helping me',
      'how much less club downwind',
    ],
    principle:
      'Downwind, the wind kills your spin so the ball flies and ROLLS more — take less club and plan for extra release on landing. A downwind green won\'t hold a low runner, so favour a higher shot to land soft. Let the app\'s plays-like number set the club, then allow for the rollout.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['club down, plan for release', 'downwind = less spin, more roll', 'higher shot to hold the green', 'use the plays-like number'],
    related: ['cond.into-wind', 'cond.plays-like', 'cm.miss-fat-side'],
    source: 'wind-teaching',
  },
  {
    id: 'cond.crosswind',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'crosswind — ride it or hold it, aim the edge',
    aliases: [
      'how to play a crosswind',
      'wind blowing sideways',
      'crosswind aim',
      'should i fight the crosswind',
      'left to right wind',
    ],
    principle:
      'In a crosswind, pick ONE plan: ride it (let the wind curve the ball and aim into the wind so it brings the ball back) or hold it (curve against the wind). Riding it is simpler and lower-risk for most players — aim at the upwind edge and let the wind do the work. A crosswind costs little distance but moves the ball offline, so widen your target.',
    appSignals: ['gps', 'tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['ride it, don\'t fight it', 'aim the upwind edge, let it drift back', 'widen the target in crosswind'],
    related: ['cm.dispersion-cone', 'cm.miss-fat-side', 'cond.into-wind'],
    source: 'wind-teaching',
  },
  {
    id: 'cond.flight-it-down',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'flighting it down in wind',
    aliases: [
      'how to hit a lower shot in the wind',
      'knockdown shot',
      'punch shot in wind',
      'keep it under the wind',
      'flight it down',
    ],
    principle:
      'A lower, controlled shot beats the wind: take extra club, grip down, ball slightly back, and make a smooth three-quarter swing with a shorter finish. Less height and less spin means the wind has less to grab. The goal is a flighted, penetrating ball — not a hard swing.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: ['extra club, grip down, ball back', 'smooth three-quarter, short finish', 'penetrating flight, not a hard hit'],
    related: ['cond.into-wind', 'cond.crosswind'],
    source: 'wind-teaching',
  },
  {
    id: 'cond.plays-like',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'plays-like distance — trust the adjusted number',
    aliases: [
      'whats the plays like distance',
      'how far does this really play',
      'adjusted yardage',
      'effective distance',
      'plays like number',
    ],
    principle:
      'The app blends raw GPS distance with wind and elevation into a single "plays-like" number — club off THAT, not the flat yardage on the marker. It already folds in uphill/downhill and the breeze, so your job is just to pick the club that matches the adjusted figure and commit.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['club off the plays-like number', 'the marker is the flat distance, not the real one', 'wind + slope already baked in'],
    related: ['cond.into-wind', 'cond.elevation-uphill', 'cond.elevation-downhill'],
    source: 'broadie',
  },
  {
    id: 'cond.elevation-uphill',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'uphill shot plays longer',
    aliases: [
      'its uphill how much more club',
      'shot is playing uphill',
      'green above me',
      'uphill to the green',
      'how much more club uphill',
    ],
    principle:
      'An uphill shot plays LONGER than the marker — the ball climbs against gravity, so it needs more carry. The app folds the elevation into the plays-like number; take the extra club it points to and aim for the center, since uphill shots tend to come up short.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['uphill plays longer — take more', 'club off the plays-like number', 'short is the common miss uphill'],
    related: ['cond.plays-like', 'cond.elevation-downhill', 'cm.par3-strategy'],
    source: 'elevation-teaching',
  },
  {
    id: 'cond.elevation-downhill',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'downhill shot plays shorter',
    aliases: [
      'its downhill how much less club',
      'shot is playing downhill',
      'green below me',
      'downhill to the green',
      'how much less club downhill',
    ],
    principle:
      'A downhill shot plays SHORTER than the marker — the green sits below you, so the ball needs less carry. The app builds the drop into the plays-like number; club off that, and remember a downhill landing tends to release, so allow for a touch more roll.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['downhill plays shorter — take less', 'club off the plays-like number', 'expect a little more release landing downhill'],
    related: ['cond.plays-like', 'cond.elevation-uphill'],
    source: 'elevation-teaching',
  },
  {
    id: 'cond.temp-altitude',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'temperature and altitude on distance',
    aliases: [
      'does cold weather affect distance',
      'how much shorter in the cold',
      'playing at altitude',
      'ball flies further at altitude',
      'cold air club selection',
    ],
    principle:
      'Cold, heavy air costs distance — in cold conditions take a touch more club and expect a slightly shorter ball. Thin mountain air does the opposite: the ball carries noticeably farther at altitude, so club down. These are gentle adjustments stacked on top of your plays-like number, not precise yardages.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['bag'],
    coachingCues: ['cold air = take a little more', 'altitude = the ball flies, club down', 'gentle nudge, not exact yards'],
    related: ['cond.plays-like', 'cond.into-wind'],
    source: 'elevation-teaching',
  },
  {
    id: 'cond.firm-vs-wet',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'firm vs wet conditions',
    aliases: [
      'playing in the wet',
      'soft course vs firm course',
      'will the ball roll out',
      'wet fairways',
      'firm greens',
    ],
    principle:
      'Firm ground means more rollout — land tee shots and approaches shorter and let them run, and greens won\'t hold a low shot. Wet ground does the opposite: little roll, balls plug, and greens grab, so fly the ball to your number and expect it to stop. Adjust your LANDING spot, not just the club.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['firm = land it short and run it', 'wet = fly it to the number, it\'ll stop', 'plan the landing spot, not just the club'],
    related: ['cond.downwind', 'cm.around-green-plan'],
    source: 'tour-caddie',
  },
  {
    id: 'cond.lie-ball-above-feet',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'lie — ball above your feet',
    aliases: [
      'ball above my feet',
      'ball is above my feet which way does it go',
      'sidehill ball above feet',
      'uphill sidehill lie',
      'ball above feet aim',
    ],
    principle:
      'Ball above your feet (right-handed): the lie closes the face and the ball draws or pulls LEFT — so aim RIGHT of your target. Choke down on the grip to offset the closer-to-you ball, take a smooth swing, and aim further right the steeper the slope.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['above feet = aim right (RH)', 'choke down to match the lie', 'smooth swing, the ball draws'],
    related: ['cond.lie-ball-below-feet', 'cond.lie-uneven', 'cm.smart-escape'],
    source: 'lie-teaching',
  },
  {
    id: 'cond.lie-ball-below-feet',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'lie — ball below your feet',
    aliases: [
      'ball below my feet',
      'ball is below my feet which way does it go',
      'sidehill ball below feet',
      'ball below feet aim',
      'downhill sidehill lie',
    ],
    principle:
      'Ball below your feet (right-handed): the ball tends to fade or slice RIGHT — so aim LEFT of your target. Bend more from the hips, stay down through the shot to reach the lower ball, and aim further left the more the ball is below you.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['below feet = aim left (RH)', 'more knee flex, stay down through it', 'the ball fades — allow for it'],
    related: ['cond.lie-ball-above-feet', 'cond.lie-uneven', 'cm.smart-escape'],
    source: 'lie-teaching',
  },
  {
    id: 'cond.lie-uneven',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'lie — uphill and downhill lies',
    aliases: [
      'uphill lie',
      'downhill lie',
      'how to hit off a slope',
      'ball on an uphill slope',
      'ball on a downhill slope',
    ],
    principle:
      'Set your shoulders to MATCH the slope and swing along it. Uphill lie: the ball launches higher and shorter, so take more club; it tends to go left, aim a touch right. Downhill lie: the ball comes out lower and longer with less stopping power, take less club; it tends to go right, aim a touch left. Balance over precision — make a controlled swing.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: ['shoulders match the slope', 'uphill: more club, higher, aim right', 'downhill: less club, lower, aim left', 'balance first'],
    related: ['cond.lie-ball-above-feet', 'cond.lie-ball-below-feet', 'cm.smart-escape'],
    source: 'lie-teaching',
  },
  {
    id: 'cond.lie-rough',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'lie — rough, flyer vs grabber',
    aliases: [
      'ball in the rough',
      'flyer lie',
      'will this be a flyer',
      'thick rough club selection',
      'ball sitting up in the rough',
    ],
    principle:
      'Read the rough lie. Ball sitting UP with a little grass behind it = a flyer — less spin, the ball jumps and runs long, so take LESS club and respect the long miss. Ball sitting DOWN in thick grass = a grabber — the face closes and it comes out low, left and short, so take MORE club, steeper, and just advance it back to a clean number.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['sitting up = flyer, club down, beware long', 'buried = grabber, club up, just advance it', 'let the lie decide'],
    related: ['cond.lie-divot', 'cond.lie-hardpan', 'cm.smart-escape'],
    source: 'lie-teaching',
  },
  {
    id: 'cond.lie-divot',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'lie — ball in a divot',
    aliases: [
      'ball in a divot',
      'how to hit out of a divot',
      'ball in a sand filled divot',
      'unlucky lie in a divot',
    ],
    principle:
      'From a divot, prioritise ball-first contact: play the ball slightly back, hands ahead, weight forward, and hit DOWN on it. Expect a lower flight with a touch less spin, so take one more club and aim for the center — it\'s a control shot, not a hero shot.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: ['ball back, hands ahead, hit down', 'expect lower flight — take one more', 'center of the green, control shot'],
    related: ['cond.lie-hardpan', 'cond.lie-rough'],
    source: 'lie-teaching',
  },
  {
    id: 'cond.lie-hardpan',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'lie — hardpan and bare ground',
    aliases: [
      'ball on hardpan',
      'bare lie',
      'tight lie no grass',
      'how to hit off hardpan',
      'ball on dirt',
    ],
    principle:
      'On hardpan or a tight bare lie, clean ball-first contact is everything. Ball center or slightly back, weight a touch forward, and make a shallower, sweeping swing — no digging. Lean on a less-bouncey club and just make solid contact; this is a get-it-on-the-green shot, not a flag-hunt.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag'],
    coachingCues: ['ball-first, no digging', 'shallow sweep, weight slightly forward', 'solid contact over distance'],
    related: ['cond.lie-divot', 'cond.lie-fairway-bunker', 'cm.smart-escape'],
    source: 'lie-teaching',
  },
  {
    id: 'cond.lie-fairway-bunker',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'lie — fairway bunker',
    aliases: [
      'ball in a fairway bunker',
      'how to play a fairway bunker shot',
      'fairway sand club selection',
      'long bunker shot',
      'getting out of a fairway bunker',
    ],
    principle:
      'In a fairway bunker, getting OUT cleanly beats squeezing out distance. Make sure the club has enough loft to clear the lip, take one more club than the number to allow for a quieter swing, grip down, and pick the ball clean — ball-first, not sand-first. If the lip is high, wedge it back to the fairway and take your medicine.',
    appSignals: ['gps'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['clear the lip first', 'one more club, quiet swing, grip down', 'pick it clean, ball-first', 'high lip = just get out'],
    related: ['cond.lie-hardpan', 'cm.take-your-medicine', 'cm.smart-escape'],
    source: 'lie-teaching',
  },
  {
    id: 'cond.wind-short-game',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'wind on putts and short game',
    aliases: [
      'does wind affect putting',
      'wind on chips and pitches',
      'putting in the wind',
      'wind around the greens',
      'strong wind short game',
    ],
    principle:
      'Wind matters more around the greens than players expect. A strong wind can push a putt and nudge your balance — widen your stance for stability and allow a hair of break in a hard crosswind. On chips and pitches, keep the ball low and running into the wind so the gust can\'t toss it offline.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['widen your stance in strong wind', 'allow a touch of break in a hard crosswind', 'keep chips low into the wind'],
    related: ['cond.crosswind', 'cond.flight-it-down', 'cm.around-green-plan'],
    source: 'wind-teaching',
  },
];
