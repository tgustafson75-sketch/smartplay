/**
 * 2026-10-31 (Brain recheck r20, BRAIN-ENG-3) — a hole's yardage as a DISTANCE, or null when the card did not
 * record one. A custom course saved from a scorecard with an unread yardage carries 0 (data/courses
 * getBundledHoles), and 0 yards is never a real hole: it reached the round's current yardage and the caddie's
 * card as a fact. One owner for that convention; every reader of a hole's distance goes through it.
 */
export function knownYardage(distance: number | null | undefined): number | null {
  return typeof distance === 'number' && distance > 0 ? distance : null;
}
