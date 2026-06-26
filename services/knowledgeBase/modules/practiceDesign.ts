/**
 * PRACTICE DESIGN — golf-knowledge module (layer 'practice', module 'practice_design').
 *
 * HOW to practice so it actually transfers to the course — the motor-learning /
 * deliberate-practice principles, curated for the time-constrained golfer. This
 * is the WISDOM behind the app's practice features, not a list of them:
 *   - Focus Session = the app's interleaved/random practice runner.
 *   - SmartPlan     = the app's goal/improvement plan.
 *   - Open Range    = quantified "mash" practice.
 * These entries explain WHY the caddie steers you toward random reps, routine,
 * pressure and goals — so it can coach the method, then open the feature.
 *
 * HONESTY (the #1 law): practice METHOD is coaching wisdom → 'coaching_only'
 * across the board. The app can read a swing's tempo/strike/biomech as an
 * OUTCOME, but the design of a practice session is teaching, not a measurement.
 * We never claim a number practice "produces." We UNDER-CLAIM.
 *
 * Pure data — client + server safe.
 */

import type { KBEntry } from '../schema';

const MODULE = 'practice_design';

export const PRACTICE_DESIGN: KBEntry[] = [
  // ══ BLOCK vs RANDOM / INTERLEAVING ════════════════════════════════════════
  {
    id: 'prac.block-vs-random',
    layer: 'practice',
    module: MODULE,
    topic: 'block vs random (interleaved) practice',
    aliases: [
      'how should i practice',
      'block or random practice',
      'whats the best way to practice',
      'should i hit the same club over and over',
      'interleaved practice',
    ],
    principle:
      'Block practice — same club, same target, raking ball after ball — feels great because you improve fast, but it transfers poorly: the course never gives you the same shot twice. Random (interleaved) practice — changing club, target or shot every rep — feels worse in the moment but builds skill that holds up on the course. After a short grooving block, mix it up.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'block feels good, random transfers — the course is random',
      'groove a feel in a small block, then mix targets and clubs',
      'if practice feels too easy, it probably isn\'t sticking',
    ],
    related: ['prac.why-random-transfers', 'prac.focus-session', 'prac.fault-fix-protocol'],
    source: 'motor learning — contextual interference',
  },
  {
    id: 'prac.why-random-transfers',
    layer: 'practice',
    module: MODULE,
    topic: 'why random practice transfers',
    aliases: [
      'why is random practice better',
      'why does mixing it up help',
      'contextual interference',
      'why not just repeat the same shot',
      'why does block practice not transfer',
    ],
    principle:
      'Every shot on the course makes you read, plan, then do. Random practice forces that same read-plan-do loop on every rep, so you\'re rehearsing the actual skill the game demands; block practice deletes the read and plan — you just repeat. That\'s why studies show random groups perform worse during practice but far better on the transfer test that mimics real play.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'the course is read, plan, do — every single shot',
      'random reps rehearse that loop; block reps skip it',
      'worse on the range, better on the course is the trade you want',
    ],
    related: ['prac.block-vs-random', 'prac.routine-reps', 'prac.focus-session'],
    source: 'motor learning — contextual interference / golf reviews',
  },
  {
    id: 'prac.focus-session',
    layer: 'practice',
    module: MODULE,
    topic: 'using Focus Session for interleaved practice',
    aliases: [
      'use focus session',
      'interleave my practice in the app',
      'mix up my practice',
      'random practice in the app',
      'structured practice session',
    ],
    principle:
      'The app\'s Focus Session is your interleaving engine: it structures reps so you change shot, target or club instead of mindlessly raking balls — turning a range bucket into transfer-friendly practice. When you want practice that holds up on the course, run a Focus Session rather than hitting the same club fifty times.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'Focus Session builds the read-plan-do loop into your reps',
      'reach for it instead of raking the same shot',
      'a short focused session beats a long mindless bucket',
    ],
    related: ['prac.why-random-transfers', 'prac.quality-over-quantity', 'prac.open-range-quantify'],
    source: 'app Focus Session',
  },

  // ══ PRACTICE LIKE YOU PLAY ════════════════════════════════════════════════
  {
    id: 'prac.routine-reps',
    layer: 'practice',
    module: MODULE,
    topic: 'practice your pre-shot routine',
    aliases: [
      'should i practice my routine',
      'practice like you play',
      'pre shot routine on the range',
      'how do i practice the routine',
      'make practice game like',
    ],
    principle:
      'Practice like you play: go through your full pre-shot routine — pick a target, see the shot, commit — on the range, not just on the course. Reps without the routine groove a swing you can\'t actually access under the only conditions that count. Even a few fully-routined balls per session transfer better than a bucket of rakers.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'run your full routine on the range, target and all',
      'a few routined balls beat a bucket of rakers',
      'rehearse the player you want to be on the first tee',
    ],
    related: ['prac.pressure-practice', 'prac.why-random-transfers', 'prac.par-18-game'],
    source: 'deliberate practice — game-like reps',
  },
  {
    id: 'prac.pressure-practice',
    layer: 'practice',
    module: MODULE,
    topic: 'pressure / consequence practice',
    aliases: [
      'how do i practice under pressure',
      'pressure practice',
      'practice games',
      'add consequences to practice',
      'why do i play worse than i practice',
    ],
    principle:
      'If "range you" never shows up on the course, you\'re missing pressure. Add a consequence to reps — a score to beat, a streak you can\'t break, a putt you have to make before you leave — so a miss actually costs something. That nervous, can\'t-redo feeling is the exact skill the first tee demands, and games are the easiest way to build it.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'add a score, a streak, or a "can\'t leave until" to make reps matter',
      'pressure is a skill — rehearse the nerves, don\'t avoid them',
      'one ball, one chance is more like golf than ten do-overs',
    ],
    related: ['prac.par-18-game', 'prac.routine-reps', 'prac.skill-vs-technique'],
    source: 'pressure practice / practice games',
  },
  {
    id: 'prac.par-18-game',
    layer: 'practice',
    module: MODULE,
    topic: 'the par-18 short-game game',
    aliases: [
      'par 18 game',
      'up and down practice game',
      'short game practice game',
      'how do i practice getting up and down',
      'chipping and putting game',
    ],
    principle:
      'Par 18 turns short-game practice into pressure golf: pick 9 spots around the green, and from each one chip (or pitch) and then putt out — one ball, no do-overs, trying to get up-and-down for a "par 2." Add your scores for a number out of 18 to beat next time. It rehearses the full up-and-down under consequence, where mid-handicaps save the most strokes.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      '9 spots, chip and putt out, one ball each — score it out of 18',
      'no practice strokes; that\'s what makes it real',
      'beating your own number is the up-and-down skill compounding',
    ],
    related: ['prac.pressure-practice', 'prac.routine-reps', 'prac.skill-vs-technique'],
    source: 'par-18 short-game game',
  },

  // ══ SPACING / QUALITY / SKILL vs TECHNIQUE ════════════════════════════════
  {
    id: 'prac.spacing',
    layer: 'practice',
    module: MODULE,
    topic: 'spaced / distributed practice',
    aliases: [
      'how often should i practice',
      'spaced practice',
      'is it better to practice often',
      'distributed practice',
      'cramming golf practice',
    ],
    principle:
      'Spreading practice out beats cramming. Three short sessions across a week stick better than one long marathon, because the gaps force you to retrieve and rebuild the skill each time — which is exactly what makes it durable. For a busy golfer that\'s good news: little and often is the more effective AND the more doable plan.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'little and often beats one long cram session',
      'the gaps between sessions are part of the learning',
      'three short hits a week is plenty when they\'re focused',
    ],
    related: ['prac.quality-over-quantity', 'prac.make-it-stick', 'prac.track-and-goals'],
    source: 'motor learning — distributed practice',
  },
  {
    id: 'prac.skill-vs-technique',
    layer: 'practice',
    module: MODULE,
    topic: 'skill practice vs technique practice',
    aliases: [
      'skill vs technique',
      'should i work on my swing or my scoring',
      'technique practice',
      'practice the swing or the shot',
      'why does my range swing not work on the course',
    ],
    principle:
      'Technique practice grooves a movement (a feel, a position) in a calm, repetitive block. Skill practice trains hitting a target on demand, with a routine and a consequence. You need both — but most golfers over-do technique and never bridge to skill, which is why the range swing vanishes on the course. Groove the move, then earn it under target and pressure.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'technique = groove the feel; skill = hit the target on demand',
      'most golfers stall in technique and never bridge to skill',
      'finish every technique block with target-and-routine reps',
    ],
    related: ['prac.fault-fix-protocol', 'prac.routine-reps', 'prac.pressure-practice'],
    source: 'skill vs technique practice (Adam Young-style)',
  },
  {
    id: 'prac.quality-over-quantity',
    layer: 'practice',
    module: MODULE,
    topic: 'quality over quantity for the busy golfer',
    aliases: [
      'i dont have much time to practice',
      'quality over quantity practice',
      'short on time practice',
      'how to practice with little time',
      'make the most of limited practice',
    ],
    principle:
      'If your time is tight, intent matters more than volume. Thirty focused balls — each with a target, a routine and a moment of feedback — beat a mindless large bucket. Pick ONE thing to work on per session, give every rep your full attention, and stop when focus fades. Honest, deliberate reps are what move the needle for a time-constrained golfer.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'one focus per session, full attention per rep',
      '30 deliberate balls beat 100 mindless ones',
      'stop when your focus fades — tired reps groove sloppy ones',
    ],
    related: ['prac.spacing', 'prac.focus-session', 'prac.track-and-goals'],
    source: 'deliberate practice for the time-constrained golfer',
  },

  // ══ FAULT FIX / GOALS / MAKE IT STICK ═════════════════════════════════════
  {
    id: 'prac.fault-fix-protocol',
    layer: 'practice',
    module: MODULE,
    topic: 'how to practice a fault fix',
    aliases: [
      'how do i fix a fault in practice',
      'how to groove a swing change',
      'practice a fix',
      'how do i make a swing change stick',
      'drill then test',
    ],
    principle:
      'Fix a fault in two phases. First GROOVE it: slow, blocked, low-pressure reps (often with a drill) until the new feel is repeatable. Then TEST it: take the feel into random, full-routine, target-and-consequence reps. A change that only survives the groove phase isn\'t learned yet — it has to hold up under the messiness of real golf before you trust it on the course.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'phase 1: groove the feel slow and blocked',
      'phase 2: test it random, full routine, with a target',
      'a fix isn\'t real until it survives messy, mixed reps',
    ],
    related: ['prac.block-vs-random', 'prac.skill-vs-technique', 'prac.make-it-stick'],
    source: 'motor learning — groove then transfer',
  },
  {
    id: 'prac.track-and-goals',
    layer: 'practice',
    module: MODULE,
    topic: 'tracking and goals (SmartPlan)',
    aliases: [
      'should i set practice goals',
      'how do i know if im improving',
      'track my practice',
      'practice goals',
      'make a practice plan',
    ],
    principle:
      'Aimless practice drifts; a goal gives every session a job. Decide what you\'re trying to move (a fault, a scoring zone, a number to beat) and track it so you can see progress and stay honest. The app\'s SmartPlan turns that into a goal-driven plan, and the points/history give you a real ledger of whether the work is landing.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: [
      'every session needs a job — pick what you\'re moving',
      'SmartPlan turns the goal into a plan you can follow',
      'tracking keeps you honest about what\'s actually improving',
    ],
    related: ['prac.quality-over-quantity', 'prac.make-it-stick', 'prac.spacing'],
    source: 'app SmartPlan / goal-driven practice',
  },
  {
    id: 'prac.make-it-stick',
    layer: 'practice',
    module: MODULE,
    topic: 'make-it-stick principles',
    aliases: [
      'how do i make practice stick',
      'why do i forget what i practiced',
      'make golf practice stick',
      'retain what i practice',
      'effortful practice',
    ],
    principle:
      'Learning that lasts feels harder while you\'re doing it. Spacing, mixing shots, testing yourself and a little struggle all feel less smooth than block reps — but that desirable difficulty is exactly what builds durable skill. If practice always feels easy and fluent, you\'re probably performing, not learning. Embrace the messy reps; that\'s where the gains live.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: [
      'durable learning feels effortful — that\'s the point',
      'space it, mix it, test it, let it be a little messy',
      'smooth and easy is performing; struggle is learning',
    ],
    related: ['prac.spacing', 'prac.block-vs-random', 'prac.fault-fix-protocol'],
    source: 'make-it-stick / desirable difficulty',
  },
];
