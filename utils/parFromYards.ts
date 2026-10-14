/**
 * 2026-10-13 (course-engine audit #6) — ONE rule for "the card has no par". It was `?? 4` in the app and
 * on the server: a 520-yard hole with a blank par became a par 4, and score-to-par, net/WHS strokes and the
 * caddie's strategy reasoned off a number nobody measured. Inferred from the hole's own length on
 * USGA-style bands; callers mark the result estimated. Pure: shared by services/golfCourseApi and
 * api/course-geometry.
 */
export function parFromYards(yards: number | null | undefined): number {
  const y = Number(yards);
  if (!Number.isFinite(y) || y <= 0) return 4;
  return y <= 250 ? 3 : y <= 470 ? 4 : 5;
}
