/**
 * 2026-09-01 (Tim's log, 16:17 and 17:29 — swing_locate_fallback, cause dead_host,
 * probe1Ok:false probe2Ok:false, fired at ~9s, TWICE in one afternoon).
 *
 * THE HOST WAS NOT DEAD. /api/health?lite=1 answers in ~230ms and the analysis endpoint was up both
 * times. What the guard cannot see is that it competes with the very request it guards: eight coarse
 * frames POST to the SAME ORIGIN while the probes try to GET it, so on a phone uplink the small
 * request queues behind the large body and times out. The guard then read its own starvation as a
 * dead host and killed a request the 35s ceiling would have let finish — 26 seconds of headroom
 * thrown away, each time.
 *
 * A dead host stays silent however long you wait. A starved probe eventually gets through. So the
 * verdict now needs a third, patient probe before it may abort.
 */
import fs from 'fs';
import path from 'path';

const src = fs.readFileSync(
  path.join(__dirname, '..', '..', 'services/poseDetection.ts'),
  'utf8',
);

describe('the dead-host guard must be sure before it kills a request', () => {
  it('takes a THIRD, generous probe before aborting', () => {
    expect(src).toMatch(/const probe3Ok = await probe\(12_000\);/);
    expect(src).toMatch(/if \(probe3Ok\) return;/);
  });

  it('each probe is more patient than the last', () => {
    const budgets = [...src.matchAll(/await probe\((\d[\d_]*)\)/g)].map((m) =>
      Number(m[1].replace(/_/g, '')),
    );
    expect(budgets.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < budgets.length; i++) expect(budgets[i]).toBeGreaterThan(budgets[i - 1]);
  });

  it('the whole guard still finishes well inside the ceiling it exists to beat', () => {
    const ceiling = Number(/LOCATE_TIMEOUT_MS = (\d[\d_]*)/.exec(src)?.[1].replace(/_/g, ''));
    const budgets = [...src.matchAll(/await probe\((\d[\d_]*)\)/g)].map((m) =>
      Number(m[1].replace(/_/g, '')),
    );
    const total = budgets.reduce((a, b) => a + b, 0);
    expect(ceiling).toBe(35_000);
    expect(total).toBeLessThan(ceiling);
    // and it must still save real time, or it has no reason to exist
    expect(total).toBeLessThan(ceiling - 10_000);
  });

  it('every probe it took is reported, so a false abort stays diagnosable', () => {
    expect(src).toMatch(/probe1Ok: boolean; probe2Ok: boolean; probe3Ok: boolean; firedAfterMs: number/);
    expect(src).toMatch(/onFired\(\{ probe1Ok, probe2Ok, probe3Ok, firedAfterMs/);
  });

  it('a probe that succeeds at ANY stage cancels the abort', () => {
    expect(src).toMatch(/if \(probe1Ok\) return;/);
    expect(src).toMatch(/if \(probe2Ok\) return;/);
    expect(src).toMatch(/if \(probe3Ok\) return;/);
  });

  it('it probes the cheap reachability endpoint, not the billable one', () => {
    expect(src).toMatch(/\/api\/health\?lite=1/);
  });
});
