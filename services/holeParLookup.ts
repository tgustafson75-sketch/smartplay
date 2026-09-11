/**
 * holeParLookup — par for a hole, given the holes it belongs to.
 *
 * 2026-09-11 — THE PURE HALF OF "ONE TRUTH FOR THE HOLE".
 *
 * smartFinderService.holePar answers "what is the par of hole N in the round happening NOW", and
 * resolves through useRoundStore plus the bundled course. That is the right answer to that question
 * and the wrong answer to a different one: analysis code is handed an arbitrary set of shots TOGETHER
 * WITH the courseHoles they came from, and must score them against their own course, not against
 * whatever the player is standing on.
 *
 * Commit 8d84ac50 collapsed both questions into the live-round resolver, which silently scored
 * historical shots against the current course and dragged the store (and React Native) into pure
 * analysis modules — breaking `npm run user-sim` outright.
 *
 * So the ARRAY lookup lives here, once, with no store and no React Native, and returns null rather
 * than inventing a number. The live-round resolver stays where it is; this is the half that can be
 * called from a harness, a test, or a node script.
 */
import type { CourseHole } from '../store/roundStore';   // type-only: erased at runtime

/**
 * Par for `hole` within `holes`, or null when it is not known.
 *
 * NEVER defaults to 4. A hole whose par we do not have is not a par 4 — it is unknown, and the
 * caller has to decide what that means. Defaulting here is how an unknown hole becomes a fact three
 * layers downstream, which is exactly what the one-truth guard was written to stop.
 */
export function parForHole(holes: readonly CourseHole[] | undefined | null, hole: number): number | null {
  if (!holes || holes.length === 0) return null;
  const found = holes.find((h) => h.hole === hole);
  const par = found?.par;
  return typeof par === 'number' && Number.isFinite(par) && par > 0 ? par : null;
}
