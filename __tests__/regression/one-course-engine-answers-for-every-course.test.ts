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
 * SEVERED FIRST, THEN DELETED (Tim's call, 2026-09-06). The initial pass parked golfbertApi.ts on
 * disk under CLAUDE.md's LENS — an unwired capability is unconnected, not dead. The sim disagreed,
 * and it was right: `scripts/simulations/marshal.ts` counts a shipped file nothing imports as an
 * ISLAND, and says to resolve one "by wiring the file up or deleting it WITH its guards — never by
 * adding a line here." Parking it would have meant a guard certifying code that cannot run, which is
 * the exact failure (hooks/useKevin.ts, green for a month) that check exists to catch. So
 * services/golfbertApi.ts, api/golfbert-proxy.ts and constants/golfbertCourses.ts are gone, with
 * their sim guard and orphan-baseline entries, recoverable from commit eb0a20b6.
 *
 * If Golfbert is ever rewired it belongs BEHIND the engine, as one provider feeding courseHoles like
 * any other, so every course reaches it through the same call — returning null for the unmapped ones
 * is a DATA difference, which is fine. A second code path reachable by two courses is not.
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

describe('the two-course provider is gone, not hiding', () => {
  it('leaves no client, proxy or mapping behind to be re-imported', () => {
    for (const p of [
      'services/golfbertApi.ts',
      'api/golfbert-proxy.ts',
      'constants/golfbertCourses.ts',
    ]) {
      expect(fs.existsSync(path.join(__dirname, '../..', p))).toBe(false);
    }
  });

  it('drops its route from vercel.json rather than leaving a 404 endpoint declared', () => {
    const vercel = fs.readFileSync(path.join(__dirname, '../../vercel.json'), 'utf8');
    expect(vercel).not.toContain('golfbert');
  });

  it('takes its sim guard and orphan-baseline entries with it', () => {
    // marshal.ts: a guard on a file nothing imports proves nothing, and ORPHAN_BASELINE may not
    // carry entries for exports that no longer exist.
    const sim = fs.readFileSync(path.join(__dirname, '../../scripts/simulations/run-sim.ts'), 'utf8');
    const orphans = fs.readFileSync(
      path.join(__dirname, '../../scripts/simulations/orphanExports.ts'), 'utf8');
    expect(sim).not.toContain("read('services/golfbertApi.ts')");
    expect(orphans).not.toContain('services/golfbertApi.ts');
  });
});

describe('one slug resolver, id first, shared by every surface', () => {
  it('SmartVision holds no private name-to-id matcher of its own', () => {
    // A seven-rule duplicate of getLocalCourseSlug lived here, `void`ed but intact, and had missed
    // BOTH fixes the real one received: the isAmbiguousComplexName gate (2026-09-05) and the
    // `shadow` rule ahead of a bare `lakes` (2026-09-01, after Shadow Lakes resolved to Menifee).
    expect(smartvision).not.toContain("if (n.includes('palms')) return 'local:palms';");
    expect(smartvision).not.toContain("if (n.includes('lakes')) return 'local:lakes';");
    expect(smartvision).not.toContain('homeCourseIdFromProfile');
  });

  it('resolves the centroid and the calibration through the SAME resolver', () => {
    // These asked the same question two ways: calibration was id-first, the centroid was name-only.
    // The centroid decides where the aerial is CENTRED, so a name collision there is a confidently
    // wrong picture of another club.
    expect(smartvision).toContain('resolveLocalSlug(courseId, courseName)');
    // No direct name-only resolution left in executing code — the history of it stays in comments.
    expect(smartvision).not.toContain('getLocalCourseSlug(');
  });

  it('keeps id-resolution free of any provider module', () => {
    expect(smartvision).not.toContain('localSlugFromAnyCourseId');
    expect(smartvision).toContain("from '../data/courseSlug'");
  });
});

/**
 * 2026-09-06 (Tim — "make sure all the course books are clean, all thumbnails are clean and the whole
 * setup stays commercially elite").
 *
 * data/courseComplexes.ts carries its own standing instruction: "Add a property here the moment a
 * second layout is bundled for it — the cost of a missing entry is the Menifee bug, silently, on
 * somebody's home course." That instruction had never been enforced, and two of the three
 * multi-layout properties already in the bundle (Coyote Creek, Gleneagles) were unregistered.
 *
 * Neither had bitten yet only because getLocalCourseSlug happens to carry no `coyote` or `gleneagles`
 * name rule. The collision was one well-meaning line away — which is precisely how "Shadow Lakes"
 * reached Menifee's Lakes on 2026-09-01. This derives the facility list from the shipped courses
 * rather than restating it, so a THIRD layout added tomorrow fails here on the day it lands.
 */
describe('every multi-layout facility in the bundle is a registered complex', () => {
  const complexes = read('data/courseComplexes.ts');

  /** club_name up to the layout separator — "Gleneagles — King's" → "gleneagles". */
  const facilityOf = (clubName: string) =>
    clubName.split(/[—(]/)[0].trim().toLowerCase();

  const courses = (() => {
    const block = playTab.slice(
      playTab.indexOf('const LOCAL_COURSES_RAW'),
      playTab.indexOf('\n];', playTab.indexOf('const LOCAL_COURSES_RAW')),
    );
    const out: { id: string; name: string }[] = [];
    let id: string | null = null;
    for (const line of block.split('\n')) {
      const mId = /id: 'local:([^']+)'/.exec(line);
      if (mId) id = mId[1];
      const mName = /club_name: ['"](.+?)['"],/.exec(line);
      if (mName && id) { out.push({ id, name: mName[1] }); id = null; }
    }
    return out;
  })();

  it('parses the shipped course list (guards the parser itself)', () => {
    // A silent parse failure would make every assertion below vacuously true.
    expect(courses.length).toBeGreaterThan(30);
  });

  const byFacility = courses.reduce<Record<string, string[]>>((acc, c) => {
    const f = facilityOf(c.name);
    (acc[f] ??= []).push(c.id);
    return acc;
  }, {});
  const multiLayout = Object.entries(byFacility).filter(([, ids]) => ids.length > 1);

  it('finds the facilities that ship more than one layout', () => {
    expect(multiLayout.length).toBeGreaterThanOrEqual(3);
  });

  it.each(multiLayout)('%s is registered in COURSE_COMPLEXES', facility => {
    // The distinctive first word is enough: entries are keyed/regexed on the facility stem.
    const stem = facility.split(/\s+/)[0];
    expect(complexes.toLowerCase()).toContain(stem);
  });
});

/**
 * The thumbnail half of the same ask. These are correctness properties, not style: a 0,0 coordinate
 * centres a satellite tile in the Gulf of Guinea, and a thumbnail built from a DIFFERENT course's
 * coordinates is a confidently wrong picture — worse than no picture, which is the standard
 * courseThumb() already holds itself to.
 */
describe('every bundled course card carries an honest thumbnail', () => {
  const entries = (() => {
    const block = playTab.slice(
      playTab.indexOf('const LOCAL_COURSES_RAW'),
      playTab.indexOf('\n];', playTab.indexOf('const LOCAL_COURSES_RAW')),
    );
    const out: { id: string; thumb: [number, number] | null; lat: number | null; lng: number | null }[] = [];
    let cur: (typeof out)[number] | null = null;
    for (const line of block.split('\n')) {
      const mId = /id: 'local:([^']+)'/.exec(line);
      if (mId) { if (cur) out.push(cur); cur = { id: mId[1], thumb: null, lat: null, lng: null }; }
      if (!cur) continue;
      const mT = /thumbnail: satelliteThumb\((-?[\d.]+), (-?[\d.]+)\)/.exec(line);
      if (mT) cur.thumb = [Number(mT[1]), Number(mT[2])];
      const mLat = /\blat: (-?[\d.]+)/.exec(line);
      if (mLat) cur.lat = Number(mLat[1]);
      const mLng = /\blng: (-?[\d.]+)/.exec(line);
      if (mLng) cur.lng = Number(mLng[1]);
    }
    if (cur) out.push(cur);
    return out;
  })();

  it('parses the shipped course list (guards the parser itself)', () => {
    expect(entries.length).toBeGreaterThan(30);
  });

  it.each(entries.map(e => [e.id, e] as const))('%s has real coordinates', (_id, e) => {
    expect(e.lat).not.toBeNull();
    expect(e.lng).not.toBeNull();
    // 0,0 is the placeholder that produced the ocean thumbnails isValidGolfCoord was written for.
    expect(Math.abs(e.lat as number) > 0.001 || Math.abs(e.lng as number) > 0.001).toBe(true);
    expect(Math.abs(e.lat as number)).toBeLessThanOrEqual(90);
    expect(Math.abs(e.lng as number)).toBeLessThanOrEqual(180);
  });

  it.each(entries.map(e => [e.id, e] as const))(
    '%s builds its thumbnail from its OWN coordinates',
    (_id, e) => {
      expect(e.thumb).not.toBeNull();
      expect(e.thumb).toEqual([e.lat, e.lng]);
    },
  );
});
