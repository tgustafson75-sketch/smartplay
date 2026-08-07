// 2026-08-07 (dead-code sweep) — the landmark loader functions (loadLandmarksForCourse /
// getLandmarksForHole / resolveCourseKey + the COURSE_DATA map + cache) had ZERO callers; hole-landmark
// reads go through services/holeContextResolver.ts reading data/landmarks/*.json directly. Removed the
// dead loaders. The `Landmark` TYPE is still used (app/landmark-curate.tsx), so it stays.

export interface Landmark {
  id: string;
  course_id: string;
  hole_number: number;
  name: string;
  description: string;
  side: 'left' | 'right' | 'center';
  type: 'bunker' | 'water' | 'tree' | 'rough' | 'hazard' | 'marker';
  position?: { x: number; y: number };
}
