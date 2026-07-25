/**
 * CONTACT — golf-knowledge module (layer 'contact').
 *
 * The Golf-Father triad for diagnosing and fixing strike quality:
 *   1. T2T ball-position calibration (toe-to-toe / center the low point),
 *   2. impact-tape DISPERSION CENTROID (the PATTERN center, not one strike —
 *      heel-biased pattern = standing too close, toe-biased = too far),
 *   3. three-blade turf low-point (where the divot starts vs the ball).
 *
 * HONESTY: the app's mic gives impact TIMING and rough loudness
 * (`acoustic_strike`) and pose gives a low-point PROXY (`pose_biomech`). It does
 * NOT read precise strike location on the face — so location work stays
 * directional/coaching, never "measured."
 */

import type { KBEntry } from '../schema';

const MODULE = 'contact';

export const CONTACT: KBEntry[] = [
  {
    id: 'contact.ball-position-calibration',
    layer: 'contact',
    module: MODULE,
    topic: 'T2T ball-position calibration',
    aliases: ['ball position contact', 'fat and thin', 'i hit it fat', 'i hit it thin', 'center my contact', 'inconsistent contact'],
    principle:
      'Fat and thin are usually a low-point that wanders relative to the ball. Calibrate ball position so the bottom of the arc is at or just ahead of the ball, then keep your sternum stacked over it through impact — ball-first, ground-second.',
    appSignals: ['acoustic_strike', 'pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['low point at/just past the ball', 'sternum over the ball', 'ball first, then turf'],
    related: ['contact.low-point', 'setup.ball-position'],
    source: 'golf-father',
  },
  {
    id: 'contact.dispersion-centroid',
    layer: 'contact',
    module: MODULE,
    topic: 'impact-tape dispersion centroid',
    aliases: ['impact tape', 'strike location', 'where am i hitting it on the face', 'toe strikes', 'heel strikes', 'off the toe', 'off the heel'],
    principle:
      'Read the CENTER of your strike pattern, not one good or bad hit. A heel-biased centroid usually means you’re standing too close (or casting out); a toe-biased centroid means too far away (or pulling in). Move the pattern toward the center before chasing any one strike.',
    appSignals: ['none'],
    honesty: 'coaching_only',
    cnsPersonalize: [],
    coachingCues: ['read the pattern center, not one strike', 'heel = too close', 'toe = too far'],
    related: ['setup.distance-from-ball', 'bf.gear-effect', 'contact.low-point'],
    source: 'golf-father',
  },
  {
    id: 'contact.low-point',
    layer: 'contact',
    module: MODULE,
    topic: 'three-blade turf low-point',
    aliases: ['low point', 'divot', 'where should my divot start', 'i take divots behind the ball', 'turf contact', 'ground contact'],
    principle:
      'The divot should START at the ball and point toward the target — that proves a forward low point. Use the "three-blade" check: lay tees or a line and confirm the turf interaction begins just in front of the ball. A divot behind the ball is the fat/thin root.',
    appSignals: ['pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['divot starts at the ball', 'divot points at the target', 'forward low point'],
    related: ['contact.ball-position-calibration', 'fs.transition.early-extension'],
    source: 'golf-father',
  },
  {
    id: 'contact.compression',
    layer: 'contact',
    module: MODULE,
    topic: 'compression — hands ahead',
    aliases: ['compression', 'compress the ball', 'flip at impact', 'scooping', 'hands ahead at impact', 'pure strike'],
    principle:
      'A flush iron means hands slightly ahead of the ball at impact with the shaft leaning toward the target — that delofts the club and compresses the ball. Flipping or scooping (hands behind, trying to lift it) adds loft and produces weak, high, thin contact.',
    appSignals: ['acoustic_strike', 'pose_biomech'],
    honesty: 'directional',
    cnsPersonalize: [],
    coachingCues: ['hands lead the clubhead', 'shaft leans target-ward', 'let loft do the lifting'],
    related: ['contact.low-point', 'fs.finish.hanging-back'],
    source: 'golf-father',
  },
  {
    id: 'contact.center-strike-speed',
    layer: 'contact',
    module: MODULE,
    topic: 'center strike vs swinging harder',
    aliases: ['hit it farther', 'more distance', 'i swing hard but it goes nowhere', 'center contact distance'],
    principle:
      'Center-face contact transfers far more energy than extra effort does — a smooth swing flushed beats a hard swing mis-hit for both distance AND dispersion. Chase the center of the face before chasing clubhead speed.',
    appSignals: ['acoustic_strike'],
    honesty: 'directional',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['center beats effort', 'smooth and flush > hard and off-center'],
    related: ['contact.dispersion-centroid', 'psych.over-control'],
    source: 'golf-father',
  },
  // Diagnosis + contact reasoning: read the evidence before blaming the swing.
  {
    id: 'contact.diagnose-evidence-order',
    layer: 'contact',
    module: MODULE,
    topic: 'why did that happen — diagnose a bad shot',
    aliases: ['why did i slice that', 'why did i chunk that', 'why did i pull it', 'why did i top it', 'why did i blade that', 'what happened on that shot', 'why did that go wrong'],
    principle:
      'Read the evidence before blaming the swing, in this order: the LIE (what shot was even possible), the BALL FLIGHT (where it started + which way it curved = what the club did), the STRIKE (heel/toe/high/low/center), where the GRASS FIRST GOT CUT (before or after the ball), then SETUP (grip, face, alignment, ball position), and only then MOTION. Most misses are explained before you ever get to mechanics.',
    honesty: 'coaching_only',
    cnsPersonalize: ['tendencies'],
    coachingCues: ['lie first, then ball flight, strike, where the grass first got cut, setup, then motion', "don't rebuild the swing to explain one shot"],
    related: ['contact.diagnose-ask-one', 'cm.course-vs-range'],
  },
  {
    id: 'contact.diagnose-ask-one',
    layer: 'contact',
    module: MODULE,
    topic: 'not enough info to diagnose — ask one useful question',
    aliases: ['help me fix my shot', "i don't know why", 'diagnose my miss', 'whats wrong with my swing'],
    principle:
      "When the evidence is missing, don't pretend — ask the ONE most useful thing, not twenty: where did the ball start, which way did it curve, where did you strike the face, what was the lie, where did the grass first get cut, course or range, what club. One or two questions, then answer.",
    honesty: 'coaching_only',
    coachingCues: ['ask the single most useful missing piece', 'one or two questions, not twenty'],
    related: ['contact.diagnose-evidence-order'],
  },
  {
    id: 'contact.brush-the-grass',
    layer: 'contact',
    module: MODULE,
    topic: 'practice swing — brush the grass to find contact',
    aliases: ['how to stop chunking', 'stop hitting it fat', 'stop hitting behind it', 'stop blading it', 'find my contact', 'practice swing purpose'],
    principle:
      "Use the practice swing to find where to hold the club so you barely brush the grass — just a few blades, not a dig and not a whiff. If the club takes too much ground, choke down slightly; if it misses the ground, adjust posture, distance from the ball, or where you're holding it. Once you can barely hear a few blades, step in with confidence and stop worrying about chunking or blading it.",
    appSignals: ['acoustic', 'pose_biomech'],
    honesty: 'directional',
    coachingCues: ['barely brush a few blades of grass', 'too much ground → choke down; missed ground → adjust posture/distance'],
    related: ['cm.course-vs-range', 'equip.test-before-buy'],
  },
  {
    id: 'contact.center-over-speed',
    layer: 'contact',
    module: MODULE,
    topic: 'more distance — center contact beats swinging harder',
    aliases: ['how do i hit it farther', 'i want more distance', 'why am i losing distance', 'should i swing harder', 'my smash factor'],
    principle:
      "Numbers only matter if they tell you what to do next. Your speed is usually fine — the easiest distance to find is centeredness of contact, not swinging harder. A heel-side strike with high spin leaks right and loses yards even with good speed. Compare yourself to your handicap group and your next target group, not the PGA Tour.",
    appSignals: ['acoustic', 'ball_speed', 'smash_factor'],
    honesty: 'directional',
    cnsPersonalize: ['bag', 'tendencies'],
    coachingCues: ['center the strike before you add speed', 'compare to your handicap group, not tour'],
    related: ['contact.brush-the-grass', 'equip.test-before-buy'],
  },
];
