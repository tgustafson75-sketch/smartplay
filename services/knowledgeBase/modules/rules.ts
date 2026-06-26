/**
 * RULES — golf-knowledge module (layer 'course_mgmt', module 'rules').
 *
 * The Rules of Golf + etiquette that a mid/high-handicap actually runs into:
 * free relief, penalty areas, out of bounds / lost ball, the unplayable lie,
 * provisionals, putting-green rules, the teeing area, order of play, pace, and
 * the common courtesies that keep a round moving.
 *
 * HONESTY: rules + etiquette are pure knowledge — the app senses none of this,
 * so every entry is `coaching_only` (appSignals: ['none']). IMPORTANT: these
 * entries give the GENERAL idea + the player's options, then always hedge to
 * "for the exact drop / procedure, check the rulebook." They must NOT assert
 * precise measurements or procedures as if officiating — the goal is to help a
 * player proceed reasonably and know to confirm specifics, not to be a referee.
 */

import type { KBEntry } from '../schema';

const MODULE = 'rules';

export const RULES: KBEntry[] = [
  {
    id: 'rules.free-relief',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'free relief (cart path, casual water, ground under repair)',
    aliases: ['do i get relief from the cart path', 'my ball is on the cart path', 'casual water relief', 'standing in a puddle', 'ground under repair', 'is this a free drop', 'free drop'],
    principle:
      'You generally get FREE relief (no penalty) when an immovable obstruction like a paved cart path, temporary/casual water, or a marked ground-under-repair area interferes with your ball, stance, or swing. You find the nearest spot of full relief that is no closer to the hole and drop within a club-length of it. For the exact nearest-point-of-relief procedure and drop area, check the rulebook.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['paved path, puddle, or marked GUR usually = free drop', 'nearest dry spot no closer to the hole', 'confirm the exact drop with the rule'],
    related: ['rules.penalty-area', 'rules.unplayable', 'rules.drops'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.drops',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'how to drop',
    aliases: ['how do i drop the ball', 'where do i drop', 'do i drop or place', 'dropping from the knee', 'how high do i drop'],
    principle:
      'When taking relief you drop the ball (rather than place it) into the defined relief area, and it must come to rest inside that area. The current Rules drop from knee height. The size of the relief area and what counts as no-closer-to-the-hole depend on which relief you are taking, so check the rule for the exact procedure before you drop.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['drop from knee height', 'ball must settle inside the relief area', 'check the exact relief area for your situation'],
    related: ['rules.free-relief', 'rules.unplayable', 'rules.penalty-area'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.penalty-area',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'penalty areas (water / red & yellow)',
    aliases: ['i hit it in the water', 'water hazard what do i do', 'red stakes', 'yellow stakes', 'penalty area relief', 'in the hazard', 'ball in the creek'],
    principle:
      'A ball in a penalty area (water and other marked areas) costs ONE penalty stroke to take relief. You can always replay from where you last hit, or drop back-on-the-line keeping the entry point between you and the hole. Red-marked areas add a lateral option near where the ball last crossed the edge; yellow does not. You may also just play it as it lies if you can. For the exact reference points and drop, check the rule.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['water = one stroke to take relief', 'red gives a lateral option, yellow does not', 'back-on-the-line or replay always work — confirm the points'],
    related: ['rules.out-of-bounds', 'rules.free-relief', 'cm.safe-miss'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.out-of-bounds',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'out of bounds + lost ball (stroke and distance)',
    aliases: ['i hit it out of bounds now what', 'white stakes', 'ob', 'lost ball rule', 'i cant find my ball', 'stroke and distance'],
    principle:
      'Out of bounds (white stakes/lines) and a ball you cannot find are both handled by STROKE AND DISTANCE: add one penalty stroke and play again from where you last hit (so it effectively costs you the shot plus the distance). A ball is only OB when ALL of it is past the boundary. You normally get about three minutes to search before it is lost. Check the rule for the exact search time and procedure.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['OB or lost = one stroke + replay from the last spot', 'about three minutes to search', 'hit a provisional to save the walk back'],
    related: ['rules.provisional', 'rules.ob-local-rule', 'rules.penalty-area'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.ob-local-rule',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'OB / lost ball local rule (2-stroke option)',
    aliases: ['e5 local rule', 'two stroke option lost ball', 'do i have to go back for ob', 'drop instead of going back ob', 'casual round ob option'],
    principle:
      'Many casual rounds use the optional Local Rule (sometimes called E-5) that lets you avoid the walk back for a lost ball or OB: take TWO penalty strokes and drop out near where the ball was lost / went out, around the edge of the fairway. This is only available if the course or your group has adopted it, and it is not allowed in most competitions. Check that it is in play and read the exact drop the local rule defines.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['some rounds allow a 2-stroke drop instead of going back', 'only if your group/course adopted it', 'not for most competitions — confirm first'],
    related: ['rules.out-of-bounds', 'rules.provisional'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.unplayable',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'unplayable lie (your three options)',
    aliases: ['my ball is unplayable', 'stuck under a bush', 'against a tree', 'in the trees what do i do', 'can i declare unplayable', 'unplayable lie options'],
    principle:
      'You alone may call your ball unplayable almost anywhere on the course, and it costs ONE penalty stroke. You then pick one of three options: replay from your last spot; drop back-on-the-line behind the ball keeping it between you and the hole; or drop within two club-lengths of the ball, no closer to the hole. For the exact reference points and drop, check the rule.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['one stroke, three options', 'replay / back-on-line / two club-lengths', 'you decide it is unplayable — then confirm the drop'],
    related: ['rules.penalty-area', 'rules.drops', 'cm.safe-miss'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.provisional',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'provisional ball',
    aliases: ['should i hit a provisional', 'how do i play a provisional', 'might be lost or ob', 'hit another one just in case', 'provisional ball rule'],
    principle:
      'If your ball might be lost outside a penalty area or out of bounds, play a PROVISIONAL before walking forward — it saves the long walk back if the first is gone. You must announce it clearly (say the word "provisional") before hitting. If you find the original in play, you keep it and pick up the provisional. Check the rule for when the provisional becomes the ball in play.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['might be OB or lost? hit a provisional', 'say "provisional" out loud first', 'find the first in play and the provisional is scrapped'],
    related: ['rules.out-of-bounds', 'rules.ob-local-rule', 'rules.pace'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.putting-green',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'on the putting green (mark, lift, clean, flagstick)',
    aliases: ['can i mark my ball', 'lift and clean on the green', 'do i leave the flag in', 'flagstick rule', 'fix a ball mark', 'can i fix spike marks'],
    principle:
      'On the green you may mark, lift, and clean your ball (mark it first, behind the ball, before lifting). You can leave the flagstick in or take it out when putting — your choice. You are allowed to repair ball marks and most damage on your line. Brushing the line is fine but you cannot press anything down to improve it. Check the rule for what damage is repairable.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['mark behind the ball before you lift it', 'flag in or out is your call', 'fix your ball marks — confirm what else is allowed'],
    related: ['rules.etiquette-green', 'putt.routine.short'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.teeing-area',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'the teeing area',
    aliases: ['where can i tee up', 'how far back can i tee it', 'can i tee outside the markers', 'tee box rules', 'whats the teeing area'],
    principle:
      'On the tee you must play from inside the teeing area: between the two tee markers and up to two club-lengths back from them. You can stand outside that box, but the ball must be teed within it. If you accidentally knock the ball off the tee before your stroke, there is no penalty — just re-tee it. Check the rule for the exact boundaries.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['tee between the markers, up to two club-lengths back', 'you can stand outside the box', 'knock it off the tee by accident = no penalty, re-tee'],
    related: ['rules.order-of-play', 'rules.etiquette-pace'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.order-of-play',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'order of play / ready golf',
    aliases: ['who hits first', 'whats the honor', 'do i have to wait my turn', 'ready golf', 'order of play'],
    principle:
      'Traditionally the player farthest from the hole plays first, and the lowest score on the last hole tees off first ("the honor"). In casual play, READY GOLF is encouraged: whoever is ready and safe to hit goes, regardless of order, to keep the round moving. In strict competition, follow the proper order. Check the format you are playing.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['farthest from the hole plays first by tradition', 'casual round = ready golf, hit when ready and safe', 'competition = keep the proper order'],
    related: ['rules.etiquette-pace', 'rules.teeing-area'],
    source: 'rules-of-golf',
  },
  {
    id: 'rules.etiquette-pace',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'pace of play',
    aliases: ['how fast should i play', 'were playing slow', 'pace of play', 'how long should a round take', 'should we let them through', 'am i holding people up'],
    principle:
      'Keep pace with the group AHEAD of you, not just ahead of the group behind. Be ready when it is your turn — pick your club and read on the way to your ball — and aim for roughly 30-45 seconds over the shot. If you fall a hole behind and have an open hole ahead, wave the faster group through. Pace is the courtesy that matters most.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['keep up with the group ahead, not just the one behind', 'be ready when it is your turn', 'fell behind with an open hole? let them through'],
    related: ['rules.order-of-play', 'rules.etiquette-green', 'rules.etiquette-care'],
    source: 'golf-etiquette',
  },
  {
    id: 'rules.etiquette-green',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'etiquette on the green (lines, marks, shadows)',
    aliases: ['dont walk through my line', 'where do i stand on the green', 'fix ball marks', 'green etiquette', 'standing in someones line', 'casting a shadow on the putt'],
    principle:
      'Do not walk across another player\'s putting line (the line between their ball and the hole), and avoid standing where your shadow falls on it. Fix your ball marks, keep clear while others putt, and move off the green promptly once the hole is done — mark the card on the way to the next tee. Small courtesies on the green keep the group fast and friendly.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['never walk through someone\'s putting line', 'keep your shadow off their line', 'fix your marks and clear the green quickly'],
    related: ['rules.putting-green', 'rules.etiquette-pace'],
    source: 'golf-etiquette',
  },
  {
    id: 'rules.etiquette-care',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'care for the course (divots, bunkers)',
    aliases: ['do i fix my divot', 'rake the bunker', 'how do i rake', 'replace divots', 'care for the course', 'bunker etiquette'],
    principle:
      'Leave the course as good as you found it: replace or fill divots, and after a bunker shot rake your footprints and the area you played from smooth, entering and leaving from the low side near your ball. Leave the rake where the course asks (in or beside the bunker). It is quick, and the next player gets a fair lie.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['replace or fill your divots', 'rake your footprints and your shot area', 'enter and leave the bunker from the low side'],
    related: ['rules.etiquette-pace', 'rules.etiquette-safety'],
    source: 'golf-etiquette',
  },
  {
    id: 'rules.etiquette-safety',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'safety and "fore"',
    aliases: ['when do i yell fore', 'someone is in range', 'is it safe to hit', 'golf safety', 'i hit it toward people', 'do i shout fore'],
    principle:
      'Never hit while anyone could be in range ahead of you — wait until the group is well clear. If a shot heads toward other people, shout "FORE!" loudly and immediately so they can protect themselves. Stay clear and alert when others are swinging too. Safety always comes before pace.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['wait until the group ahead is clear', 'shout "fore" the instant a ball heads at people', 'safety before pace, every time'],
    related: ['rules.etiquette-pace', 'rules.etiquette-care'],
    source: 'golf-etiquette',
  },
  {
    id: 'rules.handicap-posting',
    layer: 'course_mgmt',
    module: MODULE,
    topic: 'handicap and posting scores (the idea)',
    aliases: ['whats a handicap', 'how does a handicap work', 'do i post my score', 'net score', 'how is my handicap calculated', 'should i post this round'],
    principle:
      'A handicap is a number that lets golfers of different levels compete fairly — it roughly reflects your scoring potential, and you subtract it (as strokes) to get a net score. It is built from your recent rounds, so posting your scores (good and bad) keeps it honest. The exact calculation is run by the handicap system, so use your golf body\'s official method to compute and post.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['handicap = a fair-play number from your recent rounds', 'post the good and the bad to keep it honest', 'let the official system do the exact math'],
    related: ['rules.order-of-play'],
    source: 'rules-of-golf',
  },
];
