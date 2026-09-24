/**
 * 2026-09-23 (Tim — "Keep it as verified data inside the one pipeline") — a database course that IS
 * one of the surveyed courses gets the survey: real tee/green coordinates, checked tees, the local id
 * its map is built under. One rule in the course card, so round start, the Play card, SmartVision and
 * the download engine all agree — the old override ran at round start only, by a fuzzy name alone.
 */
jest.mock('../../services/golfCourseApi', () => {
  const actual = jest.requireActual('../../services/golfCourseApi');
  const card = (id: string, club: string, lat: number, lng: number) => ({
    id, club_name: club, course_name: club,
    location: { city: '', state: '', country: 'US', latitude: lat, longitude: lng },
    tees: [{ tee_name: 'W', course_rating: 70, slope_rating: 120, total_yards: 6000, par_total: 72,
      holes: Array.from({ length: 18 }, (_, i) => ({ hole_number: i + 1, par: 4, yardage: 350, handicap: i + 1 })) }],
    cached_at: 0,
  });
  const berlin = jest.requireActual('../../data/courses').getBundledCourseCentroid('berlin-cc');
  const byId: Record<string, unknown> = {
    'berlin-db': card('berlin-db', 'Berlin Country Club', berlin.lat + 0.01, berlin.lng),
    'berlin-germany': card('berlin-germany', 'Berlin Country Club', 52.5, 13.4),
    'menifee-db': card('menifee-db', 'Menifee Lakes Country Club', 33.68, -117.18),
  };
  return { ...actual, getCourse: jest.fn(async (id: string) => byId[id] ?? null), peekCachedCourse: jest.fn(async (id: string) => byId[id] ?? null) };
});

import { loadCourseCard } from '../../services/courseCard';
import { getBundledHoles } from '../../data/courses';

describe('a database course that is a surveyed course gets the survey', () => {
  it('Berlin found by search opens as the surveyed Berlin: its id, its checked holes', async () => {
    const c = await loadCourseCard('berlin-db');
    expect(c?.courseId).toBe('local:berlin-cc');
    expect(c?.source).toBe('surveyed');
    expect(c?.holes).toEqual(getBundledHoles('local:berlin-cc'));
  });

  it('a namesake in another country is not the surveyed course', async () => {
    const c = await loadCourseCard('berlin-germany');
    expect(c?.courseId).toBe('berlin-germany');
    expect(c?.source).toBe('database');
  });

  it('a name that means two surveyed courses (Menifee Palms / Lakes) is not guessed', async () => {
    const c = await loadCourseCard('menifee-db');
    expect(c?.source).toBe('database');
  });

  it('Course Detail keeps a surveyed card — no background swap to the database record', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/course/[course_id].tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const i = src.indexOf('if (realHoles) {');
    expect(i).toBeGreaterThan(-1);
    const guard = src.slice(i, src.indexOf('void resolveLocalCourseId(slug)'));
    expect(guard).toMatch(/fetchCourseGeometry\(course_id,[\s\S]*return;/);
    expect(src).toMatch(/checkedHoles = dataCourse \? getBundledHoles\(course_id\)/);
  });
});
