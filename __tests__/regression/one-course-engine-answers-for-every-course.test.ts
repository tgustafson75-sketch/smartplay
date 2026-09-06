/**
 * 2026-09-06 (Tim) — "all courses need to go through our course engine so we can eventually build
 * our course engine API."
 *
 * That is a product rule with a testable shape: no course may reach a data path that another course
 * cannot reach. An engine with two courses wired differently is two engines, and only one of them
 * can be sold as an API.
 *
 * The violation this file was written from was not theoretical. Menifee Palms and Lakes were the
 * only entries in constants/golfbertCourses.ts, and that mapping bought them:
 *
 *   1. A SECOND PIN SOURCE. services/smartFinderService.ts read getCachedGolfbertHole() above
 *      courseHoles in both resolveGreenCoords and resolveTeeCoords. The cache it read had exactly
 *      ONE populator in the entire app — SmartVision's mount effect — so the pin feeding every
 *      yardage depended on whether the player had opened the map that session. SmartVision first
 *      gave source 'golfbert'; straight to the caddie gave source 'courseHoles'. Same hole, same
 *      round, two different answers. Non-determinism, not a fallback.
 *
 *   2. A SECOND IMAGE PATH THAT MIS-ANCHORED. smartvision.tsx rendered Golfbert's photo between the
 *      curated crop and the Mapbox tile, and `onCuratedPhoto` went true on its presence — which
 *      switched marker placement off GPS projection and onto data/holeLineCalibration.ts. Those
 *      palms/lakes fractions were scanned FROM the bundled crops emptied on 2026-08-25, so after
 *      that date the tee and pin were anchored by measurements of an image no longer on screen.
 *      The 2026-06-23 comment in smartvision.tsx predicted this exact failure; our crop winning the
 *      race was the only thing hiding it.
 *
 *   3. A NAME-SUBSTRING GATE. StartRoundCourseCard and CourseDetailModal keyed on
 *      courseName.includes('palms') to suppress the Mapbox URL in favour of PALMS_IMAGES — a map
 *      that has been {} since 2026-08-25. Net effect: ANY course with "Palms" in its name rendered
 *      no hero and no hole thumbnails. Same family as
 *      a-course-is-not-the-first-name-that-contains-the-word.test.ts.
 *
 * These lock the SEVERANCE, not the deletion. services/golfbertApi.ts, api/golfbert-proxy.ts and
 * constants/golfbertCourses.ts stay on disk — Tim's paid access is a real capability and per the
 * LENS in CLAUDE.md an unwired capability is unconnected, not dead. What is forbidden is those
 * modules re-entering the resolver or the render path. If Golfbert is ever rewired it belongs
 * BEHIND the engine, as one provider feeding courseHoles like any other, so every course can reach
 * whatever it provides.
 */
import fs from 'fs';
import path from 'path';

/**
 * Assertions here are about CODE, not prose. The commit that severed these paths left long comments
 * naming exactly what was removed — `PALMS_IMAGES`, `golfbertHole`, `includes('palms')` — because a
 * removal nobody can explain later gets re-added. A raw substring scan would match those
 * explanations and fail, which would pressure the next reader to delete the explanation rather than
 * keep the invariant. So strip comments first and assert on what actually executes.
 *
 * Whole-line `//` only (plus block comments): trailing `//` is left alone so `https://` inside a
 * string literal survives intact.
 */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const read = (p: string) =>
  stripComments(fs.readFileSync(path.join(__dirname, '../..', p), 'utf8'));

const finder = read('services/smartFinderService.ts');
const smartvision = read('app/smartvision.tsx');
const playTab = read('app/(tabs)/play.tsx');
const startCard = read('components/course/StartRoundCourseCard.tsx');
const detailModal = read('components/course/CourseDetailModal.tsx');

describe('the pin/tee resolver answers from one cascade for every course', () => {
  it('does not import a per-course provider client', () => {
    expect(finder).not.toContain("from './golfbertApi'");
    expect(finder).not.toContain('getCachedGolfbertHole');
  });

  it('offers no provider-named source, so no caller can branch on one', () => {
    // A union member that only two courses can produce is the type-level form of the same bug.
    expect(finder).not.toMatch(/source\??:.*'golfbert'/);
  });

  it('still resolves through the shared cascade', () => {
    // Guards against "fixing" the above by deleting the resolver rather than unifying it.
    expect(finder).toContain('getCourseTruthSync');
    expect(finder).toContain('getGreenOverride');
    expect(finder).toContain('getTeeOverride');
    expect(finder).toContain("source: 'courseHoles'");
  });

  it('reaches courseHoles without a provider gate standing in front of it', () => {
    // The removed legs sat between the override check and this line. If a provider ever returns
    // above it again for a subset of courses, the same session-order non-determinism returns.
    for (const fn of ['resolveGreenCoords', 'resolveTeeCoords']) {
      const start = finder.indexOf(`function ${fn}`);
      expect(start).toBeGreaterThan(-1);
      // Cut at the next top-level declaration, not at the first `\n}` — these functions open with a
      // multi-line return-type annotation whose closing brace would truncate the body to nothing.
      const rest = finder.slice(start + 1);
      const nextDecl = rest.search(/\n(?:export )?(?:function|const|async function) /);
      const body = nextDecl === -1 ? rest : rest.slice(0, nextDecl);
      expect(body).toContain('round.courseHoles.find');
    }
  });
});

describe('SmartVision renders the same two-branch chain for every course', () => {
  it('holds no per-course provider state or fetch', () => {
    expect(smartvision).not.toContain('golfbertHole');
    expect(smartvision).not.toContain('getGolfbertHolesForCourse');
    expect(smartvision).not.toContain('hasGolfbertCourseMapping');
  });

  it('decides marker anchoring from the imagery actually on screen', () => {
    // The provider term here is what silently swapped GPS projection for calibration measured off a
    // different image. onCuratedPhoto must depend ONLY on our own curated photo being the imagery.
    expect(smartvision).toContain(
      'const onCuratedPhoto = preferCurated || (!imageUri && !!curatedImage);',
    );
  });

  it('renders curated-or-tile, with nothing wedged between them', () => {
    const branch = smartvision.slice(
      smartvision.indexOf('{preferCurated ? ('),
      smartvision.indexOf(') : loading ? ('),
    );
    expect(branch).toContain('source={curatedImage}');
    expect(branch).toContain('uri: imageUri');
    expect(branch).not.toMatch(/golfbert/i);
  });
});

describe('a course name is a label, never a data path', () => {
  it('the Start Round card does not gate imagery on the name', () => {
    expect(startCard).not.toContain("includes('palms')");
    expect(startCard).not.toContain('PALMS_IMAGES');
    // and it must actually still fetch the hero for everyone
    expect(startCard).toContain('getCourseImageryUrl({ courseId, holes }');
  });

  it('the detail modal does not gate imagery on the name', () => {
    expect(detailModal).not.toContain("includes('palms')");
    expect(detailModal).not.toContain('PALMS_IMAGES');
    expect(detailModal).toContain('const courseUrl = getCourseImageryUrl(');
  });

  it('the modal builds every hole thumbnail the same way', () => {
    // Was: `palmsImage ? null : getHoleThumbnailUrl(...)` — a null URL for a whole class of course.
    expect(detailModal).toContain('const thumbUrl = getHoleThumbnailUrl({');
    expect(detailModal).not.toContain('palmsImage');
  });
});

describe('the home courses are built like the other thirty-eight', () => {
  const entry = (id: string) => {
    const start = playTab.indexOf(`id: '${id}'`);
    expect(start).toBeGreaterThan(-1);
    return playTab.slice(start, playTab.indexOf('},', start));
  };

  it.each(['local:palms', 'local:lakes'])('%s derives its thumbnail from coordinates', id => {
    const block = entry(id);
    expect(block).toContain('thumbnail: satelliteThumb(');
    // Both previously indexed an image map that has been empty since 2026-08-25, so the field was
    // undefined and only courseThumb()'s lat/lng rescue kept the card populated at all.
    expect(block).not.toContain('PALMS_IMAGES[1]');
    expect(block).not.toContain('LAKES_HOLE_IMAGES[1]');
  });

  it('the Play tab no longer imports either home-course image map', () => {
    expect(playTab).not.toContain("from '../../data/palmsImages'");
    expect(playTab).not.toMatch(/^\s*LAKES_HOLE_IMAGES,$/m);
  });
});

describe('the paid provider is parked, not destroyed', () => {
  it('keeps the client, proxy and mapping on disk for a future rewire', () => {
    // Per CLAUDE.md's LENS: deleting a capability is the expensive mistake. Severing it is not.
    for (const p of [
      'services/golfbertApi.ts',
      'api/golfbert-proxy.ts',
      'constants/golfbertCourses.ts',
    ]) {
      expect(fs.existsSync(path.join(__dirname, '../..', p))).toBe(true);
    }
  });
});
