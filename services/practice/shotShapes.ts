/**
 * 2026-06-15 (Tim — shot-shape drills) — short-game shot-shape practice.
 *
 * The honest, simple read Tim asked for: we KNOW the ball-box origin and we catch
 * ONE departure point a few frames after impact (services/swing/ballDeparture.ts).
 * The origin→point vector gives a LAUNCH read — height (steepness) + direction —
 * which is enough to compare "what you went for" vs "what came out". This is for
 * SENSE OF PROGRESS + direction, NOT lab precision ([[shot-shape-drills]],
 * [[time-constrained-golfer-lens]]).
 *
 * Honesty boundary (hard): from ONE point we can read LAUNCH HEIGHT + DIRECTION.
 * We CANNOT read carry-to-roll / check-vs-release from a single point (that needs
 * landing + rollout frames) — so we never claim roll as a measured result. Pure /
 * sync / never throws.
 */

export type LaunchHeight = 'low' | 'medium' | 'high';
export type ShotRoll = 'release' | 'medium' | 'check';

/**
 * 2026-09-14 (Tim) — "we have shot shape drills but we dont teach how the hell to shot shape."
 *
 * The short-game set below got the teaching treatment on 2026-09-01. FULL-SWING shaping never did:
 * the only draw/fade material in the app was one knowledge-base entry stating the ball-flight law
 * ("curve comes from the face relative to the path"), which is physics, not a lesson — while
 * `services/clubTendency` measures your shape and the caddie comments on it. Measured, commented
 * on, never taught.
 */
export type ShapeFamily = 'short_game' | 'full_swing';

/** The curve a shot is MEANT to have. Null for the short-game shots, which are about height. */
export type IntendedCurve = 'draw' | 'fade' | null;

export interface ShotShapeDef {
  id: string;
  name: string;
  icon: string;            // Ionicons name for the picker tile
  /** Which rack this belongs to. Short game is about HEIGHT; full swing is about CURVE. */
  family: ShapeFamily;
  intendedHeight: LaunchHeight;
  intendedRoll: ShotRoll;  // the INTENDED roll (display only — not measured in v1)
  /**
   * 2026-09-14 — the curve this shot is for, when curve is the point of it.
   *
   * HONESTY, and it is the whole reason this is a separate field rather than folded into the
   * verdict: a single departure point reads a START DIRECTION, not a curve. A draw that starts
   * right and never turns over is indistinguishable from a push at the moment the ball leaves. So
   * a full-swing shape is graded on the START LINE — which is genuinely the half a player gets
   * wrong — and the verdict says plainly that the curve is not measured.
   */
  intendedCurve?: IntendedCurve;
  blurb: string;           // the intended shape, in plain words
  /**
   * 2026-09-01 (Tim — "our shot shape drill shouldn't be here. I'll watch you do shot shape drills.
   * It should FIRST teach you how to do different shot shapes and why, in terms that users can
   * understand.") — THE DRILL GRADED A SKILL IT NEVER TAUGHT.
   *
   * The picker named a shot and went straight to recording. That is a fine drill for someone who
   * already knows what a flop shot is and how to hit one. For the golfer this app is actually for —
   * busy, self-taught, no lessons — it is a test with no lesson before it, and the grade that comes
   * back ("that came out more like a running chip") lands as a verdict instead of as coaching.
   * [[time-constrained-golfer-lens]] [[feels-like-a-real-caddie]]
   *
   * So every shot now carries the two things a player needs BEFORE the camera runs. Both are written
   * in situations and feels, never in swing jargon, and neither quotes a number the app cannot back
   * up — no launch angles, no spin, no carry yardages. [[illustration-data-points]]
   */
  /** WHEN you'd actually reach for this, described as a situation on a real hole. */
  why: string;
  /** HOW to hit it: setup first, then the one feel that matters. */
  how: string[];
  /** The club to try it with first. A starting point, not a rule. */
  club: string;
}

// The mockup's grid (Tank's short-game set). Putting is intentionally excluded —
// it's a ground roll, not a launch, so the origin→departure launch read doesn't apply.
export const SHOT_SHAPES: ShotShapeDef[] = [
  { id: 'flop',         name: 'Flop Shot',    icon: 'arrow-up-outline', family: 'short_game',       intendedHeight: 'high',   intendedRoll: 'check',   blurb: 'High and soft — lands steep, stops fast.',
    why: 'You\'re short-sided — the pin is close to your edge of the green with a bunker or thick rough in between, and the ball has to stop almost where it lands.',
    how: [
      'Open the clubface FIRST, then take your grip — twisting your hands instead just aims you right.',
      'Ball forward, off your front heel. Widen your stance and keep the shaft straight up, not leaning forward.',
      'Swing along your toe line and keep the face pointing at the sky through the ball.',
      'The feel: slide the club UNDER the ball. Commit — a decelerating flop is the one you thin across the green.',
    ],
    club: 'Your most lofted wedge',
  },
  { id: 'lob',          name: 'Lob Shot',     icon: 'arrow-up-outline', family: 'short_game',       intendedHeight: 'high',   intendedRoll: 'check',   blurb: 'Maximum height, minimal roll.',
    why: 'A short carry over something you can\'t run the ball through — a bunker lip, a swale, a sprinkler line — with very little green to work with.',
    how: [
      'Same open face as the flop, but a narrower stance and a shorter swing.',
      'Ball just forward of centre, weight even on both feet and steady.',
      'Take the club up steeply and let it drop. The height comes from the loft, not from lifting.',
      'The feel: soft and unhurried, and it finishes. Never a jab.',
    ],
    club: 'Your most lofted wedge',
  },
  { id: 'bunker',       name: 'Bunker Shot',  icon: 'sunny-outline', family: 'short_game',          intendedHeight: 'high',   intendedRoll: 'check',   blurb: 'Up steep out of the sand, soft landing.',
    why: 'Any greenside sand. This is the one shot in golf where you deliberately miss the ball.',
    how: [
      'Dig your feet in for a base — that also sets you slightly below the ball.',
      'Open the face, ball forward, weight favouring your front foot.',
      'Pick a spot about two inches BEHIND the ball and hit the sand there.',
      'The feel: splash a slice of sand onto the green and let it carry the ball out. Keep swinging — sand is heavy, and slowing down is what leaves it in.',
    ],
    club: 'Sand wedge',
  },
  { id: 'pitch',        name: 'Pitch',        icon: 'trending-up-outline', family: 'short_game',    intendedHeight: 'high',   intendedRoll: 'medium',  blurb: 'Carries most of the way, a little release.',
    why: 'Twenty to sixty yards with enough green to work with — the everyday shot when you\'re too close for a full swing.',
    how: [
      'Narrow your stance and grip down a little for control.',
      'Ball centre, weight slightly forward, and it STAYS there through the shot.',
      'Distance comes from the LENGTH of the swing, not from hitting harder.',
      'The feel: chest and arms turning together, brushing the grass after the ball.',
    ],
    club: 'Pitching or gap wedge',
  },
  { id: 'pitch_run',    name: 'Pitch & Run',  icon: 'trending-up-outline', family: 'short_game',    intendedHeight: 'medium', intendedRoll: 'release', blurb: 'Medium flight, then runs to the hole.',
    why: 'A middle-distance chip with plenty of green between you and the hole — you\'d rather let the ground do half the work than fly it all the way there.',
    how: [
      'Ball centre, feet close together, hands slightly ahead.',
      'Rock your shoulders with just a small wrist hinge — this is a stroke, not a hit.',
      'Pick a LANDING SPOT about a third of the way to the hole and aim at that, not the flag.',
      'The feel: quiet legs, and the same tempo back and through.',
    ],
    club: 'Gap wedge or 9-iron',
  },
  { id: 'chip',         name: 'Chip',         icon: 'remove-outline', family: 'short_game',         intendedHeight: 'medium', intendedRoll: 'release', blurb: 'Short carry, lots of roll.',
    why: 'The ball is just off the green, sitting cleanly, with room to run. The lowest-risk shot in golf — and the one most golfers make far harder than it needs to be.',
    how: [
      'Feet close together, most of your weight on the front foot, and it stays there.',
      'Ball back of centre, hands ahead of it, shaft leaning toward the target.',
      'No wrists. Rock your shoulders like a long putt.',
      'The feel: brush the grass and let the ball come out low. Trust the loft — don\'t help it up.',
    ],
    club: '9-iron or pitching wedge',
  },
  { id: 'low_chip',     name: 'Low Chip',     icon: 'remove-outline', family: 'short_game',         intendedHeight: 'low',    intendedRoll: 'release', blurb: 'Low and skipping, releases out.',
    why: 'Into the wind, under a branch, or to a back pin with a lot of green in front of you — you want it down and running.',
    how: [
      'Ball back in your stance, hands well ahead, weight forward.',
      'Grip down on the club for control.',
      'Short back, short through, and keep your hands low afterwards.',
      'The feel: cover the ball and finish LOW. A high finish is what pops it up.',
    ],
    club: '8- or 9-iron',
  },
  { id: 'running_chip', name: 'Running Chip', icon: 'arrow-forward-outline', family: 'short_game',  intendedHeight: 'low',    intendedRoll: 'release', blurb: 'Bump-and-run — low line, long roll.',
    why: 'A tight lie just off the green with a long flat run to the hole — the bump-and-run. Near the green, when in doubt, this is usually the smart shot.',
    how: [
      'Set up almost like a putt: narrow stance, ball back, hands ahead.',
      'Use a straighter-faced club. Less loft means less that can go wrong.',
      'Make a putting stroke — the ball should be rolling within a few feet of landing.',
      'The feel: you\'re putting with a lofted club. Land it on the front edge and let it run.',
    ],
    club: '7- or 8-iron',
  },

  /**
   * ── FULL SWING ────────────────────────────────────────────────────────────────────────────────
   * 2026-09-14 (Tim) — "we have shot shape drills but we dont teach how the hell to shot shape."
   *
   * Written from the ball-flight law the app already states and never taught from: the ball STARTS
   * where the face points and CURVES away from the path. So every one of these is the same two
   * instructions — aim the face where you want it to start, swing the club along a different line —
   * said in a way a player can actually do at address.
   *
   * No swing-plane theory, no "shallow the shaft". The setup does the work, which is both the
   * honest way to teach it and the only way that survives a range session without a coach.
   */
  { id: 'draw', name: 'Draw', icon: 'return-up-back-outline', family: 'full_swing',
    intendedHeight: 'medium', intendedRoll: 'release', intendedCurve: 'draw',
    blurb: 'Starts right of target and turns back left (right-handed).',
    why: 'A pin tucked on the left, a dogleg left, or wind off the left you want to hold against. It also runs out more than a fade, so it is the shot when you need the extra yards.',
    how: [
      'Aim the CLUBFACE at your target first. Then set your feet, hips and shoulders right of it.',
      'Ball a touch back of where you normally play it.',
      'Swing along your FEET, not at the target — that is what makes the path come from the inside.',
      'The feel: the toe of the club passing the heel through impact, and a finish around your body rather than up.',
    ],
    club: 'Any full-swing club — learn it with a 7-iron first',
  },
  { id: 'fade', name: 'Fade', icon: 'return-up-forward-outline', family: 'full_swing',
    intendedHeight: 'medium', intendedRoll: 'check', intendedCurve: 'fade',
    blurb: 'Starts left of target and drifts back right (right-handed).',
    why: 'A pin on the right, a dogleg right, or anywhere you want the ball to land softer and stop. Most good players miss with a fade because it is the easier one to control.',
    how: [
      'Aim the CLUBFACE at your target first. Then set your feet, hips and shoulders left of it.',
      'Ball a touch forward of where you normally play it.',
      'Swing along your FEET. The path cuts across the face and the ball drifts back.',
      'The feel: hold the face square through impact — no roll of the hands. It is a held-off finish.',
    ],
    club: 'Any full-swing club — learn it with a 7-iron first',
  },
  { id: 'knockdown', name: 'Knockdown', icon: 'arrow-down-outline', family: 'full_swing',
    intendedHeight: 'low', intendedRoll: 'release', intendedCurve: null,
    blurb: 'Lower, flatter flight that bores through wind.',
    why: 'Into the wind, under a tree line, or any time you want the wind to stop having an opinion. Also the most reliable shot in golf when you simply need to find the fairway.',
    how: [
      'Take one or two MORE club than the number asks for, and grip down an inch.',
      'Ball back of centre, weight slightly forward, hands ahead of the ball.',
      'Swing at about three-quarters and finish LOW — hands no higher than your chest.',
      'The feel: a punch that never quite finishes. A full finish is what sends it up into the wind.',
    ],
    club: 'One or two more club than normal',
  },
  { id: 'high_soft', name: 'High Ball', icon: 'arrow-up-circle-outline', family: 'full_swing',
    intendedHeight: 'high', intendedRoll: 'check', intendedCurve: null,
    blurb: 'Higher flight that lands steeper and stops.',
    why: 'Downwind, over a bunker to a short-sided pin, or into a green that will not hold a running shot. Height is how a full swing stops quickly.',
    how: [
      'Ball forward, off your lead heel. Widen your stance a touch.',
      'Tilt your trail shoulder down slightly at address so your spine leans away from the target.',
      'Swing normally — the setup adds the loft, not extra effort.',
      'The feel: sweep it away and finish HIGH, hands above your lead shoulder.',
    ],
    club: 'One less club than the number asks for',
  },
];

export function getShotShape(id: string | null | undefined): ShotShapeDef | null {
  if (!id) return null;
  return SHOT_SHAPES.find((s) => s.id === id) ?? null;
}

export interface ActualLaunch {
  height: LaunchHeight;
  direction: 'left' | 'straight' | 'right';
  /** Launch angle proxy in degrees (90 = straight up, 0 = along the ground). */
  angleDeg: number;
}

/**
 * Read the launch from the ball-box origin → the one detected departure point.
 * Image coords (y DOWN, normalized 0..1). Returns null when the ball didn't move
 * enough to read an honest direction (no fabrication on a non-departure).
 */
export function readActualLaunch(
  ballArea: { x: number; y: number },
  departurePoint: { x: number; y: number },
): ActualLaunch | null {
  const dx = departurePoint.x - ballArea.x;
  const dy = departurePoint.y - ballArea.y; // image space: down is +
  const up = -dy;                            // up is +
  const mag = Math.hypot(dx, dy);
  if (mag < 0.02) return null;               // negligible movement — no honest read
  const angleDeg = (Math.atan2(up, Math.abs(dx)) * 180) / Math.PI; // 90=up, 0=flat
  const height: LaunchHeight = angleDeg >= 55 ? 'high' : angleDeg >= 30 ? 'medium' : 'low';
  const direction: ActualLaunch['direction'] = Math.abs(dx) < 0.04 ? 'straight' : dx < 0 ? 'left' : 'right';
  return { height, direction, angleDeg };
}

const HEIGHT_RANK: Record<LaunchHeight, number> = { low: 0, medium: 1, high: 2 };

/** The shot type whose intended height is nearest a read height — for honest
 *  "that came out more like a ___" feedback. */
function nearestNameForHeight(h: LaunchHeight): string {
  const sample: Record<LaunchHeight, string> = { high: 'flop', medium: 'pitch & run', low: 'running chip' };
  return sample[h];
}

export interface ShotShapeVerdict {
  match: 'on' | 'close' | 'off';
  /** Honest, plain feedback — launch only; roll is explicitly not claimed. */
  feedback: string;
  intendedHeight: LaunchHeight;
  actualHeight: LaunchHeight;
}

/**
 * Compare the intended shot to the launch we actually read. Grades on LAUNCH
 * HEIGHT (the main differentiator the single point can honestly read). Never
 * claims roll/spin. `actual` null = couldn't read a departure honestly.
 */
/**
 * 2026-09-14 — where a shaped full swing should START, given the player's hand.
 *
 * Ball-flight law: it starts where the FACE points and curves away from the PATH. A right-hander's
 * draw therefore starts right of target and turns left; a lefty's mirrors it. Derived rather than
 * stored so a left-handed player is not quietly graded against a right-hander's shot.
 */
export function expectedStartSide(
  curve: IntendedCurve,
  handedness: 'right' | 'left',
): 'left' | 'right' | 'straight' {
  if (!curve) return 'straight';
  const rightHanded = handedness !== 'left';
  if (curve === 'draw') return rightHanded ? 'right' : 'left';
  return rightHanded ? 'left' : 'right';
}

export function compareShotShape(
  intended: ShotShapeDef,
  actual: ActualLaunch | null,
  /** Needed only for a shaped full swing; short-game shots are graded on height. */
  opts?: { handedness?: 'right' | 'left' },
): ShotShapeVerdict {
  if (!actual) {
    return {
      match: 'off',
      feedback: `Couldn't read the ball leaving for this one — try again with the ball box on the ball and the flight in frame.`,
      intendedHeight: intended.intendedHeight,
      actualHeight: intended.intendedHeight,
    };
  }
  /**
   * A SHAPED FULL SWING IS GRADED ON ITS START LINE, and the verdict says why.
   *
   * One departure point reads a start DIRECTION, not a curve — a draw that starts right and never
   * turns over looks exactly like a push at the moment the ball leaves. Grading it on height would
   * be grading the wrong axis entirely (a draw and a fade share a height), and claiming to have
   * seen the curve would be the fabrication this module exists to avoid. So: we grade the half we
   * can actually see, and we tell him that is what we did. [[illustration-data-points]]
   */
  if (intended.intendedCurve) {
    const want = expectedStartSide(intended.intendedCurve, opts?.handedness ?? 'right');
    const on = actual.direction === want;
    const startedNote = actual.direction === 'straight' ? 'started straight at it' : `started ${actual.direction}`;
    return {
      match: on ? 'on' : 'off',
      feedback: on
        ? `Start line is right for a ${intended.name} — ${startedNote}, which is where it has to begin. I read the ball leaving, not the curve, so whether it turned is your eyes, not mine.`
        : `For a ${intended.name} it needs to start ${want} of the target; this one ${startedNote}. Aim the FACE at the target and your body ${want} of it, then swing along your feet. I read the start line only — the curve is yours to watch.`,
      intendedHeight: intended.intendedHeight,
      actualHeight: actual.height,
    };
  }

  const diff = Math.abs(HEIGHT_RANK[actual.height] - HEIGHT_RANK[intended.intendedHeight]);
  const match: ShotShapeVerdict['match'] = diff === 0 ? 'on' : diff === 1 ? 'close' : 'off';
  const dirNote = actual.direction === 'straight' ? 'started on line' : `started a touch ${actual.direction}`;
  let feedback: string;
  if (match === 'on') {
    feedback = `That's the one — ${actual.height} launch, ${dirNote}. That's a ${intended.name}.`;
  } else if (match === 'close') {
    feedback = `Close — you went for a ${intended.name} (${intended.intendedHeight} launch), I read ${actual.height}, ${dirNote}.`;
  } else {
    feedback = `That came out ${actual.height} — more like a ${nearestNameForHeight(actual.height)} than a ${intended.name}. ${dirNote.charAt(0).toUpperCase() + dirNote.slice(1)}.`;
  }
  return { match, feedback, intendedHeight: intended.intendedHeight, actualHeight: actual.height };
}
