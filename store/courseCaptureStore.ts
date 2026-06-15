/**
 * 2026-06-13 (Tim) — Course-data bootstrap store.
 *
 * As you play, you CAPTURE the real view (photo + GPS + compass heading) tagged to
 * course/hole. Every round on a new course builds that course's player's-eye imagery
 * for free — fills the empty previews, and (later) feeds the 360 view + faster trace.
 * Self-growing spatial data, the visual sibling of the CNS brain. See memory:
 * roadmap-3d-4d (course-data bootstrap).
 *
 * This store holds the MANIFEST; the JPEGs live in FileSystem (uri references).
 * Persisted, bounded per hole. Honest: only real captured frames — no fabrication.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export type CaptureKind = 'single' | 'pano';

// 2026-06-14 (Tim) — delete the underlying files when manifest entries are dropped
// (the per-hole cap, clearHole, clearAll). Without this, orphaned JPEG/MP4s leaked in
// course_captures/ forever. Best-effort, fire-and-forget, never throws into a set().
function deleteCaptureFiles(uris: string[]): void {
  if (uris.length === 0) return;
  void (async () => {
    try {
      const FS = await import('expo-file-system/legacy');
      for (const uri of uris) {
        if (uri) await FS.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
      }
    } catch { /* GC is best-effort */ }
  })();
}

export interface CourseCapture {
  id: string;
  uri: string;            // FileSystem path to the JPEG
  lat: number | null;
  lng: number | null;
  heading: number | null; // compass degrees the camera faced (0..360)
  kind: CaptureKind;
  /** Groups frames from one 360 turn so a viewer can show them in heading order. */
  panoSessionId?: string | null;
  ts: number;
}

const MAX_PER_HOLE = 24; // keep the most recent N per hole (a 360 turn is ~8-12 frames)

function keyOf(courseId: string, hole: number): string {
  return `${courseId}:${hole}`;
}

interface CourseCaptureState {
  /** key = `${courseId}:${hole}` → captures (newest last). */
  captures: Record<string, CourseCapture[]>;
  addCapture: (courseId: string, hole: number, cap: CourseCapture) => void;
  forHole: (courseId: string | null, hole: number) => CourseCapture[];
  /** The capture best facing `targetHeading` (e.g. toward the green); else newest single; else newest. */
  bestForward: (courseId: string | null, hole: number, targetHeading?: number | null) => CourseCapture | null;
  clearHole: (courseId: string, hole: number) => void;
  clearAll: () => void;
}

/** Smallest absolute angle between two compass headings (0..180). */
function headingDelta(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180);
  return d;
}

export const useCourseCaptureStore = create<CourseCaptureState>()(
  persist(
    (set, get) => ({
      captures: {},
      addCapture: (courseId, hole, cap) => {
        if (!courseId || !Number.isFinite(hole)) return;
        const k = keyOf(courseId, hole);
        set((s) => {
          const prev = s.captures[k] ?? [];
          const merged = [...prev, cap];
          const kept = merged.slice(-MAX_PER_HOLE);
          // GC the files for entries pushed out past the per-hole cap.
          if (merged.length > kept.length) {
            deleteCaptureFiles(merged.slice(0, merged.length - kept.length).map((c) => c.uri));
          }
          return { captures: { ...s.captures, [k]: kept } };
        });
      },
      forHole: (courseId, hole) => (courseId ? get().captures[keyOf(courseId, hole)] ?? [] : []),
      bestForward: (courseId, hole, targetHeading) => {
        const list = courseId ? get().captures[keyOf(courseId, hole)] ?? [] : [];
        if (list.length === 0) return null;
        if (typeof targetHeading === 'number') {
          // Closest-facing capture to the target (green) heading.
          let best = list[0];
          let bestD = best.heading != null ? headingDelta(best.heading, targetHeading) : 999;
          for (const c of list) {
            const d = c.heading != null ? headingDelta(c.heading, targetHeading) : 999;
            if (d < bestD) { best = c; bestD = d; }
          }
          return best;
        }
        // No target → newest single, else newest of any kind.
        const singles = list.filter((c) => c.kind === 'single');
        return (singles.length ? singles : list)[(singles.length ? singles : list).length - 1];
      },
      clearHole: (courseId, hole) => set((s) => {
        const k = keyOf(courseId, hole);
        deleteCaptureFiles((s.captures[k] ?? []).map((c) => c.uri));
        const next = { ...s.captures };
        delete next[k];
        return { captures: next };
      }),
      clearAll: () => set((s) => {
        deleteCaptureFiles(Object.values(s.captures).flat().map((c) => c.uri));
        return { captures: {} };
      }),
    }),
    {
      name: 'course-captures-v1',
      version: 1,
      migrate: (s) => s as never, // 2026-06-15 (audit) — passthrough; no silent wipe on bump
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
