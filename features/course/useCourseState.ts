/**
 * useCourseState.ts
 *
 * Local-only course state hook for the Course Builder feature.
 * No Zustand, no backend — pure useState with helpers.
 */

import { useState, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export type HoleData = {
  hole: number;
  par: number;
  yardage: number;
  features: string[];
  notes: string;
  imageUri?: string;
};

export type CourseData = {
  name: string;
  holes: HoleData[];
};

// ── Default 18-hole scaffold (used when editing manually) ─────────────────────

export const defaultHoles = (): HoleData[] =>
  Array.from({ length: 18 }, (_, i) => ({
    hole: i + 1,
    par: 4,
    yardage: 350,
    features: [],
    notes: '',
  }));

// ── Hook ──────────────────────────────────────────────────────────────────────

export const useCourseState = () => {
  const [course, setCourse] = useState<CourseData | null>(null);
  const [editingHole, setEditingHole] = useState<HoleData | null>(null);

  const createFromParsed = useCallback(
    (
      name: string,
      parsedHoles: Array<{ hole: number; par: number; yardage: number }>,
    ) => {
      setCourse({
        name,
        holes: parsedHoles.map((h) => ({
          ...h,
          features: [],
          notes: '',
        })),
      });
    },
    [],
  );

  const createBlank = useCallback((name: string) => {
    setCourse({ name, holes: defaultHoles() });
  }, []);

  const updateHole = useCallback((updated: HoleData) => {
    setCourse((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        holes: prev.holes.map((h) => (h.hole === updated.hole ? updated : h)),
      };
    });
  }, []);

  const setCourseName = useCallback((name: string) => {
    setCourse((prev) => (prev ? { ...prev, name } : prev));
  }, []);

  const reset = useCallback(() => {
    setCourse(null);
    setEditingHole(null);
  }, []);

  return {
    course,
    editingHole,
    setEditingHole,
    createFromParsed,
    createBlank,
    updateHole,
    setCourseName,
    reset,
  };
};
