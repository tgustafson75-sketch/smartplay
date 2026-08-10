/**
 * 2026-08-10 — the club-PATH plane read (over-the-top / shallow) from the real clubhead arc.
 * These lock the GEOMETRY (directionally sound: steeper-down = over-the-top, shallower-down = shallow,
 * retrace = on-plane) and the honesty gates (face-on refused, sparse/ambiguous → null). The ANGLE
 * THRESHOLD + sign are still PROVISIONAL pending a real down-the-line clip — that calibration will only
 * tune constants, not the geometry these tests pin.
 */
import { readClubPath, type ClubArcPoint } from '../../services/swing/clubPathRead';

// Build a clubhead arc: address(low) → up-and-back to a top → down to impact(low) → follow(up).
// x,y normalized 0..1, y grows DOWN. backSteep / downSteep control each limb's verticality.
function arc(backDx: number, downDx: number): ClubArcPoint[] {
  // top at (0.5, 0.15) (high). address at (0.75, 0.75). impact at (0.5, 0.78).
  const top = { x: 0.5, y: 0.15 };
  const addr = { x: 0.5 + backDx, y: 0.75 };
  const impact = { x: 0.5 + downDx, y: 0.78 };
  const follow = { x: 0.5 - 0.15, y: 0.45 };
  // interpolate a couple of points along each limb so topIdx is interior + limbs have ≥2 pts each side
  const lerp = (a: { x: number; y: number }, b: { x: number; y: number }, s: number) => ({ x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s });
  const pts: { x: number; y: number }[] = [
    addr,
    lerp(addr, top, 0.5),
    top,
    lerp(top, impact, 0.5),
    impact,
    follow,
  ];
  return pts.map((p, i) => ({ x: p.x, y: p.y, tMs: i * 100 }));
}

describe('club-path plane geometry (directionally sound)', () => {
  it('a steeper DOWN limb than the UP limb reads over_the_top', () => {
    // backswing shallow (big dx = flatter), downswing steep (small dx = more vertical)
    const r = readClubPath(arc(0.30, 0.02), 'down_the_line');
    expect(r.classification).toBe('over_the_top');
    expect((r.planeDeltaDeg ?? 0) > 0).toBe(true);
  });

  it('a shallower DOWN limb than the UP limb reads shallow', () => {
    const r = readClubPath(arc(0.02, 0.30), 'down_the_line');
    expect(r.classification).toBe('shallow');
    expect((r.planeDeltaDeg ?? 0) < 0).toBe(true);
  });

  it('the downswing retracing the backswing reads on_plane', () => {
    const r = readClubPath(arc(0.16, 0.16), 'down_the_line');
    expect(r.classification).toBe('on_plane');
  });
});

describe('honesty gates', () => {
  it('face-on is refused (plane invisible edge-on) → null classification', () => {
    expect(readClubPath(arc(0.30, 0.02), 'face_on').classification).toBeNull();
  });
  it('glasses / unknown angle refused', () => {
    expect(readClubPath(arc(0.30, 0.02), 'glasses_pov').classification).toBeNull();
    expect(readClubPath(arc(0.30, 0.02), null).classification).toBeNull();
  });
  it('too few points → null', () => {
    expect(readClubPath([{ x: 0.5, y: 0.5, tMs: 0 }, { x: 0.6, y: 0.4, tMs: 100 }], 'down_the_line').classification).toBeNull();
  });
  it('no interior top (monotonic) → null', () => {
    const monotonic: ClubArcPoint[] = [0, 1, 2, 3, 4].map((i) => ({ x: 0.4 + i * 0.05, y: 0.2 + i * 0.1, tMs: i * 100 }));
    expect(readClubPath(monotonic, 'down_the_line').classification).toBeNull();
  });
  it('always flags provisional until real-clip calibration', () => {
    expect(readClubPath(arc(0.30, 0.02), 'down_the_line').provisional).toBe(true);
  });
});
