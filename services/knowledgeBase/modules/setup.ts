/**
 * SETUP — golf-knowledge module (layer 'setup').
 *
 * The Priority-5 ROOT inputs (grip, alignment, ball position, posture, distance
 * from ball). These are the earliest correctable constraints in the swing — a
 * setup error forces a compensation, so the causal engine ranks them highest.
 *
 * HONESTY: the app can read setup geometry only from a still address frame via
 * pose (Setup Check) → `pose_biomech` directional at best. Most cue-level
 * coaching here is `coaching_only`.
 */

import type { KBEntry } from '../schema';

const MODULE = 'setup';

export const SETUP: KBEntry[] = [
  {
    id: 'setup.grip.neutral',
    layer: 'setup',
    module: MODULE,
    topic: 'grip — strong / weak / neutral',
    aliases: ['grip', 'how should i hold the club', 'strong grip', 'weak grip', 'neutral grip', 'my grip'],
    principle:
      'Grip sets the default face angle. A neutral grip shows about two knuckles of the lead hand and the V’s pointing to the trail shoulder. Stronger (more rotated away from target) closes the face and fights a slice; weaker opens it and fights a hook.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['two knuckles showing', "V’s to the trail shoulder", 'strong fights a slice, weak fights a hook'],
    related: ['bf.start-direction-face', 'setup.alignment'],
    source: 'setup-fundamentals',
  },
  {
    id: 'setup.alignment',
    layer: 'setup',
    module: MODULE,
    topic: 'alignment',
    aliases: ['alignment', 'aim', 'how do i aim', 'i keep aiming wrong', 'lining up', 'check my alignment'],
    principle:
      'Aim the clubface at the target FIRST, then set the body parallel-left of that line (right of it for a lefty) — feet, hips and shoulders on a railroad track. Most "swing" misses are really an alignment that points the swing somewhere else.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['face to target first', 'body parallel-left', 'pick an intermediate spot a foot ahead'],
    related: ['setup.ball-position', 'cm.commitment', 'psych.intention-over-avoidance'],
    source: 'setup-fundamentals',
  },
  {
    id: 'setup.ball-position',
    layer: 'setup',
    module: MODULE,
    topic: 'ball position',
    aliases: ['ball position', 'where do i put the ball', 'ball too far forward', 'ball too far back'],
    principle:
      'Ball position moves the low point of the strike. Driver forward off the lead heel to catch it on the up; irons progressively back toward center for ball-first contact; wedges near center. Too far forward adds loft and a thin/pull; too far back delofts and pushes.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['driver off the lead heel', 'irons toward center', 'wedges center'],
    related: ['contact.ball-position-calibration', 'setup.posture'],
    source: 'setup-fundamentals',
  },
  {
    id: 'setup.posture',
    layer: 'setup',
    module: MODULE,
    topic: 'posture',
    aliases: ['posture', 'spine angle', 'how should i stand', 'bend from the hips', 'address posture'],
    principle:
      'Tilt from the hips (not a rounded back), let the arms hang under the shoulders, flex the knees slightly and balance over the middle of the feet. Good posture lets the body rotate — a slumped or too-upright setup forces the arms to take over.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['hinge from the hips', 'arms hang free', 'athletic, balanced, ready'],
    related: ['setup.distance-from-ball', 'fs.transition.early-extension'],
    source: 'setup-fundamentals',
  },
  {
    id: 'setup.distance-from-ball',
    layer: 'setup',
    module: MODULE,
    topic: 'distance from ball',
    aliases: ['distance from the ball', 'how far do i stand from the ball', 'too close to the ball', 'too far from the ball', 'reaching for the ball'],
    principle:
      'Stand so the arms hang naturally with about a hand-width between the hands and the body. Too close crowds the arms and steepens the swing (toe contact); too far makes you reach and lunge (heel/shank). Let posture set the distance, not the reach.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['a hand-width to the hands', 'arms hang, don’t reach', 'let posture set the distance'],
    related: ['setup.posture', 'contact.dispersion-centroid'],
    source: 'setup-fundamentals',
  },
];
