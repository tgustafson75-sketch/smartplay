/**
 * 2026-09-23 (Tim) — "on properties that have more than one course, the tee box … should be the
 * verifier, and it should do a check and reconcile." Every rule that can move a live round, pinned.
 */
import {
  observeTee, INITIAL_STATE, DWELL_MS, type LayoutTees, type VerifierState, type TeeObservation,
} from '../../services/layoutVerifier';

// ~0.0001 deg lat ≈ 12 yards. Two layouts laid out on a grid far enough apart to be distinct.
const at = (lat: number, lng: number) => ({ lat, lng });
const ACTIVE: LayoutTees = { courseId: 'dyes-valley', tees: [1, 2, 3].map((h) => ({ hole: h, tee: at(30.19 + h * 0.004, -81.39) })) };
const STADIUM: LayoutTees = { courseId: 'stadium', tees: [1, 2, 3].map((h) => ({ hole: h, tee: at(30.19 + h * 0.004, -81.3908) })) };
// A third layout whose hole-1 tee shares the active layout's tee complex (15 yards away).
const SHARED: LayoutTees = { courseId: 'shared', tees: [{ hole: 1, tee: at(30.194 + 0.000125, -81.39) }] };

function stand(state: VerifierState, where: { lat: number; lng: number }, t0: number, siblings = [STADIUM], ms = DWELL_MS + 1000, extra: Partial<TeeObservation> = {}) {
  let s = state;
  let switchTo = null as null | { courseId: string; hole: number };
  for (let t = t0; t <= t0 + ms; t += 4000) {
    const r = observeTee(s, { at: where, accuracyM: 5, speedMs: 0, ts: t, ...extra }, ACTIVE, siblings);
    s = r.state;
    if (r.switchTo) switchTo = r.switchTo;
  }
  return { s, switchTo };
}

describe('the tee box verifies which layout the round is on', () => {
  it('two sibling tees on different holes switch the round, to the hole the player is on', () => {
    const r1 = stand(INITIAL_STATE, STADIUM.tees[0].tee, 0);
    expect(r1.switchTo).toBeNull();
    const r2 = stand(r1.s, STADIUM.tees[1].tee, 100_000);
    expect(r2.switchTo).toEqual({ courseId: 'stadium', hole: 2 });
  });

  it('standing on the active layout\'s tee wipes the doubt', () => {
    const r1 = stand(INITIAL_STATE, STADIUM.tees[0].tee, 0);
    const r2 = stand(r1.s, ACTIVE.tees[1].tee, 100_000);
    const r3 = stand(r2.s, STADIUM.tees[2].tee, 200_000);
    expect(r3.switchTo).toBeNull();
  });

  it('a shared tee complex proves nothing, however long the player stands there', () => {
    const r = stand(INITIAL_STATE, SHARED.tees[0].tee, 0, [SHARED], 120_000);
    expect(r.switchTo).toBeNull();
    expect(r.s.evidence).toBeNull();
  });

  it('passing a tee is not standing on it: the dwell must be held', () => {
    const r = stand(INITIAL_STATE, STADIUM.tees[0].tee, 0, [STADIUM], DWELL_MS - 5000);
    expect(r.s.evidence).toBeNull();
  });

  it('a cart driving past does not count', () => {
    const r = stand(INITIAL_STATE, STADIUM.tees[0].tee, 0, [STADIUM], 60_000, { speedMs: 5 });
    expect(r.s.evidence).toBeNull();
  });

  it('a weak fix does not count', () => {
    const r = stand(INITIAL_STATE, STADIUM.tees[0].tee, 0, [STADIUM], 60_000, { accuracyM: 40 });
    expect(r.s.evidence).toBeNull();
  });

  it('ONE tee is enough when the active layout has no tee anywhere near', () => {
    const far: LayoutTees = { courseId: 'far-course', tees: [{ hole: 7, tee: at(30.30, -81.60) }] };
    const r = stand(INITIAL_STATE, far.tees[0].tee, 0, [far]);
    expect(r.switchTo).toEqual({ courseId: 'far-course', hole: 7 });
  });

  it('the same tee twice is still one tee', () => {
    const r1 = stand(INITIAL_STATE, STADIUM.tees[0].tee, 0);
    const r2 = stand(r1.s, STADIUM.tees[0].tee, 100_000);
    expect(r2.switchTo).toBeNull();
  });

  it('an active layout whose tees are NOT KNOWN yet is not evidence against it', () => {
    const unmapped: LayoutTees = { courseId: 'dyes-valley', tees: [], holeCount: 18 };
    let st = INITIAL_STATE;
    let sw = null as null | { courseId: string; hole: number };
    for (let t = 0; t <= DWELL_MS + 8000; t += 4000) {
      const r = observeTee(st, { at: STADIUM.tees[0].tee, accuracyM: 5, speedMs: 0, ts: t }, unmapped, [STADIUM]);
      st = r.state; if (r.switchTo) sw = r.switchTo;
    }
    expect(sw).toBeNull();
    expect(st.evidence).toBeNull();
  });

  it('two sibling layouts sharing one tee (27-hole combos) are ambiguous, not evidence', () => {
    const far = (id: string, hole: number): LayoutTees => ({ courseId: id, tees: [{ hole, tee: at(30.30, -81.60) }] });
    const r = stand(INITIAL_STATE, at(30.30, -81.60), 0, [far('red-white', 1), far('blue-red', 10)]);
    expect(r.switchTo).toBeNull();
  });
});
