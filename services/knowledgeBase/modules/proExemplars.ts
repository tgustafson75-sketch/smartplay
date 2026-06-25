/**
 * PRO EXEMPLARS — golf-knowledge module (layer 'full_swing', module 'pro_model').
 *
 * The "plays-like-a-pro" KNOWLEDGE layer: signature pro moves curated as
 * aspirational TARGETS the caddie can DESCRIBE, hold up as a model, and
 * prescribe a FEEL + DRILL toward. This is the knowledge companion to
 * services/swingComparisonEngine.ts (CompareKind 'self_vs_pro' + tour-median
 * bank): that engine eventually scores pose against pro references; THIS module
 * is the words — what the move is, why it works, and how to chase it by feel.
 *
 * ── THE HONESTY LINE (the #1 law for this module) ─────────────────────────
 * We can DESCRIBE a pro's signature move and use it as a model to emulate by
 * FEEL. We CANNOT yet measure "your backswing vs Rose's" frame-by-frame (pose
 * fidelity is directional at best and there is no real pro-pose bank loaded).
 * So:
 *   - EVERY entry is honesty 'coaching_only' or at most 'directional'.
 *   - NOTHING is 'measurable'. No "you're 12° off Hogan" claims, ever.
 *   - appSignals is ['none'] for most; ['pose_tempo'] appears ONLY on the
 *     tempo/rhythm exemplars as a LOOSE directional cue (the app can roughly
 *     read your tempo ratio via pose — never a comparison to the pro).
 *   - The principle text frames the pro as a MODEL TO COPY BY FEEL, not a
 *     measured target. The caddie sells the feel, then a drill toward it.
 *
 * ── APP LENS: MID / HIGH HANDICAP ─────────────────────────────────────────
 * Every exemplar is chosen because an AMATEUR can copy the FEEL — tempo,
 * balance, one-piece move, full turn, centeredness, smooth transition,
 * effortless rhythm, a held finish, a controllable knockdown. NOT tour-only
 * positions a 20-handicap can't replicate. Growth coaching throughout: here's
 * the move, here's the feel, here's the drill that moves you toward it.
 *
 * `related[]` links to real ids in fullSwing.ts, contact.ts, putting.ts,
 * drills.ts, and the Smart Tempo app feature ('smart-tempo' in appCatalog.ts).
 * Pure data — client + server safe.
 */

import type { KBEntry } from '../schema';

const MODULE = 'pro_model';

export const PRO_EXEMPLARS: KBEntry[] = [
  // ══ TEMPO / RHYTHM (the time-constrained golfer's friend) ════════════════
  {
    id: 'pro.tempo.syrup',
    layer: 'full_swing',
    module: MODULE,
    topic: 'syrup tempo — Els / Couples smoothness',
    aliases: [
      'i want a swing like ernie els',
      'smooth swing like couples',
      'syrup tempo',
      'how do i swing smooth',
      'effortless swing',
      'big easy swing',
    ],
    principle:
      'Ernie Els ("The Big Easy") and Fred Couples are the templates for unhurried, rhythmic power: the club swings at one constant rhythm on BOTH sides of the ball, never a snatch back or a lunge from the top. It works because smooth lets the body sequence properly — the speed shows up at the bottom where it counts, not at the top where it wrecks contact. The amateur feel to copy: swing at about 80% effort and let it FLOW; "smooth is fast." This is the single most copyable pro trait for a mid/high handicap, and it costs no athleticism.',
    appSignals: ['pose_tempo'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: swing at 80%, let it flow — smooth is fast',
      'drill: pause-at-the-top reps to feel the unhurried transition (drill.pause-at-top)',
      'target: the classic ~3:1 backswing-to-downswing ratio Smart Tempo reads',
    ],
    related: ['drill.pause-at-top', 'fs.finish.balance', 'fault.rushed-tempo', 'smart-tempo'],
    source: 'Ernie Els / Fred Couples — tempo & rhythm lineage',
  },
  {
    id: 'pro.tempo.soft-hands',
    layer: 'full_swing',
    module: MODULE,
    topic: 'soft grip pressure — Couples relaxed hands',
    aliases: [
      'how do i get clubhead speed without trying',
      'soft hands like couples',
      'grip pressure for power',
      'i grip too tight',
      'relaxed swing',
    ],
    principle:
      'Fred Couples\' power secret was light grip pressure: "the tighter you hold anything, the slower you\'ll be — you need to be soft and supple to create clubhead speed." Tension freezes the wrists and arms; soft hands let the club whip and the body lead. The amateur feel to copy: grip soft enough that the club could almost be pulled out of your hands at address, and let that looseness stay through the swing. A tension fix is one of the fastest, most honest gains a stressed/rushed golfer can make.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: grip pressure ~4 out of 10, hold it like a bird',
      'drill: waggle a few times to drain tension before the takeaway',
      'feel: soft hands let the club swing — let the body, not the grip, run the show',
    ],
    related: ['pro.tempo.syrup', 'setup.grip.neutral', 'psych.over-control'],
    source: 'Fred Couples — grip pressure / relaxation lineage',
  },

  // ══ TAKEAWAY / TURN / WIDTH ══════════════════════════════════════════════
  {
    id: 'pro.takeaway.one-piece',
    layer: 'full_swing',
    module: MODULE,
    topic: 'one-piece takeaway — wide, connected first move',
    aliases: [
      'one piece takeaway',
      'how do pros start the swing',
      'wide takeaway',
      'low and slow takeaway',
      'first move back like a pro',
    ],
    principle:
      'The classic pro first move: shoulders, arms and club move away together in one piece — low, slow and WIDE — so width and plane are set before the hands ever get involved. It works because a connected start removes the mid-swing correction a handsy snatch forces. The amateur feel to copy: "push" the club back with the lead shoulder and keep a wide triangle for the first foot of the swing. (Note: a few tour players let the clubhead move first — for a mid/high handicap, the one-piece feel is the safer, more repeatable model.)',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: lead shoulder pushes the club back, wide triangle for the first foot',
      'drill: low-and-slow one-piece reps, then add the turn (fs.architecture.takeaway)',
      'feel: set width early — no snatch, no hands',
    ],
    related: ['fs.architecture.takeaway', 'fs.architecture.connection', 'fs.architecture.shoulder-turn'],
    source: 'Justin Rose / classic one-piece lineage',
  },
  {
    id: 'pro.turn.full-coil',
    layer: 'full_swing',
    module: MODULE,
    topic: 'full turn — complete the backswing, coil to the target',
    aliases: [
      'i want a swing like justin rose',
      'how do i make a full turn',
      'turn my back to the target',
      'complete backswing',
      'better coil',
    ],
    principle:
      'Pros complete the backswing — the back turns to the target and the lead shoulder gets behind the ball — finishing the TURN before the downswing starts. It works because the coil against a stable lower body stores the power and lets the arms stay passive, so you don\'t have to swing harder to find speed. The amateur feel to copy: feel your back face the target at the top, unhurried, and let the turn (not a lift or a longer arm-swing) make the length. The time-constrained golfer\'s win: a full, smooth turn beats a fast, short one every time.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: turn your back to the target, lead shoulder behind the ball',
      'drill: feet-together swings to coil over a stable center (drill.feet-together)',
      'feel: complete the turn before you start down — no rush',
    ],
    related: ['fs.architecture.shoulder-turn', 'fs.architecture.takeaway', 'drill.feet-together'],
    source: 'Justin Rose / full-coil lineage',
  },

  // ══ CENTEREDNESS / STABILITY ═════════════════════════════════════════════
  {
    id: 'pro.centered.steady-head',
    layer: 'full_swing',
    module: MODULE,
    topic: 'staying centered — Hogan steady head, no sway',
    aliases: [
      'i want a swing like ben hogan',
      'how do i stop swaying',
      'keep my head still',
      'stay centered swing',
      'rock steady head like hogan',
    ],
    principle:
      'Ben Hogan\'s swing is the model for a centered, rotary motion: a rock-steady head and a body that ROTATES rather than slides off the ball (his weight loaded into a braced trail foot, not the outside of it). It works because turning around a stable center keeps the low point repeatable — the cure for fat, thin and the wandering strike. The honest amateur feel to copy: turn into a braced trail leg and keep your nose roughly over the ball; don\'t FORCE the head still (that locks you up) — let good rotation produce the stillness. (Even Hogan\'s head shifted a touch — copy the centeredness, not a frozen statue.)',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: turn into a braced trail leg, nose stays roughly over the ball',
      'drill: alignment stick outside the trail hip — coil without bumping it (drill.trail-hip-wall)',
      'feel: rotate around a center, don\'t slide off it — and don\'t force the head still',
    ],
    related: ['drill.trail-hip-wall', 'drill.feet-together', 'fault.sway', 'contact.low-point'],
    source: 'Ben Hogan — centered rotation / steady-head lineage',
  },
  {
    id: 'pro.compression.body-leads',
    layer: 'full_swing',
    module: MODULE,
    topic: 'pivot compression — body delivers the club (Hogan)',
    aliases: [
      'how do pros compress the ball',
      'hit it like hogan',
      'body leads the downswing',
      'compress my irons',
      'flush my irons like a pro',
    ],
    principle:
      'Hogan taught the downswing as a rotation led by the hips, with minimal conscious hands — the body delivers the club so the hands don\'t have to flip to square it. It works because a body-led strike puts the hands ahead of the ball with the shaft leaning forward = compression, not a scoop. The amateur feel to copy: start down by turning the lead hip and chest toward the target and let the arms come along for the ride; feel the BODY hit the ball, not the hands. This directly fights casting and the flip a mid-handicapper leaks speed to.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: lead hip and chest turn toward the target to start down — body delivers, not hands',
      'drill: impact-bag reps — hands ahead, shaft leaning, body driving in (drill.impact-bag)',
      'feel: rotate through to a full finish, the hands stay quiet',
    ],
    related: ['drill.impact-bag', 'contact.compression', 'fs.transition.casting', 'fs.transition.stall'],
    source: 'Ben Hogan — pivot compression lineage',
  },

  // ══ TRANSITION PATIENCE / EFFORTLESS POWER ═══════════════════════════════
  {
    id: 'pro.transition.patience',
    layer: 'full_swing',
    module: MODULE,
    topic: 'transition patience — no rush from the top',
    aliases: [
      'how do i stop rushing from the top',
      'patient transition',
      'no rush from the top',
      'transition like a pro',
      'i come over the top because i rush',
    ],
    principle:
      'The signature pro move at the top is PATIENCE — the backswing finishes, then the lower body unhurriedly starts down while the club still feels like it\'s "waiting." It works because letting the ground/hips lead lets the club drop to the inside instead of being thrown over the top by an early upper-body fire — the root cause of the amateur slice. The feel to copy: feel like there\'s a tiny beat at the top where nothing rushes, then the lead foot/hips begin. This is rhythm AND path in one move, and it suits the golfer who\'s tense or in a hurry.',
    appSignals: ['pose_tempo'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: a tiny beat at the top — let the club "wait," then the hips start',
      'drill: pause-at-the-top + pump/shallow reps (drill.pause-at-top, drill.pump-transition)',
      'feel: ground up, not arms first — patience shallows the club',
    ],
    related: ['drill.pause-at-top', 'drill.pump-transition', 'fs.transition.over-the-top', 'smart-tempo'],
    source: 'transition-sequence lineage (Els/Couples-style unhurried top)',
  },
  {
    id: 'pro.power.effortless',
    layer: 'full_swing',
    module: MODULE,
    topic: 'effortless power — rhythm over force',
    aliases: [
      'how do pros hit it so far without trying',
      'effortless power',
      'rhythm over power',
      'i swing too hard',
      'how do i stop trying to kill it',
    ],
    principle:
      'The "effortless power" pros show isn\'t lighter effort — it\'s effort spent in the RIGHT order: a smooth, swinging motion (not a tense turn) builds speed that arrives at impact, so the swing looks slow but the ball goes. It works because tension and over-swinging burn speed and scatter contact; sequencing and looseness convert what you have into distance. The amateur feel to copy: SWING the club, don\'t HIT at the ball — almost every great player starts by swinging the club back, not by muscling the body. For a stressed/rushed golfer, dialing effort DOWN usually adds distance.',
    appSignals: ['pose_tempo'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: swing the club, don\'t hit at the ball',
      'drill: hit balls at 80% and watch the ball go FARTHER, not shorter',
      'feel: looseness + sequence = speed; tension + force = a slice',
    ],
    related: ['pro.tempo.syrup', 'pro.tempo.soft-hands', 'fs.finish.balance', 'smart-tempo'],
    source: 'effortless-power / swing-vs-hit lineage',
  },

  // ══ FINISH / BALANCE ═════════════════════════════════════════════════════
  {
    id: 'pro.finish.balanced-hold',
    layer: 'full_swing',
    module: MODULE,
    topic: 'balanced finish — hold it like a tour player',
    aliases: [
      'how do i finish like a pro',
      'balanced finish',
      'hold my finish',
      'pose like a tour player',
      'why cant i hold my finish',
    ],
    principle:
      'Tour players finish in balance and HOLD it — weight stacked over the lead leg, belt buckle to the target, trail heel up, posing until the ball lands. Justin Rose\'s tell: with a controlled, balanced finish he says he "never hits a bad shot." It works because a held finish is the PROOF the swing was sequenced and on-effort — you can\'t hold a finish you over-swung or fell out of. The amateur feel to copy: make a finish you can hold for three seconds the GOAL of every swing, and let that goal dial back the effort to where balance lives. The most honest self-feedback in golf — and a confidence cue for the time-pressed player.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: pose the finish for three seconds — weight on the lead leg, trail heel up',
      'drill: swing only as hard as you can finish balanced (drill.feet-together)',
      'feel: if you can\'t hold it, something earlier was over-effort — dial it back',
    ],
    related: ['fs.finish.balance', 'drill.feet-together', 'pro.power.effortless', 'psych.over-control'],
    source: 'Justin Rose / tour balanced-finish lineage',
  },

  // ══ SHOT-MAKING (a controllable shot, not a tour-only position) ══════════
  {
    id: 'pro.shot.stinger',
    layer: 'full_swing',
    module: MODULE,
    topic: 'the stinger / knockdown — a controllable low shot (Tiger)',
    aliases: [
      'how do i hit a stinger',
      'tiger stinger shot',
      'knockdown shot',
      'low punch shot',
      'how do i hit it low into the wind',
      'controllable tee shot',
    ],
    principle:
      'Tiger\'s stinger is a low, controlled tee/long shot — a knockdown that takes the big miss out of play in wind or off a tight hole. The copyable version for an amateur is the KNOCKDOWN: take an extra club, grip down, ball a touch back, weight a little forward and STAYING there, then a shorter, quieter follow-through (Tiger feels like he stops his hands just after impact). It works because grip-down + abbreviated finish = less loft, less spin, less curve — a repeatable, lower-risk shot. Start small: chip-height, then 30, then 60 yards, building the abbreviated-finish feel. A go-to for the golfer who wants control over hero distance.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: [
      'feel: extra club, grip down, ball center-back, weight forward and stays there',
      'feel: a shorter, quieter finish — "stop the hands" just after impact (the lower you want it, the shorter the finish)',
      'drill: build it from chip height up to 30/60/100 yards, same abbreviated feel',
    ],
    related: ['setup.ball-position', 'contact.compression', 'cm.commitment', 'sg.chip.club-selection'],
    source: 'Tiger Woods — stinger / knockdown lineage',
  },

  // ══ PUTTING (free, fluid release) ════════════════════════════════════════
  {
    id: 'pro.putt.free-release',
    layer: 'full_swing',
    module: MODULE,
    topic: 'putting — a free, fluid, tension-free stroke (Faxon/Stockton/Roberts)',
    aliases: [
      'how do the best putters putt',
      'putt like brad faxon',
      'free release putting',
      'smooth putting stroke',
      'tension free putting',
      'fluid putting stroke',
    ],
    principle:
      'The best putters ever — Faxon, Stockton, Loren "Boss of the Moss" Roberts — share a FREE, fluid, tension-free stroke: continuous motion, soft hands, and a confident roll on the chosen line rather than a steered, guided hit. It works because tension and over-steering are what push and pull short putts; a free release lets the putter swing and the ball start on line. The amateur feel to copy: keep SOMETHING moving (a soft waggle/forward press into a flowing stroke), light grip, and let the putter release down your line — pick a line, trust it, roll it. Confidence and flow beat mechanics on the greens.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'feel: light grip, continuous flowing motion — never a steered, guided hit',
      'drill: roll putts through a two-tee gate, face square, free release (drill.gate-putting)',
      'feel: pick your line, trust it, let the putter release down it',
    ],
    related: ['drill.gate-putting', 'putt.stroke.pendulum', 'putt.stroke.face-square', 'putt.routine.short'],
    source: 'Faxon / Stockton / Loren Roberts — free-release putting lineage',
  },
];
