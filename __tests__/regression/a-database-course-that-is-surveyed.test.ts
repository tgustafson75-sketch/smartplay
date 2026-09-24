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
  const herm = jest.requireActual('../../data/courses').getBundledCourseCentroid('hermitage-pr');
  const byId: Record<string, unknown> = {
    'berlin-db': card('berlin-db', 'Berlin Country Club', berlin.lat + 0.01, berlin.lng),
    'berlin-germany': card('berlin-germany', 'Berlin Country Club', 52.5, 13.4),
    'menifee-db': card('menifee-db', 'Menifee Lakes Country Club', 33.68, -117.18),
    // Found by the triple-check: the club name claimed a sister layout, and no location meant no check.
    'generals-retreat': { ...card('generals-retreat', 'Hermitage Golf Course', herm.lat, herm.lng), course_name: "General's Retreat" },
    'westlake-nowhere': card('westlake-nowhere', 'Westlake Country Club', 0, 0),
    // ...and the positive case the stricter rule first lost: the surveyed layout itself.
    'presidents-reserve': { ...card('presidents-reserve', 'Hermitage Golf Course', herm.lat, herm.lng), course_name: "President's Reserve" },
    'berlin-championship': { ...card('berlin-championship', 'Berlin Country Club', berlin.lat + 0.01, berlin.lng), course_name: 'Championship' },
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

  it('a sister layout at a surveyed club is not the surveyed layout', async () => {
    expect((await loadCourseCard('generals-retreat'))?.source).toBe('database');
  });

  it('the surveyed layout itself is matched by club + layout, and a generic layout label is the club', async () => {
    expect((await loadCourseCard('presidents-reserve'))?.courseId).toBe('local:hermitage-pr');
    expect((await loadCourseCard('berlin-championship'))?.courseId).toBe('local:berlin-cc');
  });

  it('a record with no location is never claimed by name alone', async () => {
    expect((await loadCourseCard('westlake-nowhere'))?.source).toBe('database');
  });

  it('a download stored under a bare surveyed slug (before 2026-09-23) is the surveyed course, not a row of its own', () => {
    const { canonicalCourseId } = jest.requireActual('../../services/courseCard');
    const { downloadedCourseSummaries } = jest.requireActual('../../services/courseDownloadEngine');
    expect(canonicalCourseId('palms')).toBe('local:palms');
    expect(canonicalCourseId('e90nbvs4')).toBe('e90nbvs4');
    expect(downloadedCourseSummaries({ palms: { courseId: 'palms', name: 'Palms' }, x: { courseId: 'x', name: 'X' } }).map((r: { id: string }) => r.id)).toEqual(['x']);
    const play = jest.requireActual('fs').readFileSync(jest.requireActual('path').join(__dirname, '../../app/(tabs)/play.tsx'), 'utf8');
    expect(play).toMatch(/map\(d => canonicalCourseId\(d\?\.courseId \?\? ''\)\)/);
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
    // Everything between the surveyed branch and the database enrichment (`.then(apiId =>`) must
    // end in a return: only blank rating/slope may be filled from the record (the async merge).
    const guard = src.slice(i, src.indexOf('resolveLocalCourseId(slug).then(apiId =>'));
    expect(guard).toMatch(/fetchCourseGeometry\(course_id,[\s\S]*\}\s*return;\s*\}/);
    expect(src).toMatch(/checkedHoles = dataCourse \? getBundledHoles\(course_id\)/);
  });

  it('Course Detail opened on a surveyed twin\'s database id opens the surveyed card; blank rating/slope are filled from the verified record', () => {
    const fs = jest.requireActual('fs') as typeof import('fs');
    const path = jest.requireActual('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../app/course/[course_id].tsx'), 'utf8');
    expect(src).toMatch(/const twin = c \? surveyedTwinOf\(c\) : null;\s*if \(twin && !cancelled\) \{\s*router\.replace\(`\/course\/\$\{twin\}`/);
    expect(src).toMatch(/course_rating: t\.course_rating \?\? tee\.course_rating \?\? null/);
  });
});
