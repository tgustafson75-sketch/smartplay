/**
 * BALL FLIGHT — golf-knowledge module (layer 'ball_flight').
 *
 * The ball-flight laws the caddie reasons with:
 *   - START DIRECTION ≈ where the FACE points at impact,
 *   - CURVE ≈ the FACE-TO-PATH relationship,
 *   - GEAR EFFECT off-center (for a RH player: toe strike → draw/hook bias,
 *     heel strike → fade/slice bias).
 *
 * HONESTY: from confirmed tracked shots the app sees a left/right + long/short
 * DISPERSION pattern (`tracked_dispersion`) — that's directional evidence of a
 * tendency, NOT a launch-monitor read of face/path/spin. Everything stays
 * directional or coaching_only; we never claim a measured face or path.
 */

import type { KBEntry } from '../schema';

const MODULE = 'ball_flight';

export const BALL_FLIGHT: KBEntry[] = [
  {
    id: 'bf.start-direction-face',
    layer: 'ball_flight',
    module: MODULE,
    topic: 'start direction = face',
    aliases: ['why does my ball start left', 'why does my ball start right', 'start direction', 'ball starts offline', 'where does the ball start'],
    principle:
      'The ball starts very close to where the clubFACE points at impact (with the driver it’s ~85% face). So if it starts left or right of your aim, look at the face first — a wrong start line is a face problem, not a path problem.',
    appSignals: ['tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['start line = face', 'fix the start before the curve'],
    related: ['bf.face-to-path', 'setup.grip.neutral'],
    source: 'ball-flight-laws',
  },
  {
    id: 'bf.face-to-path',
    layer: 'ball_flight',
    module: MODULE,
    topic: 'curve = face-to-path',
    aliases: ['why does my ball curve', 'slice or hook', 'draw vs fade', 'why do i slice', 'why do i hook', 'how to hit a draw', 'how to hit a fade'],
    principle:
      'Curve comes from the face RELATIVE to the path. Face open to the path curves it away from a righty (fade/slice); face closed to the path curves it toward (draw/hook). To shape it on purpose, control the gap between where the face points and where the club is travelling.',
    appSignals: ['tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['face open to path = fade/slice', 'face closed to path = draw/hook', 'shape = the gap'],
    related: ['bf.start-direction-face', 'fs.transition.over-the-top', 'bf.gear-effect'],
    source: 'ball-flight-laws',
  },
  {
    id: 'bf.gear-effect',
    layer: 'ball_flight',
    module: MODULE,
    topic: 'gear effect off-center',
    aliases: ['gear effect', 'toe hook', 'heel slice', 'off center curve', 'why does a toe strike draw', 'mishit curve'],
    principle:
      'Off-center strikes add their own curve (gear effect), strongest with the driver. For a righty, a toe strike imparts draw/hook spin and a heel strike imparts fade/slice spin. A surprise curve can be a strike-location problem, not a swing change.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['toe = draw bias', 'heel = fade bias', 'check the strike before the swing'],
    related: ['contact.dispersion-centroid', 'bf.face-to-path'],
    source: 'ball-flight-laws',
  },
  {
    id: 'bf.diagnose-from-pattern',
    layer: 'ball_flight',
    module: MODULE,
    topic: 'diagnosing from your shot pattern',
    aliases: ['my misses', 'my shot pattern', 'i tend to miss', 'whats my tendency', 'two way miss'],
    principle:
      'Your repeating shot SHAPE is the most reliable clue to the cause. A consistent one-way curve points to a stable face-to-path relationship to adjust; a two-way miss points to a timing/face-control issue, not an aim fix. Diagnose the pattern, not the last bad shot.',
    appSignals: ['tracked_dispersion'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['read the pattern, not one shot', 'one-way curve = adjustable', 'two-way miss = timing'],
    related: ['bf.face-to-path', 'cm.dispersion-cone'],
    source: 'ball-flight-laws',
  },
];
