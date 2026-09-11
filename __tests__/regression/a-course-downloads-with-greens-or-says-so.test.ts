/**
 * 2026-09-10 (Tim, Hemet) — A BUILD THAT PRODUCED NO GREENS REPORTED SUCCESS.
 *
 * He downloaded the course, the engine "spun and loaded", and he got a tick. Then the yardage never
 * populated for eighteen holes, because `courseToHoles` writes literal zeros into every green
 * coordinate for a golfcourseapi course and the geometry build — the only thing that fills them —
 * came back empty. Nothing distinguished that from a course that built perfectly, and nothing ever
 * went back for it.
 *
 * These lock the three seams that let a silent empty build reach a first tee. Each is asserted on
 * the real source, and each fails on the code as it stood this morning.
 */
import fs from 'fs';
import path from 'path';

const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

const prefetch = read('services/roundPrefetch.ts');
const download = read('services/courseDownloadEngine.ts');
const store = read('store/downloadedCoursesStore.ts');
const api = read('api/course-geometry.ts');

describe('a course downloads with greens, or says it did not', () => {
  it('measures GREENS, not holes cached — a zero-green cache is never served', () => {
    // `cacheIsServable` refuses a zero-green entry, so "holes cached: N" could report a cache that
    // no consumer will ever read. mappedHoleCount is the count that means anything.
    expect(prefetch).toContain('mappedHoleCount');
    expect(prefetch).toContain('greens mapped:');
    expect(prefetch).not.toContain("'— holes cached:'");
  });

  it('retries once when the build comes back with zero greens', () => {
    // The engine fans out to golfcourseapi plus Overpass, and Overpass throttles — an empty first
    // answer is usually transient, and a healthy rebuild was measured at ~3s.
    expect(prefetch).toMatch(/greens === 0[\s\S]{0,400}retrying once/);
  });

  it('prefetchRoundData reports the green count to its caller', () => {
    // Returning void is what made an empty build indistinguishable from a good one at the one place
    // that records the course as owned.
    expect(prefetch).toMatch(/export async function prefetchRoundData\([\s\S]{0,80}Promise<number>/);
  });

  it('the downloaded record carries the green count', () => {
    expect(store).toMatch(/greens\?: number/);
    expect(download).toContain('greens });');
  });

  it('an already-downloaded course with ZERO greens is rebuilt, not skipped', () => {
    // The early return made "already downloaded" permanent, including for a course downloaded empty.
    expect(download).toContain('needsGeometry');
    expect(download).toMatch(/rec\.greens === 0/);
    expect(download).toMatch(/isDownloaded\(input\.courseId\) && !needsGeometry\(input\.courseId\)/);
  });

  it('UNKNOWN is not treated as empty — older records must not all rebuild', () => {
    // `greens: undefined` is a record written before the field existed. Reading it as zero would
    // re-build every course the player already owns.
    expect(download).toMatch(/rec\.greens === 0/);
    expect(download).not.toMatch(/!rec\.greens\b/);
    expect(download).not.toMatch(/rec\.greens\s*\?\?\s*0\s*===\s*0/);
  });

  it('an upstream failure falls back to OSM instead of losing the course', () => {
    // Measured 2026-09-10: the OSM path returns 18/18 greens for Hemet in 3.2s from the same
    // centroid the failing request already carries.
    expect(api).toMatch(/if \(centroid && !osmOnly\)/);
    expect(api).toMatch(/falling back to OSM synthesis/);
    expect(api).toContain("osmOnly: '1'");
  });

  it('the OSM fallback cannot recurse — the re-entered call returns before this fetch', () => {
    // Guarded by `!osmOnly`: the re-entered request has osmOnly='1' and is answered by that branch.
    const at = api.indexOf('falling back to OSM synthesis');
    expect(at).toBeGreaterThan(-1);
    const guard = api.lastIndexOf('if (centroid && !osmOnly)', at);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(at);
  });

  it('the request is mutated, not spread — a spread IncomingMessage loses its prototype', () => {
    expect(api).toMatch(/req\.query = \{/);
    expect(api).not.toMatch(/\.\.\.req,\s*\n\s*query:/);
  });

  it('a course with no greens still downloads — degraded, not blocked', () => {
    // Honest degradation is the product rule; refusing the download would be worse than a course
    // that plays on estimates.
    expect(download).toMatch(/greens === 0[\s\S]{0,300}console\.warn/);
    // 2026-09-10 — was an ADJACENCY assertion (markDownloaded immediately followed by the return).
    // The alias write for `place:` ids now sits between them, which changes nothing about the
    // invariant: the course is recorded WITH its green count and still returns ok. Assert the two
    // facts, not the whitespace between them.
    expect(download).toMatch(/markDownloaded\(\{[\s\S]{0,160}greens \}\);/);
    expect(download).toMatch(/markDownloaded\(\{[\s\S]{0,400}return \{ ok: true, courseId, fresh: true \}/);
  });
});
