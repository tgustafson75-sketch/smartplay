/**
 * 2026-07-01 (Tim — "I can ingest a card, a range card, ahead of time... take a screenshot and
 * wire in the scorecard" + "load a course not in the DB from a scorecard photo").
 *
 * Persisted store of the player's OWN courses, built by parsing a scorecard photo (par + yardage
 * per hole) when a course isn't in golfcourseapi. These slot alongside the bundled `local:` courses
 * and API courses in the Play picker, and startRound() loads them by a `custom:` id. GPS per hole
 * is unknown from a card (yardage-only), so on-course yardage falls back to the scorecard number
 * until the player marks tees/greens — same honest-degrade the rest of the app uses.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { getPersistStorage } from '../services/ssrSafeStorage';

export interface CustomCourseHole {
  hole: number;
  par: number;
  /** Yardage from the scorecard (the chosen tee). null if unreadable. */
  distance: number | null;
  /** Stroke index / handicap from the card, if read. */
  handicap?: number | null;
}

export interface CustomCourse {
  /** `custom:<slug>` — the id startRound()/the picker use. */
  id: string;
  name: string;
  /** Tee the yardages were read from (e.g. "White"). */
  teeName?: string | null;
  location?: string | null;
  holes: CustomCourseHole[];
  createdAt: number;
  source: 'scorecard_photo' | 'manual';
}

interface CustomCourseState {
  courses: Record<string, CustomCourse>;
  addCustomCourse: (course: Omit<CustomCourse, 'id' | 'createdAt'> & { id?: string; createdAt?: number }) => CustomCourse;
  removeCustomCourse: (id: string) => void;
  getCustomCourse: (id: string) => CustomCourse | null;
  listCustomCourses: () => CustomCourse[];
}

// Deterministic slug from the name (no Date.now/Math.random in the id so it's stable + dedupes
// re-imports of the same course). Suffix with a short hash of the hole pars to disambiguate two
// cards with the same name but different data.
function slugify(name: string, holes: CustomCourseHole[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'course';
  let h = 0;
  for (const hole of holes) h = (h * 31 + hole.par * 100 + (hole.distance ?? 0)) % 100000;
  return `custom:${base}-${h}`;
}

export const useCustomCourseStore = create<CustomCourseState>()(
  persist(
    (set, get) => ({
      courses: {},
      addCustomCourse: (input) => {
        const id = input.id ?? slugify(input.name, input.holes);
        const course: CustomCourse = {
          id,
          name: input.name,
          teeName: input.teeName ?? null,
          location: input.location ?? null,
          holes: input.holes,
          createdAt: input.createdAt ?? Date.now(),
          source: input.source,
        };
        set((s) => ({ courses: { ...s.courses, [id]: course } }));
        return course;
      },
      removeCustomCourse: (id) =>
        set((s) => {
          const next = { ...s.courses };
          delete next[id];
          return { courses: next };
        }),
      getCustomCourse: (id) => get().courses[id] ?? null,
      listCustomCourses: () =>
        Object.values(get().courses).sort((a, b) => b.createdAt - a.createdAt),
    }),
    {
      name: 'custom-courses-v1',
      storage: createJSONStorage(() => getPersistStorage()),
      version: 1,
      migrate: (s) => s as never,
    },
  ),
);
