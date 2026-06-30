/**
 * PRACTICE FOCUSES — golf-knowledge module (layer 'practice', module 'practice_focuses').
 *
 * 2026-06-30 (Tim) — the six Focus Session focuses (irons / short game / driver-distance /
 * driver-speed / hands-transition / putting) as CONTENT the caddie knows: what each focus
 * trains, which clubs + camera view fit it, and what Smart Motion actually reads for it. So
 * when the player asks for a focus ("let's work on driver for distance"), the caddie can
 * coach the method AND that focus becomes the lens the swing is analyzed against.
 *
 * Mirrors services/practice/sessionPlan.ts PRACTICE_FOCUSES (clubs/view/emphasis/intent) so
 * the knowledge and the runner stay one source of truth in spirit.
 *
 * HONESTY: practice METHOD is coaching wisdom → 'coaching_only'. Smart Motion reads the
 * OUTCOME (tempo / start direction / contact) but the design of a focus is teaching, not a
 * measurement. We never claim a number a focus "produces."
 *
 * Pure data — client + server safe.
 */

import type { KBEntry } from '../schema';

const MODULE = 'practice_focuses';

export const PRACTICE_FOCUSES_KB: KBEntry[] = [
  {
    id: 'focus.irons',
    layer: 'practice',
    module: MODULE,
    topic: 'irons focus — strike + start line',
    aliases: ['work on irons', 'iron focus', 'irons focus', 'dial in my irons', 'practice irons', 'iron striking'],
    principle:
      'The irons focus grooves strike and start line, then rotates clubs (7-iron, 9-iron, 5-iron, 8-iron) so it transfers instead of becoming a one-club groove. Filmed down-the-line. Smart Motion reads your tempo, start direction and contact — the read is graded against "did the strike and start line hold as you changed clubs?"',
    appSignals: ['tempo', 'start_direction', 'contact'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['groove strike, then change clubs so it sticks', 'start line first — shape comes after', 'down-the-line shows the path that starts the ball'],
    related: ['focus.hands_transition', 'prac.block-vs-random'],
    source: 'app Focus Session — irons',
  },
  {
    id: 'focus.short_game',
    layer: 'practice',
    module: MODULE,
    topic: 'short game focus — contact + distance control',
    aliases: ['work on short game', 'short game focus', 'wedges', 'practice wedges', 'chipping and pitching focus', 'dial in my wedges'],
    principle:
      'The short-game focus trains contact and distance feel with the wedges (PW, GW, SW), varying the carry every few balls instead of one stock wedge — feel different distances. Filmed down-the-line. This is the one place phone ball-flight stays in frame, so contact quality is the honest read.',
    appSignals: ['contact', 'tempo'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['change the carry every few balls — never the same wedge twice', 'contact before distance', 'feel the number, then check it'],
    related: ['focus.putting', 'prac.block-vs-random'],
    source: 'app Focus Session — short game',
  },
  {
    id: 'focus.driver_distance',
    layer: 'practice',
    module: MODULE,
    topic: 'driver for distance — target + commit',
    aliases: ['work on driver for distance', 'driver distance focus', 'driver for distance', 'practice driver', 'hit drivers', 'bomb it', 'driver focus'],
    principle:
      'Driver-for-distance is about committing to a target and shaping to it — change your aim point so you practice shaping, not just bombing. Filmed down-the-line. Smart Motion reads tempo and start direction; the lens is "did you commit and start it on your chosen line," not raw yards.',
    appSignals: ['start_direction', 'tempo'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['pick a target and commit — every ball', 'move the aim point so you practice shaping', 'start line over speed here'],
    related: ['focus.driver_speed', 'focus.irons'],
    source: 'app Focus Session — driver distance',
  },
  {
    id: 'focus.driver_speed',
    layer: 'practice',
    module: MODULE,
    topic: 'driver for speed — overspeed bursts',
    aliases: ['work on driver speed', 'driver speed focus', 'driver for speed', 'swing speed', 'speed training', 'overspeed', 'get faster'],
    principle:
      'Driver-for-speed trains clubhead speed in short overspeed bursts with the driver. HONEST: Smart Motion reads your tempo and an ESTIMATED ball speed from the trace/acoustics — not radar. So it tracks the trend and tempo under speed, not a launch-monitor number.',
    appSignals: ['tempo', 'ball_speed_estimate'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['short bursts, full rest — speed is a sprint not a marathon', 'keep tempo even as you add speed', 'estimated speed shows the trend, not a radar number'],
    related: ['focus.driver_distance', 'focus.hands_transition'],
    source: 'app Focus Session — driver speed',
  },
  {
    id: 'focus.hands_transition',
    layer: 'practice',
    module: MODULE,
    topic: 'hands / transition — tempo over force',
    aliases: ['work on transition', 'hands and transition focus', 'transition focus', 'work on my tempo', 'tempo focus', 'sequence', 'smooth transition'],
    principle:
      'The hands/transition focus is about feeling the transition — tempo over force — alternating a control club (7-iron) and the driver so the smooth sequence carries into the big swing. Filmed down-the-line. Tempo (the 3:1 backswing-to-downswing feel) is the headline read here.',
    appSignals: ['tempo', 'transition'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['tempo, not force — let it fall into the slot', 'alternate the 7-iron and driver so the feel carries', 'top of the backswing is the moment that sets it'],
    related: ['focus.irons', 'focus.driver_speed', 'tempo'],
    source: 'app Focus Session — hands / transition',
  },
  {
    id: 'focus.putting',
    layer: 'practice',
    module: MODULE,
    topic: 'putting focus — start line + speed',
    aliases: ['work on putting', 'putting focus', 'practice putting', 'dial in my putting', 'putting stroke', 'lag putting', 'start line putting'],
    principle:
      'The putting focus trains start line and speed control with the putter, changing the distance often instead of the same putt on repeat. Filmed face-on (the putt view). The read is contact + start line — honest about what the phone can see from face-on, not green-read or break.',
    appSignals: ['contact', 'start_direction'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['change the distance every few putts — never the same putt twice', 'start line and speed, in that order', 'face-on shows the stroke path and contact'],
    related: ['focus.short_game'],
    source: 'app Focus Session — putting',
  },
];
