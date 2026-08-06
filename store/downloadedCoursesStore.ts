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
}

interface DownloadingState {
  name: string;
  /** 0..1 */
  progress: number;
}

interface DownloadedCoursesState {
  downloaded: Record<string, DownloadedCourse>;
  downloading: Record<string, DownloadingState>;
  markDownloading: (courseId: string, name: string, progress: number) => void;
  markDownloaded: (c: DownloadedCourse) => void;
  clearDownloading: (courseId: string) => void;
  isDownloaded: (courseId: string | null | undefined) => boolean;
  reset: () => void;
}

export const useDownloadedCoursesStore = create<DownloadedCoursesState>()(
  persist(
    (set, get) => ({
      downloaded: {},
      downloading: {},
      markDownloading: (courseId, name, progress) =>
        set((s) => ({ downloading: { ...s.downloading, [courseId]: { name, progress: Math.max(0, Math.min(1, progress)) } } })),
      markDownloaded: (c) =>
        set((s) => {
          const nextDownloading = { ...s.downloading };
          delete nextDownloading[c.courseId];
          return { downloaded: { ...s.downloaded, [c.courseId]: c }, downloading: nextDownloading };
        }),
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
