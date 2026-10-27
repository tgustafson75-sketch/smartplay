/**
 * 2026-10-26 — Tim: "Tracing is still on by default, and off doesn't work" and "the blue club line stays
 * with the arc, not the golfer's hands".
 *
 *  - services/swing/overlayVisibility: the ONE rule both review screens draw by (library swing and SmartMotion).
 *    Trace / arc / blue club are opt-in, off is off, and an arc an older build stored is not drawn.
 *  - services/swing/clubShaft: the blue club at one instant — the head only inside the measured arc and never
 *    across a gap; the shaft only from a MEASURED grip.
 *  - the tracker (the shipped WebView string) now measures that grip: the inner end of the moving shaft. And
 *    every owner between it and the screen carries it (detectClubPath, the shot run's store write).
 * Behaviour only; nothing here reads source text.
 */
import vm from 'vm';
import { overlayLayers, drawableClubArc } from '../../services/swing/overlayVisibility';
import { clubShaftAt, MAX_ARC_GAP_MS } from '../../services/swing/clubShaft';
import { CLUB_ARC_VERSION } from '../../services/swing/analysisVersion';
import { CLUB_TRACK_JS } from '../../services/swing/clubTrackSource';

const ARC10 = Array.from({ length: 10 }, (_, k) => ({ x: 0.2 + k * 0.05, y: 0.3, tMs: 1000 + k * 33 }));

describe('what the overlay draws is the player\'s choice (overlayLayers)', () => {
  const base = { userSkeleton: false, userTrace: false, hasPose: true, arc: ARC10 };
  it('a stored 10-point arc and no action from the player: no trace, no club, nothing mounted', () => {
    const l = overlayLayers(base);
    expect(l).toEqual({ mount: false, skeleton: false, trace: false, clubArc: null });
  });
  it('a confirmed strike does not turn the trace on by itself (SmartMotion\'s old rule)', () => {
    const l = overlayLayers({ ...base, shotConfirmed: true });
    expect(l.trace).toBe(false);
    expect(l.clubArc).toBeNull();
  });
  it('on → drawn; off again → gone, arc and club together', () => {
    expect(overlayLayers({ ...base, userTrace: true }).clubArc).toBe(ARC10);
    const off = overlayLayers({ ...base, userTrace: false });
    expect(off.trace).toBe(false);
    expect(off.clubArc).toBeNull();
  });
  it('Motion is the skeleton only — it never brings the club with it', () => {
    const l = overlayLayers({ ...base, userSkeleton: true });
    expect(l).toEqual({ mount: true, skeleton: true, trace: false, clubArc: null });
  });
  it('a practice swing (not confirmed) draws no trace even when asked', () => {
    expect(overlayLayers({ ...base, userTrace: true, shotConfirmed: false }).trace).toBe(false);
  });
  it('the fault spotlight mounts the overlay on its own, without skeleton or trace', () => {
    expect(overlayLayers({ ...base, spotlight: true })).toEqual({ mount: true, skeleton: false, trace: false, clubArc: null });
  });
});

describe('only an arc today\'s tracker stored is drawn (drawableClubArc)', () => {
  const pts = [{ x: 0.1, y: 0.2, tMs: 0, gx: 0.3, gy: 0.4 }, { x: 0.2, y: 0.3, tMs: 33 }, { x: 0.3, y: 0.4, tMs: 66, gx: 0.31, gy: 0.41 }];
  it('an older build\'s arc (no or old version) is not drawn', () => {
    const shot = { id: 'a', clipUri: 'f', club_arc: pts, club_arc_source: 'tracker' };
    expect(drawableClubArc({ shots: [shot] }, shot)).toBeNull();
    const v1 = { ...shot, club_arc_version: 1 };
    expect(drawableClubArc({ shots: [v1] }, v1)).toBeNull();
  });
  it('a current arc keeps its measured grips (they used to be stripped to x/y/tMs)', () => {
    const shot = { id: 'a', clipUri: 'f', club_arc: pts, club_arc_source: 'tracker', club_arc_version: CLUB_ARC_VERSION };
    expect(drawableClubArc({ shots: [shot] }, shot)).toEqual(pts);
  });
  it('the first swing falls back to the session\'s arc; a later swing never borrows it', () => {
    const s0 = { id: 'a', clipUri: 'f' }, s1 = { id: 'b', clipUri: 'f' };
    const session = { shots: [s0, s1], club_arc: pts, club_arc_version: CLUB_ARC_VERSION };
    expect(drawableClubArc(session, s0)).toHaveLength(3);
    expect(drawableClubArc(session, s1)).toBeNull();
  });
});

describe('the blue club at one instant (clubShaftAt)', () => {
  const head = Array.from({ length: 5 }, (_, k) => ({ x: 100 + k * 10, y: 200, t: 1000 + k * 33 }));
  const grips = head.map((p) => ({ t: p.t, x: 50, y: 150 + (p.t - 1000) / 10 }));
  it('nothing before the first detection or after the last — no clamp to the arc\'s ends', () => {
    expect(clubShaftAt(head, grips, 900)).toBeNull();
    expect(clubShaftAt(head, grips, 1200)).toBeNull();
  });
  it('inside the arc: the head on the arc, the grip interpolated between measured grips', () => {
    const s = clubShaftAt(head, grips, 1016.5)!;
    expect(s.head.x).toBeGreaterThan(100);
    expect(s.head.x).toBeLessThan(110);
    expect(s.grip).toEqual({ x: 50, y: 151.65 });
  });
  it('a stretch the tracker did not see is not bridged', () => {
    const gapped = [head[0], head[1], { x: 140, y: 200, t: head[1].t + MAX_ARC_GAP_MS + 40 }, { x: 150, y: 200, t: head[1].t + MAX_ARC_GAP_MS + 73 }];
    expect(clubShaftAt(gapped, [], head[1].t + 40)).toBeNull();
  });
  it('no measured grip → the head alone, never a shaft to a guessed hand', () => {
    const s = clubShaftAt(head, [], 1050)!;
    expect(s.head).toBeDefined();
    expect(s.grip).toBeNull();
  });
});

/** The synthetic swing the tracker suite uses: still body, hands fixed at (160,250), a club rotating round them. */
function syntheticSwing() {
  const W = 320, H = 427, N = 48;
  const hands = { x: 160, y: 250 }, L = 78;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bg = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bg[y * W + x] = y < 200 ? 170 : 110 + ((x * 7 + y * 3) % 9);
  const angAt = (i: number) => {
    if (i < 6) return 0.35;
    if (i < 26) return 0.35 + (i - 6) * 0.13;
    if (i < 32) return 2.95 - (i - 26) * 0.42;
    return Math.max(-2.6, 0.43 - (i - 32) * 0.2);
  };
  const frames: { t: number; w: number; h: number; luma: Uint8Array }[] = [];
  for (let i = 0; i < N; i++) {
    const L8 = new Uint8Array(bg);
    for (let p = 0; p < L8.length; p += 3) L8[p] = Math.max(0, Math.min(255, L8[p] + Math.round((rnd() - 0.5) * 6)));
    for (let y = 205; y < 330; y++) for (let x = 140; x < 165; x++) L8[y * W + x] = 60;
    const a = angAt(i), hx = hands.x + Math.sin(a) * L, hy = hands.y + Math.cos(a) * L;
    for (let s = 0; s <= 60; s++) {
      const x = Math.round(hands.x + (hx - hands.x) * s / 60), y = Math.round(hands.y + (hy - hands.y) * s / 60);
      if (x >= 0 && x < W && y >= 0 && y < H) { L8[y * W + x] = 30; if (x + 1 < W) L8[y * W + x + 1] = 30; }
    }
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const x = Math.round(hx) + dx, y = Math.round(hy) + dy;
      if (x >= 0 && x < W && y >= 0 && y < H) L8[y * W + x] = 15;
    }
    frames.push({ t: 5000 + Math.round(i * 33.33), w: W, h: H, luma: L8 });
  }
  const anchor = { hand: hands, shoulder: { x: 152, y: 215 }, hip: { x: 150, y: 262 }, knee: { x: 150, y: 296 }, head: { x: 160, y: 196 }, ankleY: 330, bodyH: 134 };
  return { frames, hands, at: () => ({ ...anchor, hand: { ...hands } }) };
}

describe('the shipped tracker MEASURES the grip (the inner end of the moving shaft)', () => {
  const ctx: Record<string, unknown> = { Math, Uint8Array, Uint32Array, Array, Object };
  ctx.globalThis = ctx;
  vm.runInNewContext(CLUB_TRACK_JS, ctx);
  const CT = ctx.ClubTrack as { track: (f: unknown, at: unknown) => { points: ({ x: number; y: number; gx?: number; gy?: number } | null)[] } };
  const { frames, hands, at } = syntheticSwing();
  const r = CT.track(frames, at);
  const heads = r.points.filter(Boolean) as { x: number; y: number; gx?: number; gy?: number }[];
  it('most tracked heads carry a grip, it is at the hands, and it never runs past them up the arm', () => {
    const withGrip = heads.filter((p) => typeof p.gx === 'number');
    expect(withGrip.length).toBeGreaterThanOrEqual(heads.length * 0.7);
    const off = withGrip.map((p) => Math.hypot((p.gx as number) - hands.x, (p.gy as number) - hands.y));
    // a slow takeaway can leave the shaft's inner end too still to see: that grip is SHORT (on the shaft), never wrong
    expect(off.filter((d) => d < 8).length).toBeGreaterThanOrEqual(withGrip.length * 0.9);
    for (const p of withGrip) {
      const shaft = Math.hypot((p.gx as number) - p.x, (p.gy as number) - p.y);
      expect(shaft).toBeLessThanOrEqual(Math.hypot(hands.x - p.x, hands.y - p.y) + 1);
    }
  });
});

describe('detectClubPath hands the measured grip on (it used to keep x/y/tMs only)', () => {
  const mockTrack = jest.fn();
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    jest.doMock('../../services/frameEngine', () => ({ ensureFrameEngine: async () => true, trackClubInBrowser: (...a: unknown[]) => mockTrack(...a) }));
    jest.doMock('../../services/swing/sharedClipCopy', () => ({ acquireClipCopy: async () => ({ uri: 'file:///copy.mp4', release: () => undefined }) }));
    jest.doMock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'https://api.test' }));
  });
  afterAll(() => { jest.dontMock('react-native'); jest.resetModules(); });
  const pose = (t: number) => ({ timestampMs: t, keypoints: [
    { name: 'left_wrist', x: 0.5, y: 0.6, score: 0.9 }, { name: 'left_shoulder', x: 0.47, y: 0.5, score: 0.9 },
    { name: 'left_hip', x: 0.46, y: 0.62, score: 0.9 }, { name: 'left_ankle', x: 0.46, y: 0.78, score: 0.9 }, { name: 'nose', x: 0.5, y: 0.45, score: 0.9 },
  ] });
  it('a grip on a tracked point reaches the arc; a point without one stays without', async () => {
    const pts = Array.from({ length: 8 }, (_, k) => ({ t: 6000 + k * 33, x: 0.2 + k * 0.06, y: 0.3 + k * 0.04, score: 0.6, ...(k % 2 ? {} : { gx: 0.5, gy: 0.55 }) }));
    mockTrack.mockResolvedValue({ frames: 30, vw: 1080, vh: 1920, clubLen: 0.2, points: pts });
    const { detectClubPath } = await import('../../services/swing/clubPath');
    const r = await detectClubPath({ videoUri: 'file:///c.mp4', startMs: 5900, endMs: 6500, poseFrames: [0, 1, 2, 3, 4].map((k) => pose(5900 + k * 150)) as never });
    expect(r?.points.length).toBe(8);
    expect(r?.points[0]).toEqual({ x: 0.2, y: 0.3, tMs: 100, gx: 0.5, gy: 0.55 });
    expect((r?.points[1] as unknown as Record<string, unknown>).gx).toBeUndefined();
  });
});
