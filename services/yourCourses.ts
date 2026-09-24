/**
 * 2026-09-23 (Tim — "We shouldn't have old bundled courses. Unify the pipeline.")
 *
 * The Play tab's "Your courses": the courses that are HIS — built from a scorecard, played,
 * downloaded, or set as home. A surveyed course (data/courses) joins on exactly those terms, like
 * every database course; it is not listed to every player because it happens to ship in the app.
 * Surveyed courses are still found by search.
 *
 * Deduped by id, first source wins, so a course he has also played shows once as its richer recent
 * row (rating/slope already resolved).
 */
export type CourseRow = { id: string };

export function composeYourCourses<T extends CourseRow>(src: {
  custom: readonly T[];
  recent: readonly T[];
  /** The surveyed index — searched, never listed wholesale. */
  surveyed: readonly T[];
  downloaded: readonly T[];
  /** Ids he owns outside the recents: downloaded course ids and home course ids. */
  ownedIds: Iterable<string>;
}): T[] {
  const owned = new Set([...src.ownedIds].filter((id) => !!id));
  const out: T[] = [];
  const seen = new Set<string>();
  for (const c of [...src.custom, ...src.recent, ...src.surveyed.filter((s) => owned.has(s.id)), ...src.downloaded]) {
    if (!c?.id || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}
