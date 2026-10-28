/**
 * THE LOADED COURSE'S CARD, AS THE CADDIE READS IT — ONE OWNER.
 *
 * 2026-10-27 (Brain review F5). The COURSE LOADED block in api/kevin was filled only by
 * useVoiceCaddie, from a ref that hook filled at round start, and passed as a caller override. That
 * hook's sendToBrain now runs only on the follow-up listen loop: the caddie-tab first turn, the
 * earbud, the global mic, the typed box and the watch all go through askCaddie with no override, so
 * on every primary turn the caddie had no card — "what's the par on 15?" cost a lookup_hole round.
 *
 * Now the payload builder reads it here, synchronously, on every route. A bundled course is built
 * from the round's own card on the spot; a golfcourseapi course is summarised once, after a warm
 * (the builder starts it), and reads the round's card until then.
 *
 * 2026-10-28 (Brain review r2) — a course he BUILT ('custom:') is on the device like a bundled one,
 * and is read the same way (courseCard.loadCourseCard already groups the two). It used to fall to the
 * golfcourseapi warm, which cannot know the id: a billed /api/course-proxy call (and a paid upstream
 * one) on EVERY turn of the round, and the caddie never got the card the round store was holding.
 * A failed warm is remembered too, for the round — a miss must not refetch on every turn — with a
 * retry window, so a dead spot on the first tee does not cost a real course its card for four hours.
 */
import { useRoundStore } from '../store/roundStore';

const summaries = new Map<string, string>();
const warming = new Set<string>();
/** courseId → the failed warm: which round it was in, and when. */
const failed = new Map<string, { round: number | null; at: number }>();
const FAILED_RETRY_MS = 5 * 60_000;

/** Ids whose card is on the device: bundled ('local:') and built by the player ('custom:'). */
function isOnDevice(courseId: string): boolean {
  return courseId.startsWith('local:') || courseId.startsWith('custom:');
}

/** A warm that failed in THIS round, recently enough not to try again yet. A new round always retries. */
function recentlyFailed(courseId: string, now: number): boolean {
  const f = failed.get(courseId);
  if (!f) return false;
  return f.round === useRoundStore.getState().roundStartTime && now - f.at < FAILED_RETRY_MS;
}

/** The on-device card for a bundled or custom course, from the round store's holes. */
function localCard(): string | null {
  const holes = [...(useRoundStore.getState().courseHoles ?? [])].sort((a, b) => a.hole - b.hole);
  if (holes.length === 0) return null;
  return holes.map((h) => `Hole ${h.hole}: Par ${h.par}, ${h.distance} yds`).join('. ') + '.';
}

/**
 * The card for the course being played, or null when nothing is known. Never fetches.
 *
 * A golfcourseapi course reads its fuller summary (tee, hazards, rating) once warmed; until then — and
 * when the warm fails (offline, the daily quota spent) — the round's own card, which the round store
 * holds for every course. A miss here used to leave him with no par for the whole round. The caller
 * starts the warm on every turn regardless; warmCourseContext is a no-op once it has run.
 */
export function getCourseContextSync(courseId: string | null | undefined): string | null {
  if (!courseId) return null;
  if (isOnDevice(courseId)) return localCard();
  return summaries.get(courseId) ?? localCard();
}

/**
 * Fetch and summarise a golfcourseapi course once. Best-effort; a failure leaves the card absent and
 * is not retried until the retry window passes or a new round starts.
 */
export async function warmCourseContext(courseId: string | null | undefined, now: number = Date.now()): Promise<void> {
  if (!courseId || isOnDevice(courseId) || summaries.has(courseId) || warming.has(courseId)) return;
  if (recentlyFailed(courseId, now)) return;
  warming.add(courseId);
  let ok = false;
  try {
    const api = await import('./golfCourseApi');
    const course = await api.getCourse(courseId);
    if (course) { summaries.set(courseId, api.courseSummaryForContext(course)); ok = true; }
  } catch (e) {
    console.warn('[courseContext] preload failed:', e);
  } finally {
    if (ok) failed.delete(courseId);
    else failed.set(courseId, { round: useRoundStore.getState().roundStartTime, at: now });
    warming.delete(courseId);
  }
}

/** Test seam. */
export function __resetCourseContextCache(): void {
  summaries.clear();
  warming.clear();
  failed.clear();
}
