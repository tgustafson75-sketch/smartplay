/**
 * 2026-10-13 (Tim — "I still get a course I am not near if I am standing on a course… I got Echo Hills
 * the last time I stood at Hemet, probably both the last times").
 *
 * The Play card opened on `previewCourseId ?? closestLocal[0]`. Only bundled surveys carried a
 * position in his list, so at Hemet Golf Club the nearest "of his" was Echo Hills (8 km); Google had
 * found Hemet Golf Club 2 m away and that list was never asked. The guess then saved itself as his pick
 * and won every launch after. Real coordinates below (Places + the course database, measured live).
 */
import { chooseDefaultCourse, decideAutoPick, sameCourseName, AT_COURSE_M } from '../../services/yourCourses';

type Row = { id: string; club_name: string; lat?: number; lng?: number };

const HEMET_GC_AT = { lat: 33.7501, lng: -117.0511 };              // standing on Hemet Golf Club
const echo: Row = { id: 'local:echo-hills', club_name: 'Echo Hills Golf Course', lat: 33.7244, lng: -116.965 };
const hemetPlace: Row = { id: 'place:hemet', club_name: 'Hemet Golf Club', lat: 33.7501046, lng: -117.0510753 };
const hemetMine: Row = { id: '8c6dnfpj', club_name: 'Hemet Golf Club', lat: 33.7501046, lng: -117.0510753 };
const palms: Row = { id: 'local:menifee-palms', club_name: 'Menifee Lakes — Palms', lat: 33.6874, lng: -117.1712 };
const lakes: Row = { id: 'local:menifee-lakes', club_name: 'Menifee Lakes — Lakes', lat: 33.6852, lng: -117.1651 };
const AT_PALMS = { lat: 33.6869, lng: -117.1690 };

const base = { own: [] as Row[], discovered: [] as Row[], preview: null as Row | null, previewExplicit: false, home: null as Row | null };

describe('the Play card opens on the course he is standing at', () => {
  it('THE BUG: at Hemet Golf Club, with only Echo Hills placed in his list → Hemet Golf Club', () => {
    const r = chooseDefaultCourse({ ...base, position: HEMET_GC_AT, own: [echo], discovered: [hemetPlace] });
    expect(r.pick?.club_name).toBe('Hemet Golf Club');
    expect(r.here).toBe(true);
  });

  it('an earlier AUTOMATIC pick of Echo Hills does not beat where he stands', () => {
    const r = chooseDefaultCourse({ ...base, position: HEMET_GC_AT, own: [echo], discovered: [hemetPlace], preview: echo, previewExplicit: false });
    expect(r.pick?.id).toBe('place:hemet');
  });

  it('a pick he made ELSEWHERE does not beat where he stands either', () => {
    const r = chooseDefaultCourse({ ...base, position: HEMET_GC_AT, own: [echo], discovered: [hemetPlace], preview: echo, previewExplicit: true });
    expect(r.pick?.id).toBe('place:hemet');
  });

  it('a discovered course that is already his opens as HIS row', () => {
    const r = chooseDefaultCourse({ ...base, position: HEMET_GC_AT, own: [hemetMine, echo], discovered: [hemetPlace] });
    expect(r.pick?.id).toBe('8c6dnfpj');
  });

  it('sibling courses at one clubhouse: his own pick here stands (Palms vs Lakes)', () => {
    const r = chooseDefaultCourse({ ...base, position: AT_PALMS, own: [palms, lakes], preview: lakes, previewExplicit: true });
    expect(r.pick?.id).toBe('local:menifee-lakes');
    expect(r.here).toBe(false);
  });

  it('away from every course: his pick, then the nearest of his, then an old automatic pick, then home', () => {
    const home = { lat: 34.2, lng: -117.6 };   // nowhere near a course
    expect(chooseDefaultCourse({ ...base, position: home, own: [echo], preview: hemetMine, previewExplicit: true }).pick?.id).toBe('8c6dnfpj');
    expect(chooseDefaultCourse({ ...base, position: home, own: [echo], preview: hemetMine, previewExplicit: false }).pick?.id).toBe('local:echo-hills');
    expect(chooseDefaultCourse({ ...base, position: null, own: [echo], preview: hemetMine, previewExplicit: false }).pick?.id).toBe('8c6dnfpj');
    expect(chooseDefaultCourse({ ...base, position: null, own: [], home: echo }).pick?.id).toBe('local:echo-hills');
  });

  it('"at" means within AT_COURSE_M, and a 0,0 position is never a place', () => {
    expect(AT_COURSE_M).toBe(1500);
    const nullIsland: Row = { id: 'x', club_name: 'Nowhere', lat: 0, lng: 0 };
    const r = chooseDefaultCourse({ ...base, position: { lat: 0.0001, lng: 0.0001 }, own: [], discovered: [nullIsland] });
    expect(r.here).toBe(false);
  });

  it('names match across sources, not across courses', () => {
    expect(sameCourseName('Hemet Golf Club', 'Hemet Golf Club')).toBe(true);
    expect(sameCourseName('The Hemet Golf Club', 'Hemet GC')).toBe(true);
    expect(sameCourseName('Hemet Golf Club', 'Echo Hills Golf Course')).toBe(false);
    expect(sameCourseName('Golf Club', 'Golf Course')).toBe(false);   // an empty core never matches
  });
});

describe('an automatic pick yields to where he is — once, and never his own pick', () => {
  const s = { hasSelection: true, loading: false, error: false, activeRoundCourse: null as Row | null };
  it('corrects the automatic Echo Hills pick when discovery finds the course he is at', () => {
    expect(decideAutoPick({ ...s, lastPickWasAutomatic: true, lastAutoPickId: echo.id, defaultPick: hemetPlace, defaultIsHere: true })?.id).toBe('place:hemet');
  });
  it('never twice: the discovered row resolving to a database id is not a new pick', () => {
    expect(decideAutoPick({ ...s, lastPickWasAutomatic: true, lastAutoPickId: hemetPlace.id, defaultPick: hemetPlace, defaultIsHere: true })).toBeNull();
  });
  it('never over a course HE picked', () => {
    expect(decideAutoPick({ ...s, lastPickWasAutomatic: false, lastAutoPickId: echo.id, defaultPick: hemetPlace, defaultIsHere: true })).toBeNull();
  });
  it('never mid-round, and never on a default that is not "here"', () => {
    expect(decideAutoPick({ ...s, activeRoundCourse: echo, lastPickWasAutomatic: true, lastAutoPickId: echo.id, defaultPick: hemetPlace, defaultIsHere: true })).toBeNull();
    expect(decideAutoPick({ ...s, lastPickWasAutomatic: true, lastAutoPickId: echo.id, defaultPick: hemetPlace, defaultIsHere: false })).toBeNull();
  });
});

describe('a place resolves to the database record AT it', () => {
  it('accepts the record at the clubhouse and refuses one 8 km away (the old 5-mile rule took it)', async () => {
    const { nearestRecordId, SAME_COURSE_M } = jest.requireActual('../../services/golfCourseApi') as typeof import('../../services/golfCourseApi');
    const recs: Record<string, { location: { latitude: number; longitude: number } }> = {
      '8c6dnfpj': { location: { latitude: 33.7501046, longitude: -117.0510753 } },   // Hemet Golf Club
      'ww9fg9h7': { location: { latitude: 33.7247429, longitude: -116.9660309 } },   // Echo Hills, 8 km
    };
    const lookup = async (id: string) => recs[id] ?? null;
    expect(SAME_COURSE_M).toBe(3000);
    expect(await nearestRecordId(['ww9fg9h7', '8c6dnfpj'], HEMET_GC_AT, lookup)).toBe('8c6dnfpj');
    expect(await nearestRecordId(['ww9fg9h7'], HEMET_GC_AT, lookup)).toBeNull();
    expect(await nearestRecordId(['ww9fg9h7'], null, lookup)).toBe('ww9fg9h7');
    expect(await nearestRecordId(['gone'], HEMET_GC_AT, lookup)).toBe('gone');   // unplaceable: name match stands
  });

  it('the download engine asks the same owner, with the position it was handed', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/courseDownloadEngine.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toMatch(/await nearestRecordId\([\s\S]{0,120}near \?\? null\)/);
    expect(src).not.toMatch(/const first = hits\?\.\[0\]/);
    expect((src.match(/resolveCourse\(input\.name, input\.courseId \?\? null, placeOfInput\(input\)\)/g) ?? []).length).toBe(2);
  });
});
