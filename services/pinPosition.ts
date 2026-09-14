/**
 * 2026-09-13 (Tim) — "what would it take to have input for pin position?" then, crucially, "but aren't
 * there general pin position rules that give a good estimate?"
 *
 * There are, and they are better than the model I had scoped. THE ONE OWNER of "what does a declared pin
 * do to a yardage".
 *
 * MY FIRST VERSION USED A FRACTION of green depth — a back pin two-thirds of the way from centre to the
 * back edge. That is a number I chose. The actual convention is an INSET FROM THE EDGE: greenkeepers set
 * hole locations a minimum distance inside any edge (USGA hole-location guidance is at least four paces;
 * ordinary practice is five or more, and tournament setups five to six). A back pin is "five yards short
 * of the back edge", not "two-thirds back".
 *
 * The difference is not cosmetic, because it self-corrects for green SIZE the way pin setting really does:
 *
 *     green depth 30y (half-depth 15)   fraction → +10     edge inset → +10    agree
 *     green depth 44y (half-depth 22)   fraction → +14.7   edge inset → +17    edge rule is right;
 *                                                                              big greens have genuinely
 *                                                                              deep back pins
 *     green depth 12y (half-depth 6)    fraction → +4      edge inset → +1     edge rule is right; there
 *                                                                              is nowhere to put a back
 *                                                                              pin on a green that shallow
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It never invents an edge. Depth only moves a number when the green's
 * real front or back yardage is known, and `adjustForPin` returns the yardage untouched otherwise — the
 * resolver's own honesty rule, applied here. A guessed pin offset makes every yardage on the hole wrong,
 * which is worse than no pin at all.
 *
 * SIDE IS NOT A DISTANCE and is not handled here. "Back right" changes where you aim and which miss is
 * dead; it does not change how far the flag is. It reaches the caddie as context instead.
 */
import type { PinPosition, PinDepth } from '../store/roundStore';

/**
 * How far inside the edge a hole is cut, in yards. USGA hole-location guidance is a minimum of about four
 * paces from any edge; five is the ordinary number a caddie would assume and it is deliberately
 * conservative — erring toward the middle of the green means erring toward the club the player would have
 * hit anyway.
 */
export const PIN_EDGE_INSET_YARDS = 5;

export interface PinAdjustment {
  /** The yardage to play, after the pin. Same as `from` when nothing could be applied. */
  yards: number;
  /** Signed yards applied (+ is longer). 0 when the pin is central, undeclared, or unknowable. */
  delta: number;
  /** Why it did or did not move — for the resolver's reason string and for the caddie. */
  why:
    | 'centre'            // pin is middle: nothing to do
    | 'applied'           // a real edge was known and used
    | 'no_edge'           // that edge's yardage is unknown, so declined
    | 'green_too_shallow'; // the edge is closer than the inset — 'back' and 'middle' converge
}

/**
 * Apply a declared pin's DEPTH to a centre-of-green yardage.
 *
 * @param from   yards to the middle of the green
 * @param front  yards to the front edge, or null when unknown
 * @param back   yards to the back edge, or null when unknown
 */
export function adjustForPin(
  from: number,
  front: number | null,
  back: number | null,
  depth: PinDepth,
): PinAdjustment {
  if (depth === 'middle') return { yards: from, delta: 0, why: 'centre' };

  const edge = depth === 'back' ? back : front;
  if (edge == null || !Number.isFinite(edge) || edge <= 0) {
    return { yards: from, delta: 0, why: 'no_edge' };
  }

  /**
   * GEOMETRY FIRST, then the shallow-green clamp — and that order is the fix for a bug my own test
   * caught. A back edge NEARER than the middle (or a front edge beyond it) is nonsense data, not a
   * shallow green; with the clamp checked first it returned 'green_too_shallow', which is a sentence the
   * caddie would say out loud about a green that is fine. The two cases decline identically, so the bug
   * was invisible in the number and only wrong in the explanation — which is exactly the kind of thing
   * that gets stated to a player as fact.
   */
  if (depth === 'back' && edge <= from) return { yards: from, delta: 0, why: 'no_edge' };
  if (depth === 'front' && edge >= from) return { yards: from, delta: 0, why: 'no_edge' };

  // The target is the inset point, and it may never cross the centre: on a shallow green a back pin and
  // a middle pin are the same club, and saying otherwise would be inventing depth the green lacks.
  const target = depth === 'back' ? edge - PIN_EDGE_INSET_YARDS : edge + PIN_EDGE_INSET_YARDS;
  const crossedCentre = depth === 'back' ? target <= from : target >= from;
  if (crossedCentre) return { yards: from, delta: 0, why: 'green_too_shallow' };

  const yards = Math.round(target);
  return { yards, delta: yards - from, why: 'applied' };
}

/** "back right", "front left", "middle" — how a caddie says it out loud. */
export function describePin(pin: PinPosition): string {
  const depth = pin.depth === 'middle' ? '' : pin.depth;
  const side = pin.side === 'center' ? '' : pin.side;
  if (!depth && !side) return 'middle of the green';
  return [depth, side].filter(Boolean).join(' ');
}

/**
 * What the SIDE means for the shot, which is the half of a pin nobody can get from a number. Null for a
 * centre pin — there is nothing to say, and saying something anyway is the noise this app removes.
 */
export function aimNoteForPin(pin: PinPosition): string | null {
  if (pin.side === 'center') return null;
  const safe = pin.side === 'left' ? 'right' : 'left';
  return `Pin is ${describePin(pin)} — the fat of the green is ${safe} of it, and a miss on the ${pin.side} side is the dead one.`;
}
