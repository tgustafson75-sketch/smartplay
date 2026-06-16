/**
 * 2026-06-15 (Tim) — honest per-hole note DERIVED from real par + yardage, so the
 * Hole Guide is always FILLED (never a "—"/null) even with no live course-content.
 *
 * Honesty: these are factual LENGTH/shape descriptors computed from the real
 * scorecard par + yards (publicly-findable, bundled) — NOT fabricated hazards
 * ("bunker right at 240" we can't verify). A real note from the content backend
 * (or a field-verified source) always WINS over this fallback; this just guarantees
 * the table reads like a range book instead of a wall of dashes. Pure / sync.
 */
export function holeNoteFromStats(par?: number | null, yards?: number | null): string {
  const p = typeof par === 'number' ? par : 0;
  const y = typeof yards === 'number' ? yards : 0;
  if (!p || !y) return '';
  if (p === 3) {
    if (y <= 135) return 'Short par 3 — wedge or short iron';
    if (y <= 175) return 'Mid-iron par 3';
    if (y <= 210) return 'Long par 3 — long iron or hybrid';
    return 'Big par 3 — fairway wood for most';
  }
  if (p === 4) {
    if (y <= 320) return 'Short par 4 — position off the tee';
    if (y <= 400) return 'Mid-length par 4';
    if (y <= 440) return 'Long par 4 — full two-shotter';
    return 'Brute par 4 — driver and a long approach';
  }
  if (p === 5) {
    if (y <= 480) return 'Short par 5 — reachable in two';
    if (y <= 545) return 'Reachable par 5 with two good ones';
    return 'Three-shot par 5';
  }
  if (p >= 6) return 'Par 6 — three solid shots to get home';
  return '';
}
