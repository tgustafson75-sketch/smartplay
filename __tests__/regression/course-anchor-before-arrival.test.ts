import { useCaddieMemoryStore } from '../../store/caddieMemoryStore';

/**
 * 2026-08-22 — from building Sharp Park (Pacifica) end to end.
 *
 * No record from the scorecard API carries coordinates for ANY course — Sharp Park's says
 * "1 Sharp Park Rd, Pacifica, CA 94044" and nothing numeric — so the geometry build's only anchor
 * was the player physically standing on the course. Add a course at home on Wi-Fi and you got no
 * greens and no aim lines until you arrived. Google Places knew the location the whole time;
 * api/course-places asked for the place and dropped it.
 */
describe('a course knows where it is before you get there', () => {
  const CID = 'sharp-park-test';
  beforeEach(() => {
    useCaddieMemoryStore.setState({ courseBook: {} } as never);
  });

  it('keeps the coordinates Places returned', () => {
    useCaddieMemoryStore.getState().saveCourseBook({
      course_id: CID, name: 'Sharp Park Gc', website: 'https://x.test',
      lat: 37.6318, lng: -122.4936, nowMs: 1,
    });
    const b = useCaddieMemoryStore.getState().getCourseBook(CID);
    expect(b?.lat).toBeCloseTo(37.6318, 4);
    expect(b?.lng).toBeCloseTo(-122.4936, 4);
  });

  it('a later source without coordinates does not wipe them', () => {
    const s = useCaddieMemoryStore.getState();
    s.saveCourseBook({ course_id: CID, lat: 37.6318, lng: -122.4936, nowMs: 1 });
    s.saveCourseBook({ course_id: CID, about: 'Ocean-side muni', nowMs: 2 });
    const b = useCaddieMemoryStore.getState().getCourseBook(CID);
    expect(b?.lat).toBeCloseTo(37.6318, 4);
    expect(b?.about).toBe('Ocean-side muni');
  });

  it('refuses Null Island and out-of-range readings rather than anchoring a course in the ocean', () => {
    const s = useCaddieMemoryStore.getState();
    s.saveCourseBook({ course_id: CID, lat: 0, lng: 0, nowMs: 1 });
    expect(useCaddieMemoryStore.getState().getCourseBook(CID)?.lat).toBeNull();
    s.saveCourseBook({ course_id: CID, lat: 91, lng: 200, nowMs: 2 });
    expect(useCaddieMemoryStore.getState().getCourseBook(CID)?.lat).toBeNull();
  });

  it('the geometry service prefers the course book over the live GPS fix', () => {
    // The book says where the COURSE is; a GPS fix says where the PLAYER is, and those agree only
    // once you have already arrived. Order matters, so it is asserted rather than assumed.
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../services/courseGeometryService.ts'), 'utf-8');
    const book = src.indexOf('getCourseBook(courseId)');
    const gps = src.indexOf("require('./gpsManager')");
    expect(book).toBeGreaterThan(-1);
    expect(gps).toBeGreaterThan(-1);
    expect(book).toBeLessThan(gps);
  });
});
