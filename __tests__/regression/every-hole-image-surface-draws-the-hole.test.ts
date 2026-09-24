/**
 * 2026-09-23 (Tim — "correct images, not no images where appropriate"). With the bundled photos gone,
 * each surface that used to lean on one draws the hole's (or course's) real satellite image instead:
 */
import * as fs from 'fs';
import * as path from 'path';
const code = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('every hole-image surface draws the real place', () => {
  it('Play: picking a surveyed course shows its aerial (framed on its surveyed holes), not an icon', () => {
    const play = code('app/(tabs)/play.tsx');
    expect(play).toMatch(/setSelectedHero\(getCourseImageryUrl\(\{\s*courseId: row\.id,/);
    expect(play).toMatch(/latitude: row\.lat, longitude: row\.lng/);
  });

  it('Course Detail: every placed hole is a real tile (map, else its surveyed tee/green), not a gradient', () => {
    const cd = code('app/course/[course_id].tsx');
    expect(cd).toMatch(/const green = geom\?\.green \?\? pt\(surveyed\?\.middleLat, surveyed\?\.middleLng\);/);
    expect(cd).toMatch(/tile: \{ courseId: course\.id, holeNumber: h\.hole_number/);
    expect(code('components/course/HolePhotosGrid.tsx')).toMatch(/<HoleTileImage\s+input=\{p\.tile\}/);
  });

  it('Recap: the hole view is the hole\'s tile, cached-first', () => {
    expect(code('app/recap/hole/[round_id]/[hole].tsx')).toMatch(/<HoleTileImage input=\{holeTileInput\}/);
  });

  it('Caddie preview: the in-round tile uses the map, else the same resolvers SmartVision frames with', () => {
    const l1 = code('components/caddie/L1HolePreview.tsx');
    expect(l1).toMatch(/valid\(geometry\?\.green\) \?\? valid\(\(\(\) => \{ try \{ return resolveGreenCoords\(currentHole\)\.middle;/);
  });

  it('SmartVision: with no hole coordinates, the course is located by any of its own points', () => {
    const sv = code('app/smartvision.tsx');
    expect(sv).toMatch(/\?\? anyHoleOfThisCourse;/);
  });

  it('no bundled-photo code is left anywhere', () => {
    for (const f of ['app/smartvision.tsx', 'components/caddie/L1HolePreview.tsx', 'app/(tabs)/play.tsx', 'app/course/[course_id].tsx', 'app/recap/hole/[round_id]/[hole].tsx', 'app/swinglab/simround.tsx', 'data/localCourseImages.ts']) {
      expect({ f, hit: /getLocalHoleImage|_HOLE_IMAGES|palmsImage|holeLineCalibration/.test(code(f)) }).toEqual({ f, hit: false });
    }
    for (const gone of ['data/palmsImages.ts', 'data/holeLineCalibration.ts', 'app/landmark-curate.tsx']) {
      expect(fs.existsSync(path.join(__dirname, '../..', gone))).toBe(false);
    }
  });
});
