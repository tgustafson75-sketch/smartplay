import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * 2026-08-06 (Tim — "build the course download engine / future API"). Tracks which courses have been
 * DOWNLOADED for offline / instant use (geometry + content + intelligence + imagery prefetched) so the app
 * can (a) skip the "Course Download Recommended" nag once a course is local, and (b) show a live download
 * progress state when the engine is pulling one. Persisted so downloads survive restarts.
 */
export interface DownloadedCourse {
  courseId: string;
  name: string;
  holeCount: number;
  at: number;
  /**
   * 2026-09-10 — how many holes came back with a GREEN when this course was built.
   *
   * A course used to be recorded as downloaded whether its geometry build returned eighteen greens
   * or none, so "downloaded" could mean "you will have no measured yardage for the whole round" and
   * nothing distinguished the two. Recording it lets the next round start re-attempt a course that
   * built empty instead of trusting a tick from weeks ago.
   *
   * `undefined` on records written before this existed — read it as UNKNOWN, never as zero: an
   * older record almost certainly has greens, and treating it as empty would re-build every course
   * the player owns. [[a-field-that-is-sometimes-a-placeholder]]
   */
  greens?: number;
  /**
   * 2026-09-23 — set on an ALIAS row: an id the player asked for (a `place:` near-you id, or a
   * database id that is a surveyed course) recorded so the next ask is answered from the store. The
   * course itself is the row under `aliasOf`; an alias row is never listed.
   */
  aliasOf?: string;
}

/**
 * 2026-09-23 — the stage a course build is in, for the live progress on its card. `downloading` was
 * written by the engine for weeks and rendered nowhere; this is what the Play tab now draws.
 */
export type CourseBuildStage = 'card' | 'map' | 'imagery' | 'notes';

export interface DownloadingState {
  name: string;
  /** 0..1 */
  progress: number;
  stage?: CourseBuildStage;
  /** Set when the build ended without a course — the card says why instead of silently vanishing. */
  failed?: string;
}

interface DownloadedCoursesState {
  downloaded: Record<string, DownloadedCourse>;
  downloading: Record<string, DownloadingState>;
  markDownloading: (courseId: string, name: string, progress: number, stage?: CourseBuildStage) => void;
  markDownloaded: (c: DownloadedCourse) => void;
  clearDownloading: (courseId: string) => void;
  markBuildFailed: (courseId: string, name: string, reason: string) => void;
  isDownloaded: (courseId: string | null | undefined) => boolean;
  reset: () => void;
}

export const useDownloadedCoursesStore = create<DownloadedCoursesState>()(
  persist(
    (set, get) => ({
      downloaded: {},
      downloading: {},
      markDownloading: (courseId, name, progress, stage) =>
        set((s) => ({ downloading: { ...s.downloading, [courseId]: { name, progress: Math.max(0, Math.min(1, progress)), stage } } })),
      markDownloaded: (c) =>
        set((s) => {
          const nextDownloading = { ...s.downloading };
          delete nextDownloading[c.courseId];
          return { downloaded: { ...s.downloaded, [c.courseId]: c }, downloading: nextDownloading };
        }),
      markBuildFailed: (courseId, name, reason) =>
        set((s) => ({ downloading: { ...s.downloading, [courseId]: { name, progress: 0, failed: reason } } })),
      clearDownloading: (courseId) =>
        set((s) => {
          const next = { ...s.downloading };
          delete next[courseId];
          return { downloading: next };
        }),
      isDownloaded: (courseId) => (courseId ? !!get().downloaded[courseId] : false),
      reset: () => set({ downloaded: {}, downloading: {} }),
    }),
    {
      name: 'downloaded-courses-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      // Don't persist the transient in-flight progress map.
      partialize: (s) => ({ downloaded: s.downloaded }),
    },
  ),
);
