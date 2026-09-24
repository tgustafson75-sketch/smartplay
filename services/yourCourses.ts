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

/**
 * The same rule for the round-setup picker, which listed four hard-coded Menifee/Hemet courses to
 * every player. His courses, most recent first: built from a scorecard, played, set as home. A row
 * needs a name; an id with none on this device is left out rather than shown as an id.
 */
export function yourCoursePicks(src: {
  custom: readonly { id: string; name: string }[];
  recentIds: readonly string[];
  recentMeta: Readonly<Record<string, { club_name: string }>>;
  home: readonly { id?: string | null; name?: string | null }[];
  surveyedName: (id: string) => string | null;
  limit?: number;
}): { id: string; name: string; fullName: string; isLocal: boolean }[] {
  const nameOf = (id: string, fallback?: string | null) =>
    (src.recentMeta[id]?.club_name ?? (id.startsWith('local:') ? src.surveyedName(id) : null) ?? fallback ?? '').trim();
  const out: { id: string; name: string; fullName: string; isLocal: boolean }[] = [];
  const seen = new Set<string>();
  const add = (id: string | null | undefined, name: string) => {
    if (!id || !name || seen.has(id)) return;
    seen.add(id);
    out.push({ id, name, fullName: name, isLocal: id.startsWith('local:') || id.startsWith('custom:') });
  };
  for (const id of src.recentIds) add(id, nameOf(id));
  for (const h of src.home) if (h.id) add(h.id, nameOf(h.id, h.name));
  for (const c of src.custom) add(c.id, c.name);
  return out.slice(0, src.limit ?? 6);
}
