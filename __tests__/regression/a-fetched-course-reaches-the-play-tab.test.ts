import * as fs from 'fs';
import * as path from 'path';
import { downloadedCourseSummaries } from '../../services/courseDownloadEngine';

const read = (r: string) => fs.readFileSync(path.resolve(__dirname, '../../', r), 'utf-8');

/**
 * 2026-09-12 (Tim — the day-one concept) — "being able to ask the caddie to fetch that course for
 * the play tab to play on a future date."
 *
 * `download_course` shipped the same day and the FETCH worked. Reaching the result did not:
 * `downloaded` was rendered nowhere, `recentCourseIds` only fills at round START, and the one route
 * left was typing the name into golfCourseApi.searchCourses, which is network-only. So a course
 * pulled in for an upcoming trip was cached, ready, and unreachable on the morning it was fetched
 * for — while the caddie promised it would be "ready and offline when you go".
 *
 * These are BEHAVIOURAL on the assembly, not greps: the download_course gate next door asserts
 * source text only, which is the same shape as the 09-11 "the 60 is a club" gate that certified a
 * fix that had never once fired. [[every-finding-needs-a-guard-before-you-call-it-fixed]]
 */
describe('a course the caddie fetched reaches the Play tab', () => {
  const rec = (courseId: string, name: string) => ({ courseId, name, holeCount: 18, at: 1 });

  it('a downloaded course becomes a listable row', () => {
    const rows = downloadedCourseSummaries({ 'gca-991': rec('gca-991', 'Shadow Creek') });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'gca-991', club_name: 'Shadow Creek' });
  });

  /**
   * THE ALIAS TRAP. rememberAlias writes a SECOND row under `place:<place_id>` for the same course so
   * the nearby prefetch can skip it without paying a search. That was safe only while nothing
   * rendered the map; an unfiltered list shows the course twice.
   */
  it('does not list the place: alias row as a second course', () => {
    const rows = downloadedCourseSummaries({
      'gca-991': rec('gca-991', 'Shadow Creek'),
      'place:ChIJabc123': rec('place:ChIJabc123', 'Shadow Creek'),
    });
    expect(rows.map(r => r.id)).toEqual(['gca-991']);
  });

  it('does not duplicate a bundled course', () => {
    const rows = downloadedCourseSummaries({ 'local:menifee-lakes': rec('local:menifee-lakes', 'Menifee Lakes') });
    expect(rows).toEqual([]);
  });

  it('prefers the remembered meta name and carries its location', () => {
    const rows = downloadedCourseSummaries(
      { 'gca-991': rec('gca-991', 'Shadow Creek') },
      { 'gca-991': { club_name: 'Shadow Creek Golf Club', location: 'Las Vegas, NV' } },
    );
    expect(rows[0].club_name).toBe('Shadow Creek Golf Club');
    expect(rows[0].location).toBe('Las Vegas, NV');
  });

  /** A row with no resolved detail is still honest: no invented rating or slope. */
  it('never invents a rating or slope it has not fetched', () => {
    const rows = downloadedCourseSummaries({ 'gca-991': rec('gca-991', 'Shadow Creek') });
    expect(rows[0].rating).toBeNull();
    expect(rows[0].slope).toBeNull();
  });

  it('survives a malformed record rather than dropping the whole list', () => {
    const rows = downloadedCourseSummaries({
      bad: undefined as unknown as { courseId: string; name: string },
      'gca-991': rec('gca-991', 'Shadow Creek'),
    });
    expect(rows.map(r => r.id)).toEqual(['gca-991']);
  });

  /**
   * NO FETCH AT MOUNT. The Play tab builds this list while the connection is at its worst, and a
   * dropped lookup here once erased a course Tim was about to play ("where the hell did Wachusett
   * go?"). The record carries the name, so no network is needed at all.
   */
  it('is assembled with no network call', () => {
    const src = read('services/courseDownloadEngine.ts');
    const fn = src.slice(src.indexOf('export function downloadedCourseSummaries'));
    const body = fn.slice(0, fn.indexOf('\n}'));
    expect(body).not.toMatch(/await|fetch\(|getCourse|searchCourses/);
  });

  /** The Play tab must actually consume it — an owner with no caller is the bug this repo keeps finding. */
  it('the Play tab lists them alongside bundled, custom and recent courses', () => {
    const play = read('app/(tabs)/play.tsx');
    expect(play).toMatch(/downloadedCourseSummaries\(downloadedCourses, recentCourseMeta\)/);
    const memo = play.slice(play.indexOf('const closestLocal'), play.indexOf('const distanceLabelById'));
    expect(memo).toMatch(/downloaded: downloadedCourseSummaries\(downloadedCourses, recentCourseMeta\)/);
  });

  /** And the caddie's promise has to match what the app does. */
  it('the caddie names the Play tab when he offers', () => {
    expect(read('api/kevin.ts')).toMatch(/it'll be in your Play tab, ready and offline when you go/i);
  });
});
