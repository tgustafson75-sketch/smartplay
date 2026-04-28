import type { CourseHole } from '../store/roundStore';

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

const cache: Record<string, Landmark[]> = {};

const COURSE_DATA: Record<string, () => Promise<Landmark[]>> = {
  palms: () => import('../data/landmarks/palms.json').then(m => m.default as Landmark[]),
};

export async function loadLandmarksForCourse(course_id: string): Promise<Landmark[]> {
  const key = course_id.toLowerCase();
  if (cache[key]) return cache[key];
  const loader = COURSE_DATA[key];
  if (!loader) return [];
  const data = await loader();
  cache[key] = data;
  return data;
}

export async function getLandmarksForHole(
  course_id: string,
  hole_number: number,
): Promise<Landmark[]> {
  const all = await loadLandmarksForCourse(course_id);
  return all.filter(l => l.hole_number === hole_number);
}

export function resolveCourseKey(
  courseId: string | null,
  courseName: string | null,
): string | null {
  if (courseId) {
    const known = Object.keys(COURSE_DATA);
    if (known.includes(courseId.toLowerCase())) return courseId.toLowerCase();
  }
  if (courseName) {
    const lower = courseName.toLowerCase();
    if (lower.includes('palms')) return 'palms';
  }
  return null;
}
