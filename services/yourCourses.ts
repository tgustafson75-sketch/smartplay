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
  /** Courses he downloaded (a caddie "add it" lands here) — alias rows already left out. */
  downloaded?: readonly { id: string; name: string }[];
  /** The surveyed card's name for a `local:` id with a survey, else null. */
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
    // isLocal = the course has its OWN card here (a survey or a scorecard) — round setup reads it.
    out.push({ id, name, fullName: name, isLocal: id.startsWith('custom:') || (id.startsWith('local:') && !!src.surveyedName(id)) });
  };
  for (const id of src.recentIds) add(id, nameOf(id));
  for (const h of src.home) if (h.id) add(h.id, nameOf(h.id, h.name));
  for (const c of src.custom) add(c.id, c.name);
  for (const d of src.downloaded ?? []) add(d.id, nameOf(d.id, d.name));
  return out.slice(0, src.limit ?? 6);
}

/**
 * 2026-09-23 (triple-check) — which course the Play card should pick FOR the player, if any. Pure, so
 * every case is tested rather than reasoned about:
 *  - never over a course on the card or a pick in flight;
 *  - the active round's course first, even over an earlier automatic failure;
 *  - never over the error of a pick HE made (the error is the answer on screen);
 *  - never the same course an automatic pick just failed on (no retry loop), anything else is fine.
 */
export function decideAutoPick<T extends CourseRow>(s: {
  hasSelection: boolean;
  loading: boolean;
  error: boolean;
  lastPickWasAutomatic: boolean;
  lastAutoPickId: string | null;
  activeRoundCourse: T | null;
  defaultPick: T | null;
}): T | null {
  if (s.hasSelection || s.loading) return null;
  const failedAutoId = s.error && s.lastPickWasAutomatic ? s.lastAutoPickId : null;
  const ok = (c: T | null) => (c && c.id !== failedAutoId ? c : null);
  const active = ok(s.activeRoundCourse);
  if (active) return active;
  if (s.error && !s.lastPickWasAutomatic) return null;
  return ok(s.defaultPick);
}
