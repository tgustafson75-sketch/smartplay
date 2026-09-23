/**
 * 2026-09-23 (Tim) — "on properties that have more than one course, the tee box on one location should
 * be the verifier, and it should do a check and reconcile." Then: "always switch automatically … do it
 * quietly and quickly in the background." And: "this is not an MVP, this is a commercially available app."
 *
 * THE GAP. Hole detection, Refresh GPS and the off-course detector all measure the player against the
 * layout the round was STARTED on. Nothing ever asked whether the tee they are standing on belongs to a
 * different layout at the same property — so a round started on Dye's Valley while the player tees off
 * on the Stadium course carried the wrong pars, yardages, map and hole views all day.
 *
 * THE RULE. A tee box is the one place a player's position identifies a layout unambiguously. While a
 * round is live on a multi-layout property, this watches for the player STANDING on a tee (good fix,
 * not moving, dwelling) and asks which layout that tee belongs to:
 *   - on a tee of the active layout → confirmed; any contrary evidence is discarded;
 *   - on a sibling layout's tee, clearly NOT on a shared tee complex (the active layout's nearest tee
 *     is well away) → evidence for that sibling;
 *   - two such tees on different holes, or one when the active layout has no tee anywhere near →
 *     switch the round to the sibling, silently, keeping every score and shot already recorded.
 *
 * Deliberately NOT here: any spoken interruption (Tim: quietly), and any guess from a name. Evidence is
 * position only, and a single observation on a shared tee box never moves a round.
 */
import { haversineYards } from '../utils/geoDistance';
import { isValidGolfCoord } from '../utils/coordGuard';

// ─── Tunables (golf rationale) ────────────────────────────────────────────────────────────────────
/** On a tee: within this of a tee marker's recorded point. A tee box is ~10-30 yards deep. */
export const ON_TEE_YD = 20;
/** A sibling tee counts only when the active layout's nearest tee is at least this much farther —
 *  below it the two layouts share a tee complex and position cannot tell them apart. */
export const SHARED_TEE_MARGIN_YD = 40;
/** One tee is proof on its own when the active layout has NO tee within this — nowhere near it. */
export const UNAMBIGUOUS_ACTIVE_YD = 150;
/** Standing, not passing: the same tee for this long. */
export const DWELL_MS = 12_000;
/** Only trust fixes this good. */
export const MAX_ACCURACY_M = 15;
/** Walking pace or slower (m/s); a cart driving past a tee is not standing on it. */
export const MAX_SPEED_MS = 1.6;

export type LatLng = { lat: number; lng: number };
export type LayoutTees = {
  courseId: string;
  tees: { hole: number; tee: LatLng }[];
  /** How many holes the layout has — so "no tee near" can be told apart from "tees not known". */
  holeCount?: number;
};
/** The active layout must have tees for at least this share of its holes before its ABSENCE near
 *  the player can mean anything. A map still building, timed out, or without greens is unknown. */
export const MIN_ACTIVE_TEE_COVERAGE = 0.75;
export type TeeObservation = { at: LatLng; accuracyM: number | null; speedMs: number | null; ts: number };

export type VerifierState = {
  /** The tee the player is currently dwelling on, and since when. */
  dwell: { courseId: string; hole: number; since: number } | null;
  /** Tee visits on ONE sibling layout since the last active-layout confirmation. */
  evidence: { courseId: string; holes: number[] } | null;
  /** Once a visit is counted for a dwell, it is not counted again. */
  countedDwellKey: string | null;
};

export const INITIAL_STATE: VerifierState = { dwell: null, evidence: null, countedDwellKey: null };


/** The tees a player can legitimately be standing on: the current hole's, or the next one's. */
function expectedHoles(currentHole: number, holeCount: number): Set<number> {
  const out = new Set<number>([currentHole]);
  if (currentHole + 1 <= Math.max(holeCount, currentHole)) out.add(currentHole + 1);
  return out;
}

/**
 * Pure step: one observation in, the next state and (maybe) a layout to switch to out.
 * Everything that decides a switch lives here, so every rule above is testable without a phone.
 *
 * 2026-09-23 (third pass) — HOLE-AWARE. The first version asked only "which layout's tee is this?",
 * so a ball or a parked cart beside ANOTHER layout's tee, anywhere on the property, was evidence —
 * measured on the real Menifee data, a 12-second stop near Lakes 6 while playing Palms 3 switched a
 * correctly started round and moved the scoring hole. A layout mismatch shows up where the player is
 * SUPPOSED to be: on the tee of their current hole or the next one. Only those tees count, for every
 * layout — which is also what separates 27-hole combos, where one physical tee is hole 1 of one
 * layout and hole 10 of another.
 */
export function observeTee(
  state: VerifierState,
  obs: TeeObservation,
  active: LayoutTees,
  siblings: LayoutTees[],
  currentHole: number,
): { state: VerifierState; switchTo: { courseId: string; hole: number } | null } {
  const unchanged = { state, switchTo: null };
  if (obs.accuracyM == null || obs.accuracyM > MAX_ACCURACY_M) return unchanged;
  if (obs.speedMs != null && obs.speedMs > MAX_SPEED_MS) return { state: { ...state, dwell: null }, switchTo: null };

  const teeNear = (layout: LayoutTees, holes: Set<number>) => {
    let best: { hole: number; d: number } | null = null;
    for (const t of layout.tees) {
      if (!holes.has(t.hole) || !isValidGolfCoord(t.tee.lat, t.tee.lng)) continue;
      const d = haversineYards(obs.at, t.tee);
      if (!best || d < best.d) best = { hole: t.hole, d };
    }
    return best;
  };
  const activeExpected = teeNear(active, expectedHoles(currentHole, active.holeCount ?? active.tees.length));

  // Which EXPECTED tee (if any) is the player standing on? The active layout's wins any tie.
  let on: { courseId: string; hole: number } | null = null;
  if (activeExpected && activeExpected.d <= ON_TEE_YD) on = { courseId: active.courseId, hole: activeExpected.hole };
  else {
    const hits: { courseId: string; hole: number; d: number }[] = [];
    for (const sib of siblings) {
      const n = teeNear(sib, expectedHoles(currentHole, sib.holeCount ?? sib.tees.length));
      if (n && n.d <= ON_TEE_YD) hits.push({ courseId: sib.courseId, ...n });
    }
    // Two sibling layouts both expecting the player on this spot cannot be told apart.
    if (hits.length === 1) on = { courseId: hits[0].courseId, hole: hits[0].hole };
  }
  if (!on) return { state: { ...state, dwell: null }, switchTo: null };

  const sameDwell = state.dwell && state.dwell.courseId === on.courseId && state.dwell.hole === on.hole;
  const dwell = sameDwell ? state.dwell! : { courseId: on.courseId, hole: on.hole, since: obs.ts };
  const next: VerifierState = { ...state, dwell };
  if (obs.ts - dwell.since < DWELL_MS) return { state: next, switchTo: null };

  const key = `${dwell.courseId}#${dwell.hole}#${dwell.since}`;
  if (state.countedDwellKey === key) return { state: next, switchTo: null };
  next.countedDwellKey = key;

  // On the active layout's expected tee: the round is on the right course. Forget any doubt.
  if (on.courseId === active.courseId) return { state: { ...next, evidence: null }, switchTo: null };

  // "The active layout's tee is not here" only means something when the active layout's tees are KNOWN.
  const activeHoles = active.holeCount ?? active.tees.length;
  if (!activeHoles || active.tees.length / activeHoles < MIN_ACTIVE_TEE_COVERAGE) return { state: next, switchTo: null };

  // The active layout's own expected tee is close by: a shared tee complex, position cannot decide.
  const activeD = activeExpected ? activeExpected.d : Infinity;
  if (activeD - ON_TEE_YD < SHARED_TEE_MARGIN_YD) return { state: next, switchTo: null };

  // Evidence accumulates on CONSECUTIVE holes of one sibling — a player moving along its routing.
  const prior = next.evidence && next.evidence.courseId === on.courseId ? next.evidence.holes : [];
  const last = prior[prior.length - 1];
  const holes = last === on.hole ? prior : last != null && on.hole === last + 1 ? [...prior, on.hole] : [on.hole];
  next.evidence = { courseId: on.courseId, holes };

  const decisive = holes.length >= 2 || activeD >= UNAMBIGUOUS_ACTIVE_YD;
  return decisive
    ? { state: INITIAL_STATE, switchTo: { courseId: on.courseId, hole: on.hole } }
    : { state: next, switchTo: null };
}

// ─── Runtime: siblings, the poller, the switch ────────────────────────────────────────────────────

const POLL_MS = 4_000;
/** A fix older than this is not "where the player is now". Generous on purpose: the OS may stop
 *  emitting fixes while the player stands still (a distance filter), and standing still on a tee is
 *  exactly the case being measured. Walking away produces a new fix, which ends the dwell. */
const MAX_FIX_AGE_MS = 30_000;
/** Siblings to consider per property — a 36- or 54-hole facility, never a whole search page. */
const MAX_SIBLINGS = 3;
/** Layouts of one property share its grounds; ~5.5 km covers the largest multi-course resorts. */
const SAME_PROPERTY_YD = 6_000;

type Sibling = { courseId: string; courseName: string; holes: import('../store/roundStore').CourseHole[]; courseLocation: LatLng | null };

let pollTimer: ReturnType<typeof setInterval> | null = null;
let state: VerifierState = INITIAL_STATE;
let siblings: Sibling[] = [];
let siblingsFor: string | null = null;
let resolving: Promise<void> | null = null;
let resolvedAt = 0;
/** An empty answer may have been a network blip at round start; ask again this often. */
const RERESOLVE_EMPTY_MS = 10 * 60 * 1000;

const norm = (s: string | null | undefined) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * The other layouts at the active course's property.
 *  - Bundled courses: the complex registry (data/courseComplexes) — same facility, different layout.
 *  - Database courses: the same club in golfcourseapi (search by the club's own name, same club_name,
 *    different id). Their maps are built through the one pipeline's geometry service, deduped and
 *    cached, so a player standing on a sibling tee can be recognised.
 * Returns [] for a single-layout property — the common case costs one cached search.
 */
export async function resolveSiblings(activeId: string, activeName: string): Promise<Sibling[]> {
  if (activeId.startsWith('custom:')) return [];
  if (activeId.startsWith('local:')) {
    const { resolveComplex } = require('../data/courseComplexes') as typeof import('../data/courseComplexes');
    const { COURSES, getBundledHoles } = require('../data/courses') as typeof import('../data/courses');
    const mine = resolveComplex(activeName);
    if (mine.kind !== 'layout') return [];
    const local = COURSES
      .filter((c) => {
        const r = resolveComplex(c.name);
        return r.kind === 'layout' && r.complex.key === mine.complex.key && r.layout !== mine.layout && `local:${c.id}` !== activeId;
      })
      .slice(0, MAX_SIBLINGS)
      .map((c) => ({ courseId: `local:${c.id}`, courseName: c.name, holes: getBundledHoles(`local:${c.id}`), courseLocation: null }))
      .filter((s) => s.holes.length > 0);
    // Bundled layouts without surveyed tees (Gleneagles has none) get theirs from the engine map, as
    // database siblings do; without this their tees were only known if the map happened to be built.
    const geoLocal = require('./courseGeometryService') as typeof import('./courseGeometryService');
    await Promise.all(local.map((sib) => geoLocal.fetchCourseGeometry(sib.courseId).catch(() => null)));
    return local;
  }
  const api = require('./golfCourseApi') as typeof import('./golfCourseApi');
  const card = await api.getCourse(activeId);
  if (!card?.club_name) return [];
  const hits = await api.searchCourses(card.club_name);
  const ids = hits
    .filter((h) => !h._error && h.id && String(h.id) !== activeId && norm(h.club_name) === norm(card.club_name))
    .map((h) => String(h.id))
    .slice(0, MAX_SIBLINGS);
  const home = isValidGolfCoord(card.location?.latitude, card.location?.longitude)
    ? { lat: card.location.latitude as number, lng: card.location.longitude as number } : null;
  const out: Sibling[] = [];
  for (const id of ids) {
    const c = await api.getCourse(id);
    if (!c) continue;
    // Same NAME is not the same property: there is a "Riverside Golf Course" in half the states. A
    // sibling layout shares the grounds, so it must sit within a few kilometres of this one.
    if (home && isValidGolfCoord(c.location?.latitude, c.location?.longitude) &&
        haversineYards(home, { lat: c.location.latitude as number, lng: c.location.longitude as number }) > SAME_PROPERTY_YD) continue;
    const holes = api.courseToHoles(c);
    if (!holes.length) continue;
    const loc = isValidGolfCoord(c.location?.latitude, c.location?.longitude)
      ? { lat: c.location.latitude as number, lng: c.location.longitude as number } : null;
    const { courseDisplayLabel } = require('../data/courseComplexes') as typeof import('../data/courseComplexes');
    out.push({ courseId: id, courseName: courseDisplayLabel(c.club_name, c.course_name), holes, courseLocation: loc });
  }
  // Build their maps (deduped/cached by the geometry service) so their tees are known on the course.
  const geo = require('./courseGeometryService') as typeof import('./courseGeometryService');
  await Promise.all(out.map((s) => geo.fetchCourseGeometry(s.courseId, { courseLocation: s.courseLocation }).catch(() => null)));
  return out;
}

function teesOf(courseId: string, holes: { hole: number }[]): LayoutTees {
  const { teeForHole } = require('./holeDetection') as typeof import('./holeDetection');
  const tees: LayoutTees['tees'] = [];
  for (const h of holes) {
    const t = teeForHole(courseId, h.hole);
    if (t) tees.push({ hole: h.hole, tee: t });
  }
  return { courseId, tees, holeCount: holes.length };
}

function tick(): void {
  try {
    const round = (require('../store/roundStore') as typeof import('../store/roundStore')).useRoundStore.getState();
    if (!round.isRoundActive || round.isSimRound || !round.activeCourseId) return;
    const activeId = round.activeCourseId;
    if (siblingsFor !== activeId) {
      if (!resolving) {
        siblingsFor = activeId;
        siblings = [];
        state = INITIAL_STATE;
        resolving = resolveSiblings(activeId, round.activeCourse ?? '')
          .then((s) => { if (siblingsFor === activeId) { siblings = s; resolvedAt = Date.now(); } })
          .catch(() => { siblingsFor = null; })
          .finally(() => { resolving = null; });
      }
      return;
    }
    if (!siblings.length) {
      if (resolvedAt && Date.now() - resolvedAt > RERESOLVE_EMPTY_MS) { siblingsFor = null; resolvedAt = 0; }
      return;
    }
    const { getLastFix } = require('./gpsManager') as typeof import('./gpsManager');
    const fix = getLastFix();
    if (!fix || (fix.source && fix.source !== 'live') || Date.now() - fix.timestamp > MAX_FIX_AGE_MS) return;
    // Twice around: the second nine repeats the first, so only its own nine is the active layout.
    const activeHoles = round.courseHoles.filter((h) => !(round.twiceAround && h.hole > 9));
    const hole = round.twiceAround && round.currentHole > 9 ? round.currentHole - 9 : round.currentHole;
    const r = observeTee(
      state,
      // Wall-clock time, not the fix's: a stationary player may get no new fixes, and the dwell is time
      // spent standing there, not time between fixes.
      { at: { lat: fix.lat, lng: fix.lng }, accuracyM: fix.accuracy_m, speedMs: fix.speed, ts: Date.now() },
      teesOf(activeId, activeHoles),
      siblings.map((s) => teesOf(s.courseId, s.holes)),
      hole,
    );
    state = r.state;
    if (r.switchTo) applySwitch(r.switchTo.courseId, r.switchTo.hole);
  } catch { /* a verifier must never break the round */ }
}

function applySwitch(courseId: string, hole: number): void {
  const sib = siblings.find((s) => s.courseId === courseId);
  if (!sib) return;
  const roundMod = require('../store/roundStore') as typeof import('../store/roundStore');
  const round = roundMod.useRoundStore.getState();
  const from = round.activeCourse;
  // On the second nine of a twice-around round, the same tee is hole N+9.
  // (Only when the NEW layout is itself a nine played twice — decided by it, not by the old round.)
  let current = sib.holes.length === 9 && round.twiceAround && round.currentHole > 9 && hole <= 9 ? hole + 9 : hole;
  // Never land the player on a hole that already has a score: scores stay on their hole numbers.
  if (round.scores[current] != null) current = round.currentHole;
  round.switchRoundLayout({ courseId, courseName: sib.courseName, holes: sib.holes, courseLocation: sib.courseLocation, currentHole: current });
  // The new layout gets the full pipeline — its notes, brief and hole imagery — so the caddie is not
  // describing the old one. Deliberate (paid) and deduped/cached like any pick.
  void import('./courseDownloadEngine')
    .then((eng) => eng.downloadCourse({ name: sib.courseName, courseId, lat: sib.courseLocation?.lat ?? null, lng: sib.courseLocation?.lng ?? null }))
    .catch(() => undefined);
  // The old layout becomes a sibling of the new one; re-resolve from the new layout on the next tick.
  siblingsFor = null;
  siblings = [];
  state = INITIAL_STATE;
  // Quiet, per Tim: no speech. One line on screen and a breadcrumb, so a switch is never invisible.
  try {
    (require('../store/toastStore') as typeof import('../store/toastStore')).useToastStore.getState()
      .show(`You're on ${sib.courseName} — switched from ${from ?? 'the other course'}`);
  } catch { /* toast is best-effort */ }
  try {
    (require('../store/issueLogStore') as typeof import('../store/issueLogStore')).useIssueLogStore.getState()
      .addAppEvent('layout_switched', { from: from ?? null, to: sib.courseName, hole: current }, 'diag');
  } catch { /* breadcrumb is best-effort */ }
}

export function startLayoutVerifier(): void {
  if (pollTimer) return;
  pollTimer = setInterval(tick, POLL_MS);
  tick();
}

export function stopLayoutVerifier(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  state = INITIAL_STATE;
  siblings = [];
  siblingsFor = null;
}

/** Test seam: run one poll synchronously, and inject resolved siblings. */
export function _tickForTests(): void { tick(); }
export function _setSiblingsForTests(forId: string, s: Sibling[]): void { siblingsFor = forId; siblings = s; state = INITIAL_STATE; }
