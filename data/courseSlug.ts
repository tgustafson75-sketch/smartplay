/**
 * ONE course-id → bundled-slug resolver, for every course.
 *
 * 2026-09-06 (Tim — "make sure course engine is uniform for all courses").
 *
 * WHY THIS FILE EXISTS. Resolving "which bundled course is this?" was spread across three shapes
 * that disagreed about their own precedence:
 *
 *   - `courseId.startsWith('local:')` inline, in several places;
 *   - `localSlugFromAnyCourseId()` — which lived in `constants/golfbertCourses.ts`, so a universal
 *     `local:` prefix strip could only be reached by importing a PAID TWO-COURSE PROVIDER TABLE. The
 *     engine's most generic operation was parked inside its least generic module;
 *   - `getLocalCourseSlug(courseName)` — a hand-ordered substring chain over the course NAME.
 *
 * Those are not interchangeable and the difference is the whole bug class. An id is authoritative:
 * `local:palms` IS Palms. A name is a guess, and it has been wrong in the field at least twice —
 * "Shadow Lakes" resolving to Menifee's Lakes (2026-09-01), and the facility name "Menifee Lakes
 * Country Club" resolving to the Lakes layout while the player stood on the Palms (2026-09-05).
 *
 * So: id first, always. Name only when there is no id, and only through `getLocalCourseSlug`, which
 * carries the `isAmbiguousComplexName` gate that makes it decline rather than guess.
 *
 * This file deliberately holds NO course-specific knowledge except the legacy alias table below.
 * Adding a course must never mean editing this file.
 */

import { getLocalCourseSlug, type LocalCourseSlug } from './localCourseImages';

/**
 * Upstream ids that older persisted rounds may still carry, mapped to the bundled slug they mean.
 *
 * These are Golfbert course ids from when SmartVision fetched that provider directly (severed
 * 2026-09-06 — see services/smartFinderService.ts). No NEW round can be created with one of these,
 * because nothing writes them any more. They stay so a round persisted before that change still
 * resolves its course instead of silently losing it on resume.
 *
 * This is the one place a raw upstream id is allowed to name a course, and it is a back-compat
 * shim, not a provider hook. Do not add live provider ids here — a provider belongs behind the
 * course engine, feeding courseHoles, where every course can reach it.
 */
const LEGACY_UPSTREAM_ID_ALIASES: Readonly<Record<string, LocalCourseSlug>> = {
  '17345': 'palms' as LocalCourseSlug,
  '1747': 'lakes' as LocalCourseSlug,
};

/**
 * Resolve a course id to a bundled slug WITHOUT guessing from a name.
 *
 * Returns null for any course we do not bundle — which is the correct answer for the great majority
 * of courses, and callers must handle it. A null here means "fall through to the live path", never
 * "pick something close".
 */
export function localSlugFromCourseId(courseId: string | null | undefined): LocalCourseSlug | null {
  if (!courseId) return null;
  if (courseId.startsWith('local:')) {
    const slug = courseId.slice('local:'.length);
    return slug ? (slug as LocalCourseSlug) : null;
  }
  return LEGACY_UPSTREAM_ID_ALIASES[courseId] ?? null;
}

/**
 * The resolver every surface should call: id first, name only as a last resort.
 *
 * Pass both whenever both are in hand. Passing only the name is legitimate for the voice/home-course
 * paths, where a name genuinely is all the user gave us — but it accepts a wrong answer that the id
 * path cannot produce, so prefer the id wherever one exists.
 */
export function resolveLocalSlug(
  courseId: string | null | undefined,
  courseName: string | null | undefined,
): LocalCourseSlug | null {
  return localSlugFromCourseId(courseId) ?? getLocalCourseSlug(courseName ?? null);
}
