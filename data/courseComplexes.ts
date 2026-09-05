/**
 * 2026-09-05 (Tim, from a round at Menifee Lakes) — MULTI-COURSE COMPLEXES ARE THEIR OWN PROBLEM.
 *
 * He played the PALMS. The yardages were right and the hole imagery was the LAKES.
 *
 * Both facts came from the same round and disagreed because they have different owners. Yardages
 * come from the course record, which is per-layout and was correct. Hole imagery is resolved from
 * the course NAME by substring match — and golfcourseapi returns the same parent club for both
 * layouts, so the name in hand was "Menifee Lakes Country Club". That string contains "lakes" and
 * does not contain "palms", so the matcher confidently answered with the wrong course's photographs
 * of the wrong holes, on the tee, while the numbers beside them were right.
 *
 * `getLocalHoleImage` already had a `lakes && !palms` guard. It was not wrong; it was answering a
 * question that could not be answered. **A name that identifies only the facility cannot identify
 * the layout**, and the honest response is to decline rather than guess — the caller then falls
 * through to live satellite geometry, which is keyed by the correct course id and is right.
 *
 * That is what this file is: not a Menifee special case, but a gate for the general shape. Any golf
 * property with more than one layout has this problem, most of them are named after one of their own
 * layouts ("Menifee LAKES — Palms"), and a substring matcher will always prefer the facility name it
 * sees first. [[two-owners-is-the-root-cause]] [[illustration-data-points]]
 *
 * ── THE DRIVING RANGE ──────────────────────────────────────────────────────────────────────────
 *
 * Tim: "account for their respective driving ranges, which no one does." He is right, and it is the
 * same modelling gap seen from the other side. A complex has ONE range, shared by every layout and
 * belonging to none of them. Today a range session at a multi-course property has no honest course
 * identity to record: attributing it to Palms is a guess, and attributing it to the parent club
 * loses which facility's range it was.
 *
 * `range` below is where that belongs. `center` is deliberately null until somebody stands on the
 * range and records it — a fabricated coordinate would be worse than an absent one, because a
 * plausible wrong centroid silently mis-attributes every session near it and nothing looks broken.
 */

export type ComplexRange = {
  /** Name fragments that mean "the range at this facility", not a layout. */
  readonly aliases: readonly string[];
  /**
   * Measured centroid of the range tee line, or null when nobody has recorded it yet.
   * NEVER guess this. A wrong centroid mis-attributes sessions invisibly.
   */
  readonly center: { readonly lat: number; readonly lng: number } | null;
};

export type CourseComplex = {
  readonly key: string;
  readonly displayName: string;
  /** Matches the shared facility name. Written to match the LONGEST facility form first. */
  readonly facility: RegExp;
  /** Tokens that identify one layout within the complex. Lowercase. */
  readonly layouts: readonly string[];
  readonly range: ComplexRange;
};

/**
 * Registered complexes. Add a property here the moment a second layout is bundled for it — the cost
 * of a missing entry is the Menifee bug, silently, on somebody's home course.
 *
 * Note Menifee's facility name CONTAINS one of its own layout names. That is the whole difficulty
 * and it is common: Pembroke Lakes, Shadow Lakes and Menifee Lakes all collide on "lakes" today.
 */
export const COURSE_COMPLEXES: readonly CourseComplex[] = [
  {
    key: 'menifee-lakes',
    displayName: 'Menifee Lakes Country Club',
    facility: /menifee(\s+lakes)?/,
    layouts: ['palms', 'lakes'],
    range: {
      aliases: ['driving range', 'range', 'practice facility'],
      center: null, // Not measured. Do not invent one.
    },
  },
];

export type ComplexResolution =
  | { readonly kind: 'not-a-complex' }
  /** The name identifies the facility but NOT which layout — imagery must not be guessed. */
  | { readonly kind: 'ambiguous'; readonly complex: CourseComplex }
  /** The name names the facility's practice ground, which belongs to no layout. */
  | { readonly kind: 'range'; readonly complex: CourseComplex }
  | { readonly kind: 'layout'; readonly complex: CourseComplex; readonly layout: string };

/**
 * Decide what a course name actually identifies within a multi-course property.
 *
 * The layout token is looked for in what REMAINS after the facility name is removed, which is the
 * only way to tell "Menifee Lakes Country Club" (facility, no layout → ambiguous) from
 * "Menifee Lakes — Lakes" (facility + the Lakes layout). Matching against the whole string cannot
 * distinguish them, and that is precisely how the wrong photographs reached the tee.
 */
export function resolveComplex(courseName: string | null | undefined): ComplexResolution {
  const c = String(courseName ?? '').toLowerCase().trim();
  if (!c) return { kind: 'not-a-complex' };

  for (const complex of COURSE_COMPLEXES) {
    const m = complex.facility.exec(c);
    if (!m) continue;

    // Everything the facility name did not account for.
    const remainder = (c.slice(0, m.index) + ' ' + c.slice(m.index + m[0].length)).trim();

    if (complex.range.aliases.some(a => remainder.includes(a))) {
      return { kind: 'range', complex };
    }

    const hits = complex.layouts.filter(l => remainder.includes(l));
    if (hits.length === 1) return { kind: 'layout', complex, layout: hits[0] };

    // 0 hits = the facility named alone. 2+ = genuinely undecidable. Both are "do not guess".
    return { kind: 'ambiguous', complex };
  }

  return { kind: 'not-a-complex' };
}

/**
 * The gate itself, in the form the image resolvers need: true when a name belongs to a multi-course
 * property but does not say WHICH course, so no per-layout asset may be returned for it.
 */
export function isAmbiguousComplexName(courseName: string | null | undefined): boolean {
  const r = resolveComplex(courseName);
  return r.kind === 'ambiguous' || r.kind === 'range';
}

/**
 * 2026-09-05 — BUILD THE LABEL SO THE LAYOUT SURVIVES.
 *
 * This is the root cause of the Palms/Lakes bug, and the reason a gate alone is not good enough.
 * golfcourseapi returns the layout explicitly:
 *
 *     id=cdyssqsz  club_name='Menifee Lakes Country Club'  course_name='Palms'
 *     id=vhazn5kq  club_name='Menifee Lakes Country Club'  course_name='Lakes'
 *
 * Nothing about that is ambiguous. But a round started from the API was stamped with `club_name`
 * alone — the layout was DISCARDED at round start, and every downstream consumer then tried to
 * guess it back out of a string that no longer contained it. The app was not missing information;
 * it was throwing it away and then reasoning about the absence.
 *
 * Keeping both halves is the fix, and it fixes every multi-course property, not only this one.
 *
 * The redundancy check is deliberately narrow. "Menifee Lakes Country Club" CONTAINS "lakes", so a
 * naive substring test would suppress the suffix for the Lakes layout and reintroduce the same bug
 * on the sister course. Only an exact match, or a club name that genuinely ends with the course
 * name as a trailing phrase, is treated as redundant.
 */
export function courseDisplayLabel(
  clubName: string | null | undefined,
  courseName: string | null | undefined,
): string {
  const club = String(clubName ?? '').trim();
  const course = String(courseName ?? '').trim();
  if (!club) return course;
  if (!course) return club;

  const c = club.toLowerCase();
  const n = course.toLowerCase();
  if (c === n) return club;
  if (c.endsWith(' ' + n)) return club;

  return `${club} — ${course}`;
}
