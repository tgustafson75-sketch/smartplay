/**
 * 2026-10-05 (Tim, in Eastvale CA: the Play tab said "NEAREST · 32 mi — Menifee Lakes" and the GPS
 * refresh button "is not working").
 *
 * GPS was right. The NEAREST card took the nearest of the player's OWN saved courses, so away from home
 * it named his home club while the courses down the road (found by discovery) sat further down the tab.
 * The refresh button re-sorted that same list — and used a cached fix up to 30 minutes old, i.e. from
 * before the drive — so it visibly did nothing.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(path.join(__dirname, '../../app/(tabs)/play.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

describe('NEAREST means nearest', () => {
  it('the card takes the nearest of saved AND discovered courses, by real distance', () => {
    expect(src).toMatch(/for \(const c of \[\.\.\.closestLocal, \.\.\.nearbyApiCourses\]\)/);
    expect(src).toMatch(/const heroCourse: CourseSummary \| null = \(!isRoundActive && userPosition && !atCourse\?\.sibling\)\s*\? nearestOverall/);
    expect(src).not.toMatch(/\?\s*\(closestLocal\[0\] \?\? null\)\s*:\s*null;/);
  });

  it('a discovered course starts with its REAL id, never the synthetic place: id', () => {
    expect(src).toMatch(/const startRoundAtCourse = async \(s: CourseSummary\) => \{\s*if \(String\(s\.id\)\.startsWith\('place:'\) \|\| String\(s\.id\)\.startsWith\('near:'\)\) \{\s*const found = await searchCourses/);
  });

  it('the refresh button takes a FRESH fix, re-runs discovery, and says what happened', () => {
    expect(src).toMatch(/refreshLocation\(\{ retries: 1, manual: true \}\)/);
    expect(src).toMatch(/if \(!opts\?\.manual\) try \{\s*const last = await Location\.getLastKnownPositionAsync/);
    expect(src).toMatch(/setDiscoveryNonce\(\(n\) => n \+ 1\)/);
    expect(src).toMatch(/\}, \[userPosition, customSummaries, discoveryNonce\]\);/);
    expect(src).toMatch(/Couldn't get a GPS fix/);
  });
});
