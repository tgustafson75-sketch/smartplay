/**
 * 2026-08-13 (Tim's Wachusett round — "you shouldn't be able to be in a live round and have it show
 * static; that's a broken connection right there").
 *
 * He was describing the symptom exactly. The geometry engine worked; it just told nobody. `inflight`
 * was a module-level Map, `inflight.delete()` on completion notified no one, and the screen called
 * isGeometryBuilding() during render — a plain function against a Map, which cannot trigger React.
 * So a finished build never lifted the STATIC badge, and the yardage memo (whose deps didn't include
 * geometry) kept returning the static-card answer for the rest of the round.
 *
 * Third instance of one shape found the same day: a service holds state the UI depends on, with no
 * way to subscribe. This guards the wire, in both directions.
 */
import fs from 'fs';
import path from 'path';
const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');

describe('geometry status is observable, and yardage reacts to it', () => {
  it('the service PUBLISHES both transitions, not just tracks them', () => {
    const svc = read('services/courseGeometryService.ts');
    expect(svc).toContain('geometryStatus().markBuilding(courseId)');
    // Completion is the one that matters: it is what lifts yardage off the static tier.
    expect(svc).toContain('geometryStatus().markDone(courseId)');
  });

  it('every inflight.delete is paired with a markDone — a silent completion is the bug', () => {
    const svc = read('services/courseGeometryService.ts');
    const deletes = (svc.match(/inflight\.delete\(courseId\)/g) ?? []).length;
    const dones = (svc.match(/markDone\(courseId\)/g) ?? []).length;
    expect(dones).toBeGreaterThanOrEqual(deletes);
  });

  /**
   * 2026-08-13, second pass. The tests above guard the BUILD boundary, and the build boundary is not
   * where most geometry actually arrives.
   *
   * fetchCourseGeometry is stale-while-revalidate: an entry older than a week is returned immediately
   * and the real refresh runs DETACHED (`void refreshGeometryInBackground`). The outer promise settles
   * with the stale data, so markDone fired for the stale answer; the fresh greens landed in the cache
   * minutes later and published nothing. Every returning player — any course last seen 7+ days ago —
   * took that path. The original guard passed the entire time, because this path touches neither
   * `inflight` nor `markDone`.
   *
   * So guard the WRITE, not the build: geometry entering the cache is what readers care about.
   */
  it('commitGeometry — the single point new geometry enters the cache — publishes', () => {
    const svc = read('services/courseGeometryService.ts');
    const body = svc.slice(svc.indexOf('async function commitGeometry'));
    const fn = body.slice(0, body.indexOf('\n}\n'));
    expect(fn).toContain('markCommitted(courseId)');
  });

  it('the DETACHED refresh path never writes silently — no branch may skip the publish', () => {
    const svc = read('services/courseGeometryService.ts');
    const start = svc.indexOf('async function refreshGeometryInBackground');
    expect(start).toBeGreaterThan(-1);
    const body = svc.slice(start);
    const fn = body.slice(0, body.indexOf('\n}\n'));
    // Nothing awaits this function, so a write it doesn't announce reaches no one, ever. Every branch
    // that puts geometry in the cache must either route through commitGeometry (which publishes) or
    // publish itself.
    //
    // Checked PER WRITE, up to the return that ends its branch — not as a count over the function.
    // The counting version of this test passed while the bug was reintroduced: one silent branch was
    // covered by an unrelated commitGeometry call thirty lines below it. The invariant that actually
    // matters is positional — this path must never write geometry and then leave without saying so.
    const sites = [...fn.matchAll(/memCache\.set\(/g)].map((m) => m.index ?? 0);
    expect(sites.length).toBeGreaterThan(0); // the path still writes; if it stops, revisit this guard
    for (const at of sites) {
      const after = fn.slice(at);
      const end = after.search(/\breturn\b/);
      const branch = end === -1 ? after : after.slice(0, end);
      expect(branch).toMatch(/markCommitted\(|commitGeometry\(/);
    }
  });

  it('the screen SUBSCRIBES rather than calling into the module during render', () => {
    const tab = read('app/(tabs)/caddie.tsx');
    expect(tab).toContain('useGeometryStatusStore((st) => st.completions)');
    expect(tab).toContain('useGeometryStatusStore((st) => st.building)');
    // The non-reactive read must not be what drives the badge any more.
    expect(tab).not.toContain("isGeometryBuilding(useRoundStore.getState().activeCourseId) ? 'building'");
  });

  it('BOTH yardage memos re-resolve when a build completes', () => {
    const tab = read('app/(tabs)/caddie.tsx');
    const deps = tab.match(/\}, \[[^\]]*markTick[^\]]*\]\);/g) ?? [];
    expect(deps.length).toBeGreaterThanOrEqual(2);
    // A yardage memo keyed on markTick but NOT on geometryCompletions holds the static answer
    // for the rest of the round. That is the defect, not a style point.
    for (const d of deps) expect(d).toContain('geometryCompletions');
  });
});
