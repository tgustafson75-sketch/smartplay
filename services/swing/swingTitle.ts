/**
 * 2026-08-24 (Tim's screenshot) — ONE OWNER FOR THE ANGLE ON THE SWING SCREEN.
 *
 * Pure and dependency-free so the rule can be tested directly — it lived inside the screen for one
 * commit and the logic test project could not parse a React Native file to reach it, which is its
 * own small argument for where a rule belongs.
 *
 * The title came from `upload.notes`, a string frozen at capture that embedded the angle; the chip
 * beside it reads `upload.angleOverride`, which can be corrected afterwards. So a swing filmed one
 * way and re-labelled another displayed BOTH answers at once — "Smart Motion down-the-line swing"
 * above a chip reading "Face-on".
 *
 * New captures no longer bake the angle in. This heals the ones already saved: when an explicit
 * override exists it is the authority (its whole purpose is to overrule the capture-time value), so
 * a stale angle phrase in the stored title is rewritten to match. Nothing else in the note is
 * touched — a coach's or player's own words survive untouched.
 */
export function titleForUpload(
  notes: string | null | undefined,
  angleOverride: 'down_the_line' | 'face_on' | null | undefined,
  fallback: string,
): string {
  const raw = (notes ?? '').trim() || fallback;
  if (!angleOverride) return raw;
  const right = angleOverride === 'face_on' ? 'face-on' : 'down-the-line';
  const wrong = angleOverride === 'face_on' ? 'down-the-line' : 'face-on';
  return raw.includes(wrong) ? raw.replace(wrong, right) : raw;
}
