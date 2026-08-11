/**
 * 2026-08-10 (Tim, after his round) — "when I went to ingest the scorecard, it only allows for one
 * picture, and it hits an error. So the pictures I took of the scorecard I wasn't able to take
 * advantage of."
 *
 * A scorecard is physically too wide to photograph legibly in one frame. His Connecticut National
 * card runs holes 1-9 + OUT, then 10-18 + IN, so he shot the front nine and the back nine
 * separately — the normal way anyone would do it. The importer accepted a single URI, so the second
 * photo had nowhere to go and the import was half a course (or failed outright).
 *
 * These lock the merge, and specifically lock that a bad photo can never damage a good one.
 */
import { mergeCourseImports } from '../../services/courseImport';
import type { CourseImportResult } from '../../services/courseImport';

const part = (over: Partial<CourseImportResult>): CourseImportResult => ({
  course_name: null, tee_name: null, location: null, holes: [], confidence: 'high', warnings: [], ...over,
});

// Front nine as read from photo 1 (real numbers off Tim's card, White tees).
const frontNine = part({
  course_name: 'Connecticut National Golf Club',
  tee_name: 'White',
  confidence: 'high',
  holes: [
    { hole: 1, par: 5, yardage: 436, handicap: 9 },
    { hole: 2, par: 4, yardage: 359, handicap: 5 },
    { hole: 3, par: 4, yardage: 369, handicap: 1 },
    { hole: 4, par: 3, yardage: 187, handicap: 7 },
    { hole: 5, par: 4, yardage: 304, handicap: 11 },
    { hole: 6, par: 5, yardage: 512, handicap: 3 },
    { hole: 7, par: 3, yardage: 145, handicap: 15 },
    { hole: 8, par: 4, yardage: 312, handicap: 13 },
    { hole: 9, par: 3, yardage: 137, handicap: 17 },
  ],
});

// Back nine from photo 2 — same card, different frame, so the name may not be visible.
const backNine = part({
  confidence: 'medium',
  holes: Array.from({ length: 9 }, (_, i) => ({
    hole: 10 + i, par: 4, yardage: 350 + i, handicap: 2 + i,
  })),
});

describe("Tim's card: two photos become one 18-hole course", () => {
  const merged = mergeCourseImports([frontNine, backNine]);

  it('produces all 18 holes, in order', () => {
    expect(merged.holes).toHaveLength(18);
    expect(merged.holes.map(h => h.hole)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it('keeps the real front-nine numbers off his card', () => {
    expect(merged.holes[0]).toMatchObject({ hole: 1, par: 5, yardage: 436 });
    expect(merged.holes[5]).toMatchObject({ hole: 6, par: 5, yardage: 512 });
  });

  it('takes the course name from whichever photo showed it', () => {
    expect(merged.course_name).toBe('Connecticut National Golf Club');
    expect(merged.tee_name).toBe('White');
  });

  it('reports the LOWEST confidence — the course is only as good as its worst photo', () => {
    expect(merged.confidence).toBe('medium');
  });
});

describe('a bad photo cannot damage a good one', () => {
  it('never overwrites a value already read cleanly', () => {
    const good = part({ holes: [{ hole: 1, par: 5, yardage: 436, handicap: 9 }] });
    const garbled = part({ holes: [{ hole: 1, par: 3, yardage: 43, handicap: 1 }] });
    const merged = mergeCourseImports([good, garbled]);
    expect(merged.holes[0]).toMatchObject({ par: 5, yardage: 436, handicap: 9 });
  });

  it('DOES fill a gap the first photo could not read', () => {
    const partial = part({ holes: [{ hole: 1, par: 5, yardage: null, handicap: null }] });
    const filler = part({ holes: [{ hole: 1, par: null, yardage: 436, handicap: 9 }] });
    const merged = mergeCourseImports([partial, filler]);
    expect(merged.holes[0]).toMatchObject({ par: 5, yardage: 436, handicap: 9 });
  });

  it('drops out-of-range hole numbers rather than trusting them', () => {
    const junk = part({ holes: [{ hole: 0, par: 4, yardage: 300, handicap: 1 }, { hole: 27, par: 4, yardage: 300, handicap: 1 }] });
    expect(mergeCourseImports([frontNine, junk]).holes).toHaveLength(9);
  });

  it('accumulates warnings from every photo without duplicating them', () => {
    const a = part({ warnings: ['blurry column'] });
    const b = part({ warnings: ['blurry column', 'glare'] });
    expect(mergeCourseImports([a, b]).warnings).toEqual(['blurry column', 'glare']);
  });

  it('a single photo still works exactly as before', () => {
    const merged = mergeCourseImports([frontNine]);
    expect(merged.holes).toHaveLength(9);
    expect(merged.confidence).toBe('high');
  });
});

/**
 * 2026-08-11 (Tim) — "Remember, on the scorecards, a lot of times it'll have a course layout that
 * gives us some kind of references to work from. Make sure that's ingested correctly. Injection and
 * logic are key."
 *
 * The importer read the TABLE only. The printed map is the one place a scorecard says which way a
 * hole BENDS — the yardage row can never tell you that — so a caddie on an unmapped course had no
 * way to know the 4th doglegs left. Layout is optional by design: most cards have no usable map, and
 * null is the correct answer there rather than an empty array that reads as "no hazards exist".
 */
describe('course-layout diagram ingestion', () => {
  const withLayout = (over: Partial<CourseImportResult>): CourseImportResult =>
    part({ holes: [{ hole: 1, par: 4, yardage: 410, handicap: 5 }], ...over });

  it('carries shape and hazards through the merge', () => {
    const merged = mergeCourseImports([
      withLayout({ layout: [{ hole: 1, shape: 'dogleg_right', hazards: [{ kind: 'water', side: 'left' }] }] }),
    ]);
    expect(merged.layout?.[0]).toMatchObject({ hole: 1, shape: 'dogleg_right' });
    expect(merged.layout?.[0].hazards[0]).toMatchObject({ kind: 'water', side: 'left' });
  });

  it('a card with NO diagram yields null, not an empty array', () => {
    // Empty would read downstream as "we looked and there are no hazards" — a different claim.
    expect(mergeCourseImports([withLayout({})]).layout).toBeNull();
  });

  it('first good reading wins — a blurrier second photo cannot overwrite a clear map', () => {
    const clear = withLayout({ layout: [{ hole: 1, shape: 'dogleg_left', hazards: [{ kind: 'bunker', side: 'right' }] }] });
    const blurry = withLayout({ layout: [{ hole: 1, shape: 'straight', hazards: [] }] });
    const merged = mergeCourseImports([clear, blurry]);
    expect(merged.layout?.[0].shape).toBe('dogleg_left');
    expect(merged.layout?.[0].hazards).toHaveLength(1);
  });

  it('fills a gap the first photo could not read', () => {
    const noShape = withLayout({ layout: [{ hole: 1, shape: null, hazards: [] }] });
    const hasShape = withLayout({ layout: [{ hole: 1, shape: 'dogleg_right', hazards: [{ kind: 'water', side: 'right' }] }] });
    const merged = mergeCourseImports([noShape, hasShape]);
    expect(merged.layout?.[0].shape).toBe('dogleg_right');
    expect(merged.layout?.[0].hazards).toHaveLength(1);
  });

  it('front-nine and back-nine maps merge into one 18-hole layout', () => {
    const front = withLayout({ layout: [{ hole: 1, shape: 'straight', hazards: [] }] });
    const back = withLayout({ layout: [{ hole: 10, shape: 'dogleg_left', hazards: [] }] });
    const merged = mergeCourseImports([front, back]);
    expect(merged.layout?.map(l => l.hole)).toEqual([1, 10]);
  });

  it('drops out-of-range hole numbers from the diagram read', () => {
    const junk = withLayout({ layout: [{ hole: 0, shape: 'straight', hazards: [] }, { hole: 44, shape: 'straight', hazards: [] }] });
    expect(mergeCourseImports([junk]).layout).toBeNull();
  });
});
