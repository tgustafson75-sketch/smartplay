/**
 * 2026-10-14 — SmartBay lessons imported from the bay's report (services/bayExchange.ts), kept whole
 * so SwingLab can show the fix, cue, drill and before → after. Newest first, capped at 20. Deduped
 * by bay + lesson time, so importing the same file twice adds nothing.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';
import type { BayLessonExport } from '../services/bayExchange';

interface BayLessonState {
  lessons: BayLessonExport[];
  /** False when this lesson is already stored. */
  add: (x: BayLessonExport) => boolean;
}

const same = (a: BayLessonExport, b: BayLessonExport) => a.source.bay === b.source.bay && a.lesson.at === b.lesson.at;

export const useBayLessonStore = create<BayLessonState>()(
  persist(
    (set, get) => ({
      lessons: [],
      add: (x) => {
        if (get().lessons.some((l) => same(l, x))) return false;
        set((s) => ({ lessons: [x, ...s.lessons].sort((a, b) => b.lesson.at - a.lesson.at).slice(0, 20) }));
        return true;
      },
    }),
    {
      name: 'bay-lessons-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      partialize: (s) => ({ lessons: s.lessons }),
    },
  ),
);
