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
  /**
   * 2026-10-13 — the default is the course GPS says he is standing at (chooseDefaultCourse `here`).
   * Discovery lands seconds after the first automatic pick, so without this the first guess — the
   * nearest of HIS courses, 8 km away — was final for the visit. An AUTOMATIC pick yields to it once;
   * a pick he made never does, and the same course is never picked twice (no loop when a discovered
   * row resolves to a database id).
   */
  defaultIsHere?: boolean;
}): T | null {
  if (s.loading) return null;
  if (s.hasSelection) {
    const correctAutomatic = s.defaultIsHere === true && s.lastPickWasAutomatic && !s.activeRoundCourse
      && s.defaultPick != null && s.defaultPick.id !== s.lastAutoPickId;
    return correctAutomatic ? s.defaultPick : null;
  }
  const failedAutoId = s.error && s.lastPickWasAutomatic ? s.lastAutoPickId : null;
  const ok = (c: T | null) => (c && c.id !== failedAutoId ? c : null);
  const active = ok(s.activeRoundCourse);
  if (active) return active;
  if (s.error && !s.lastPickWasAutomatic) return null;
  return ok(s.defaultPick);
}

/**
 * 2026-10-13 (Tim — "I still get a course I am not near if I am standing on a course… I got Echo Hills
 * the last time I stood at Hemet") — WHICH COURSE SHOULD THE PLAY CARD OPEN ON?
 *
 * It took `previewCourseId ?? closestLocal[0]`: his last pick (including the Play tab's OWN previous
 * guesses), else the nearest of HIS courses that carry coordinates. Only surveyed rows did — a played
 * database course had none — so at Hemet Golf Club the nearest course "of his" with a position was
 * Echo Hills, a bundled survey 8 km away. Google had found Hemet Golf Club 2 m from him; that list was
 * never consulted. The guess then saved itself as his pick and won every launch after.
 *
 * Where he is standing is the strongest evidence there is:
 *   1. AT a course (any course of his or discovered within AT_COURSE_M): that course — unless HE
 *      picked one here himself (sibling courses share a clubhouse: Menifee Palms vs Lakes), or under
 *      the same name. A discovered course that is also his opens as his own row.
 *   2. Not at one: his explicit pick, then the nearest of his courses, then an earlier automatic
 *      pick, then a home course, then the first of his.
 */
export const AT_COURSE_M = 1500;

type Placed = CourseRow & { club_name: string; lat?: number | null; lng?: number | null };

export function sameCourseName(a: string, b: string): boolean {
  const norm = (n: string) => n.toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(the|golf|club|course|country|cc|gc|links|resort)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const x = norm(a), y = norm(b);
  return x.length > 0 && x === y;
}

export function chooseDefaultCourse<T extends Placed>(s: {
  position: { lat: number; lng: number } | null;
  /** His courses, nearest first (rows with no position last). */
  own: readonly T[];
  /** Golf courses found around him (Places), any order. */
  discovered: readonly T[];
  preview: T | null;
  previewExplicit: boolean;
  home: T | null;
}): { pick: T | null; here: boolean } {
  const { haversineMeters } = require('../utils/geoDistance') as typeof import('../utils/geoDistance');
  const pos = s.position && Number.isFinite(s.position.lat) && Number.isFinite(s.position.lng) ? s.position : null;
  const dist = (c: T | null): number | null => {
    if (!pos || !c || typeof c.lat !== 'number' || typeof c.lng !== 'number') return null;
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng) || (Math.abs(c.lat) < 0.001 && Math.abs(c.lng) < 0.001)) return null;
    return haversineMeters(pos, { lat: c.lat, lng: c.lng });
  };
  const explicit = s.previewExplicit ? s.preview : null;

  let here: { c: T; d: number } | null = null;
  for (const c of [...s.own, ...s.discovered]) {
    const d = dist(c);
    if (d != null && d <= AT_COURSE_M && (!here || d < here.d)) here = { c, d };
  }
  if (here) {
    if (explicit) {
      const dp = dist(explicit);
      if ((dp != null && dp <= AT_COURSE_M) || sameCourseName(explicit.club_name, here.c.club_name)) {
        return { pick: explicit, here: false };
      }
    }
    const ownTwin = s.own.find((o) => sameCourseName(o.club_name, here!.c.club_name));
    return { pick: ownTwin ?? here.c, here: true };
  }
  if (explicit) return { pick: explicit, here: false };
  const gpsNearest = pos ? s.own[0] ?? null : null;
  return { pick: gpsNearest ?? s.preview ?? s.home ?? s.own[0] ?? null, here: false };
}
