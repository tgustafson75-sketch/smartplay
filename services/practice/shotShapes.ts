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

export interface ShotShapeDef {
  id: string;
  name: string;
  icon: string;            // Ionicons name for the picker tile
  intendedHeight: LaunchHeight;
  intendedRoll: ShotRoll;  // the INTENDED roll (display only — not measured in v1)
  blurb: string;           // the intended shape, in plain words
}

// The mockup's grid (Tank's short-game set). Putting is intentionally excluded —
// it's a ground roll, not a launch, so the origin→departure launch read doesn't apply.
export const SHOT_SHAPES: ShotShapeDef[] = [
  { id: 'flop',         name: 'Flop Shot',    icon: 'arrow-up-outline',       intendedHeight: 'high',   intendedRoll: 'check',   blurb: 'High and soft — lands steep, stops fast.' },
  { id: 'lob',          name: 'Lob Shot',     icon: 'arrow-up-outline',       intendedHeight: 'high',   intendedRoll: 'check',   blurb: 'Maximum height, minimal roll.' },
  { id: 'bunker',       name: 'Bunker Shot',  icon: 'sunny-outline',          intendedHeight: 'high',   intendedRoll: 'check',   blurb: 'Up steep out of the sand, soft landing.' },
  { id: 'pitch',        name: 'Pitch',        icon: 'trending-up-outline',    intendedHeight: 'high',   intendedRoll: 'medium',  blurb: 'Carries most of the way, a little release.' },
  { id: 'pitch_run',    name: 'Pitch & Run',  icon: 'trending-up-outline',    intendedHeight: 'medium', intendedRoll: 'release', blurb: 'Medium flight, then runs to the hole.' },
  { id: 'chip',         name: 'Chip',         icon: 'remove-outline',         intendedHeight: 'medium', intendedRoll: 'release', blurb: 'Short carry, lots of roll.' },
  { id: 'low_chip',     name: 'Low Chip',     icon: 'remove-outline',         intendedHeight: 'low',    intendedRoll: 'release', blurb: 'Low and skipping, releases out.' },
  { id: 'running_chip', name: 'Running Chip', icon: 'arrow-forward-outline',  intendedHeight: 'low',    intendedRoll: 'release', blurb: 'Bump-and-run — low line, long roll.' },
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
export function compareShotShape(intended: ShotShapeDef, actual: ActualLaunch | null): ShotShapeVerdict {
  if (!actual) {
    return {
      match: 'off',
      feedback: `Couldn't read the ball leaving for this one — try again with the ball box on the ball and the flight in frame.`,
      intendedHeight: intended.intendedHeight,
      actualHeight: intended.intendedHeight,
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
