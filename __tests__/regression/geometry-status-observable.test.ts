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
