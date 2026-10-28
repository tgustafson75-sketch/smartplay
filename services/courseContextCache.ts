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
 * (the builder starts one on a miss, so at worst the first turn of a round goes without it).
 */
import { useRoundStore } from '../store/roundStore';

const summaries = new Map<string, string>();
const warming = new Set<string>();

/** The bundled card for a local course, from the round store's holes. */
function localCard(): string | null {
  const holes = [...(useRoundStore.getState().courseHoles ?? [])].sort((a, b) => a.hole - b.hole);
  if (holes.length === 0) return null;
  return holes.map((h) => `Hole ${h.hole}: Par ${h.par}, ${h.distance} yds`).join('. ') + '.';
}

/** The card for the course being played, or null when it is not known yet. Never fetches. */
export function getCourseContextSync(courseId: string | null | undefined): string | null {
  if (!courseId) return null;
  if (courseId.startsWith('local:')) return localCard();
  return summaries.get(courseId) ?? null;
}

/** Fetch and summarise a golfcourseapi course once. Best-effort; a failure leaves the card absent. */
export async function warmCourseContext(courseId: string | null | undefined): Promise<void> {
  if (!courseId || courseId.startsWith('local:') || summaries.has(courseId) || warming.has(courseId)) return;
  warming.add(courseId);
  try {
    const api = await import('./golfCourseApi');
    const course = await api.getCourse(courseId);
    if (course) summaries.set(courseId, api.courseSummaryForContext(course));
  } catch (e) {
    console.warn('[courseContext] preload failed:', e);
  } finally {
    warming.delete(courseId);
  }
}

/** Test seam. */
export function __resetCourseContextCache(): void {
  summaries.clear();
  warming.clear();
}
