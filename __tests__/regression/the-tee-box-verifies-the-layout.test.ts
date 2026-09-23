/**
 * 2026-09-23 (Tim) — "on properties that have more than one course, the tee box … should be the
 * verifier, and it should do a check and reconcile." Every rule that can move a live round, pinned.
 *
 * Third pass: the rules are HOLE-AWARE. Only the tee of the player's current hole or the next one can
 * count — a ball or a parked cart beside another layout's tee elsewhere on the property is not a sign
 * of anything. The last block runs on the REAL bundled Menifee tees, not invented coordinates.
 */
import {
  observeTee, INITIAL_STATE, DWELL_MS, type LayoutTees, type VerifierState, type TeeObservation,
} from '../../services/layoutVerifier';
import { getBundledHoles } from '../../data/courses';

const at = (lat: number, lng: number) => ({ lat, lng });
// Active: 18 tees on a line. Sibling: the same routing ~85 yards east — a neighbouring layout.
const line = (id: string, lng: number): LayoutTees => ({
  courseId: id, holeCount: 18,
  tees: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, tee: at(30.19 + (i + 1) * 0.004, lng) })),
});
const ACTIVE = line('dyes-valley', -81.39);
const STADIUM = line('stadium', -81.3908);

function stand(state: VerifierState, where: { lat: number; lng: number }, t0: number, currentHole: number,
  opts: { siblings?: LayoutTees[]; active?: LayoutTees; ms?: number; extra?: Partial<TeeObservation> } = {}) {
  let s = state;
  let switchTo = null as null | { courseId: string; hole: number };
  const ms = opts.ms ?? DWELL_MS + 1000;
  for (let t = t0; t <= t0 + ms; t += 4000) {
    const r = observeTee(s, { at: where, accuracyM: 5, speedMs: 0, ts: t, ...opts.extra }, opts.active ?? ACTIVE, opts.siblings ?? [STADIUM], currentHole);
    s = r.state;
    if (r.switchTo) switchTo = r.switchTo;
  }
  return { s, switchTo };
}
const tee = (l: LayoutTees, h: number) => l.tees.find((t) => t.hole === h)!.tee;

describe('the tee box verifies which layout the round is on', () => {
  it('the sibling\'s tees on the current and next hole switch the round', () => {
    const r1 = stand(INITIAL_STATE, tee(STADIUM, 1), 0, 1);
    expect(r1.switchTo).toBeNull();
    const r2 = stand(r1.s, tee(STADIUM, 2), 100_000, 1);
    expect(r2.switchTo).toEqual({ courseId: 'stadium', hole: 2 });
  });

  it('standing on the active layout\'s expected tee wipes the doubt', () => {
    const r1 = stand(INITIAL_STATE, tee(STADIUM, 1), 0, 1);
    const r2 = stand(r1.s, tee(ACTIVE, 2), 100_000, 1);
    expect(r2.s.evidence).toBeNull();
  });

  it('a sibling tee on a hole the player is NOT on is nothing (the Lakes-6-while-on-Palms-3 case)', () => {
    const farSib: LayoutTees = { courseId: 'lakes', holeCount: 18, tees: [{ hole: 6, tee: at(30.30, -81.60) }] };
    const r = stand(INITIAL_STATE, at(30.30, -81.60), 0, 3, { siblings: [farSib], ms: 60_000 });
    expect(r.switchTo).toBeNull();
    expect(r.s.evidence).toBeNull();
  });

  it('a true mis-start switches on the first tee when the active layout\'s first tee is nowhere near', () => {
    const far: LayoutTees = { courseId: 'far-course', holeCount: 18, tees: [{ hole: 1, tee: at(30.30, -81.60) }] };
    const r = stand(INITIAL_STATE, at(30.30, -81.60), 0, 1, { siblings: [far] });
    expect(r.switchTo).toEqual({ courseId: 'far-course', hole: 1 });
  });

  it('a shared tee complex proves nothing, however long the player stands there', () => {
    const shared: LayoutTees = { courseId: 'shared', holeCount: 18, tees: [{ hole: 1, tee: at(30.194 + 0.0003, -81.39) }] };
    const r = stand(INITIAL_STATE, tee(shared, 1), 0, 1, { siblings: [shared], ms: 120_000 });
    expect(r.switchTo).toBeNull();
    expect(r.s.evidence).toBeNull();
  });

  it('27-hole combos: a tee that is the active layout\'s hole 10 but a sibling\'s hole 1 is evidence on hole 1', () => {
    const P = at(30.30, -81.60);
    const base = line('red-white', -81.39);
    const redWhite: LayoutTees = { ...base, tees: [...base.tees.filter((t) => t.hole !== 10), { hole: 10, tee: P }] };
    const whiteBlue: LayoutTees = { courseId: 'white-blue', holeCount: 18, tees: [{ hole: 1, tee: P }] };
    const r = stand(INITIAL_STATE, P, 0, 1, { active: redWhite, siblings: [whiteBlue] });
    expect(r.switchTo).toEqual({ courseId: 'white-blue', hole: 1 });
  });

  it('two siblings both expecting the player on the same tee are ambiguous, not evidence', () => {
    const P = at(30.30, -81.60);
    const a: LayoutTees = { courseId: 'a', holeCount: 18, tees: [{ hole: 1, tee: P }] };
    const b: LayoutTees = { courseId: 'b', holeCount: 18, tees: [{ hole: 1, tee: P }] };
    expect(stand(INITIAL_STATE, P, 0, 1, { siblings: [a, b] }).switchTo).toBeNull();
  });

  it('an active layout whose tees are NOT KNOWN yet is not evidence against it', () => {
    const unmapped: LayoutTees = { courseId: 'dyes-valley', tees: [], holeCount: 18 };
    const r = stand(INITIAL_STATE, tee(STADIUM, 1), 0, 1, { active: unmapped, ms: 60_000 });
    expect(r.switchTo).toBeNull();
    expect(r.s.evidence).toBeNull();
  });

  it('passing a tee, a cart driving past, and a weak fix do not count', () => {
    expect(stand(INITIAL_STATE, tee(STADIUM, 1), 0, 1, { ms: DWELL_MS - 5000 }).s.evidence).toBeNull();
    expect(stand(INITIAL_STATE, tee(STADIUM, 1), 0, 1, { ms: 60_000, extra: { speedMs: 5 } }).s.evidence).toBeNull();
    expect(stand(INITIAL_STATE, tee(STADIUM, 1), 0, 1, { ms: 60_000, extra: { accuracyM: 40 } }).s.evidence).toBeNull();
  });

  it('the same tee twice is still one tee', () => {
    const r1 = stand(INITIAL_STATE, tee(STADIUM, 1), 0, 1);
    expect(stand(r1.s, tee(STADIUM, 1), 100_000, 1).switchTo).toBeNull();
  });
});

describe('on the REAL bundled Menifee layouts', () => {
  const layout = (id: string): LayoutTees => {
    const holes = getBundledHoles(`local:${id}`);
    return {
      courseId: `local:${id}`, holeCount: holes.length,
      tees: holes.filter((h) => h.teeLat && h.teeLng).map((h) => ({ hole: h.hole, tee: at(h.teeLat as number, h.teeLng as number) })),
    };
  };
  const palms = layout('palms');
  const lakes = layout('lakes');

  it('has real tees to test against', () => {
    expect(palms.tees.length).toBe(18);
    expect(lakes.tees.length).toBe(18);
  });

  it('playing Palms correctly, stopping beside ANY Lakes tee off the current/next hole never switches', () => {
    for (let current = 1; current <= 17; current++) {
      for (const t of lakes.tees) {
        if (t.hole === current || t.hole === current + 1) continue;
        const r = stand(INITIAL_STATE, t.tee, 0, current, { active: palms, siblings: [lakes], ms: 60_000 });
        expect({ current, lakesHole: t.hole, switched: r.switchTo }).toEqual({ current, lakesHole: t.hole, switched: null });
      }
    }
  });

  it('a round started on Palms but played on Lakes switches by the second tee at the latest', () => {
    const r1 = stand(INITIAL_STATE, tee(lakes, 1), 0, 1, { active: palms, siblings: [lakes] });
    const r2 = r1.switchTo ? r1 : stand(r1.s, tee(lakes, 2), 100_000, 1, { active: palms, siblings: [lakes] });
    expect(r2.switchTo?.courseId).toBe('local:lakes');
  });
});
