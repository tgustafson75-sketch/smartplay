import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

/**
 * 2026-08-06 (Tim — "the putting read (SmartGreens) worked fantastic but it doesn't go anywhere — it
 * doesn't get saved, you don't see it"). PuttCameraOverlay computed a green read (feet, slope, break,
 * advice) purely in component state and discarded it on unmount. This is the durable home for those reads,
 * so they persist, can be recalled per hole, and can be surfaced later (recap/dashboard is the fast-follow).
 * Deliberately small + capped — a read is a lightweight record, not a media blob.
 */
export interface GreenRead {
  id: string;
  at: number;
  courseId: string | null;
  courseName: string | null;
  hole: number | null;
  feetEst: number | null;
  slopePct: number | null;
  /** The spoken/shown advice, e.g. "plays fairly straight, soft pace — downhill, let it die." */
  text: string;
}

interface GreenReadState {
  reads: GreenRead[];
  logRead: (r: Omit<GreenRead, 'id'>) => void;
  lastForHole: (courseId: string | null, hole: number | null) => GreenRead | null;
  clear: () => void;
}

const CAP = 200;

export const useGreenReadStore = create<GreenReadState>()(
  persist(
    (set, get) => ({
      reads: [],
      logRead: (r) =>
        set((s) => ({
          reads: [{ ...r, id: `gr_${r.at}_${Math.round((r.feetEst ?? 0) * 10)}` }, ...s.reads].slice(0, CAP),
        })),
      lastForHole: (courseId, hole) =>
        get().reads.find((x) => x.courseId === courseId && x.hole === hole) ?? null,
      clear: () => set({ reads: [] }),
    }),
    {
      name: 'green-reads-v1',
      storage: createJSONStorage(() => getPersistStorage()),
    },
  ),
);
