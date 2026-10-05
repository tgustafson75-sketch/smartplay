/**
 * 2026-10-04 (Tim: "Check if we can finally get the swing arc trace to finally work … we never have
 * tracked club head or shaft successfully" / "make sure we get this right. This is a primary function
 * of the app").
 *
 * The clubhead is now TRACKED on the device (services/swing/clubTrackSource, run in the hidden browser
 * engine) instead of asking a vision model for coordinates (Tim's report: "detected 2 of 14"). These
 * tests run the SHIPPED source string — not a copy — on a synthetic swing whose truth is known, check
 * that the real tracked arcs from Tim's clips pass the arc gate, and that detectClubPath uses the
 * tracker first and only falls back when it cannot run.
 */
import vm from 'vm';
import { CLUB_TRACK_JS } from '../../services/swing/clubTrackSource';
import { classifyArc, classifyTrackedArc } from '../../services/swing/clubArcGate';
import fx3870 from '../fixtures/clubtrack-3870.json';
import fx6b from '../fixtures/clubtrack-6b.json';

type Frame = { t: number; w: number; h: number; luma: Uint8Array };
type CT = {
  track: (frames: Frame[], at: (t: number) => unknown) => { clubLen: number; points: ({ t: number; x: number; y: number; score: number } | null)[] };
  anchorsFromPoses: (poses: unknown[], W: number, H: number) => (t: number) => unknown;
};

function loadTracker(): CT {
  const ctx: Record<string, unknown> = { Math, Uint8Array, Uint32Array, Array, Object };
  ctx.globalThis = ctx;
  vm.runInNewContext(CLUB_TRACK_JS, ctx);
  return ctx.ClubTrack as CT;
}

/**
 * A 30fps swing, 320x427: grass/sky background with a little sensor noise, a still body, and a club
 * that rotates around the hands — slow takeaway, fast downswing, follow-through — with a dark 5px head.
 */
function syntheticSwing() {
  const W = 320, H = 427, N = 48;
  const hands = { x: 160, y: 250 }, L = 78;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const bg = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bg[y * W + x] = y < 200 ? 170 : 110 + ((x * 7 + y * 3) % 9);
  // angle of the shaft from the hands (0 = straight down toward the ball side), over time
  const angAt = (i: number) => {
    if (i < 6) return 0.35;                              // address (still)
    if (i < 26) return 0.35 + (i - 6) * 0.13;            // takeaway → top (slow)
    if (i < 32) return 2.95 - (i - 26) * 0.42;           // downswing (fast)
    return Math.max(-2.6, 0.43 - (i - 32) * 0.2);       // follow-through
  };
  const frames: Frame[] = []; const truth: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    const L8 = new Uint8Array(bg);
    for (let p = 0; p < L8.length; p += 3) L8[p] = Math.max(0, Math.min(255, L8[p] + Math.round((rnd() - 0.5) * 6)));
    // body: torso + legs (still)
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
    truth.push({ x: hx, y: hy });
  }
  const anchor = { hand: hands, shoulder: { x: 152, y: 215 }, hip: { x: 150, y: 262 }, knee: { x: 150, y: 296 }, head: { x: 160, y: 196 }, ankleY: 330, bodyH: 134 };
  return { frames, truth, at: () => ({ ...anchor, hand: { ...hands } }) };
}

describe('the shipped tracker on a swing whose truth is known', () => {
  const ct = loadTracker();
  const { frames, truth, at } = syntheticSwing();
  const r = ct.track(frames, at);

  it('finds the head on most moving frames, within a few pixels', () => {
    const moving = truth.map((_, i) => i >= 8 && i <= 44);
    let seen = 0, near = 0;
    r.points.forEach((p, i) => {
      if (!p || !moving[i]) return;
      seen++;
      if (Math.hypot(p.x - truth[i].x, p.y - truth[i].y) <= 6) near++;
    });
    expect(seen).toBeGreaterThanOrEqual(20);
    expect(near / seen).toBeGreaterThanOrEqual(0.85);
  });

  it('reports NOTHING while the club is still (address) — no point invented', () => {
    for (let i = 0; i <= 4; i++) expect(r.points[i]).toBeNull();
  });

  it('builds its body anchors from the app\'s pose-frame shape (named, normalised keypoints)', () => {
    const at2 = ct.anchorsFromPoses([
      { t: 0, kp: { left_wrist: [0.5, 0.6, 0.9], right_wrist: [0.5, 0.6, 0.9], left_shoulder: [0.47, 0.5, 0.9], right_shoulder: [0.47, 0.5, 0.9], left_hip: [0.46, 0.62, 0.9], right_hip: [0.46, 0.62, 0.9], left_ankle: [0.46, 0.78, 0.9], right_ankle: [0.46, 0.78, 0.9], nose: [0.5, 0.45, 0.9] } },
      { t: 100, kp: { left_wrist: [0.6, 0.4, 0.9], right_wrist: [0.6, 0.4, 0.9], left_shoulder: [0.47, 0.5, 0.9], right_shoulder: [0.47, 0.5, 0.9], left_hip: [0.46, 0.62, 0.9], right_hip: [0.46, 0.62, 0.9], left_ankle: [0.46, 0.78, 0.9], right_ankle: [0.46, 0.78, 0.9], nose: [0.5, 0.45, 0.9] } },
    ], 320, 427) as (t: number) => { hand: { x: number; y: number }; bodyH: number };
    const mid = at2(50);
    expect(mid.hand.x).toBeCloseTo(0.55 * 320, 0);                 // interpolated between the two poses
    expect(mid.hand.y).toBeCloseTo(0.5 * 427, 0);
    expect(mid.bodyH).toBeCloseTo((0.78 - 0.45) * 427, 0);
  });
});

describe('the real tracked arcs from Tim\'s clips pass the TRACKED-arc gate', () => {
  it.each([['3870 (14.5s, 30fps)', fx3870], ['swing6b (6s, 30fps)', fx6b]])('%s', (_label, fx) => {
    const pts = (fx as { points: { t: number; x: number; y: number }[] }).points.map((p) => ({ x: p.x, y: p.y, tMs: p.t }));
    expect(pts.length).toBeGreaterThanOrEqual(30);
    expect(classifyTrackedArc(pts).rejection).toBeNull();
    // (the vision-model gate's zig-zag test is what threw these clean arcs away — kept for that path only)
    expect(classifyArc(pts).rejection).toBe('scatter');
  });
  it('the tracked gate still refuses a cluster and too few', () => {
    expect(classifyTrackedArc([{ x: 0.5, y: 0.5 }, { x: 0.51, y: 0.5 }, { x: 0.52, y: 0.51 }, { x: 0.5, y: 0.52 }]).rejection).toBe('cluster');
    expect(classifyTrackedArc([{ x: 0.1, y: 0.1 }]).rejection).toBe('too_few');
  });
});

describe('detectClubPath tracks first, and only falls back when it cannot', () => {
  const mockTrack = jest.fn();
  const mockFetch = jest.fn();
  beforeAll(() => {
    jest.resetModules();
    jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
    jest.doMock('../../services/frameEngine', () => ({ ensureFrameEngine: async () => true, trackClubInBrowser: (...a: unknown[]) => mockTrack(...a) }));
    jest.doMock('../../services/swing/sharedClipCopy', () => ({ acquireClipCopy: async () => ({ uri: 'file:///copy.mp4', release: () => undefined }) }));
    jest.doMock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'https://api.test' }));
    (global as unknown as { fetch: unknown }).fetch = mockFetch;
  });
  const pose = (t: number) => ({ timestampMs: t, keypoints: [
    { name: 'left_wrist', x: 0.5, y: 0.6, score: 0.9 }, { name: 'left_shoulder', x: 0.47, y: 0.5, score: 0.9 },
    { name: 'left_hip', x: 0.46, y: 0.62, score: 0.9 }, { name: 'left_ankle', x: 0.46, y: 0.78, score: 0.9 }, { name: 'nose', x: 0.5, y: 0.45, score: 0.9 },
  ] });

  it('with pose frames on Android: the on-device tracker answers, the vision model is never called', async () => {
    mockTrack.mockResolvedValue({ frames: 81, vw: 1440, vh: 1920, clubLen: 0.18, points: fx3870.points });
    const { detectClubPath } = await import('../../services/swing/clubPath');
    const r = await detectClubPath({ videoUri: 'file:///c.mp4', startMs: 5600, endMs: 8300, poseFrames: [0, 1, 2, 3, 4].map((k) => pose(5600 + k * 600)) as never });
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack.mock.calls[0][0]).toBe('file:///copy.mp4');        // the private copy, never the player's file
    expect(mockFetch).not.toHaveBeenCalled();
    // 34 tracked; frames where the club hangs at the top collapse to one point (dedupe) — 26 distinct
    expect(r?.points.length).toBeGreaterThanOrEqual(24);
    expect(r?.points[0].tMs).toBeGreaterThanOrEqual(0);                  // window-relative, as the renderer expects
    expect(r?.frameW).toBe(1440);
  });

  it('an honest "too few" from the tracker is the answer — not a second opinion from the model', async () => {
    mockTrack.mockResolvedValue({ frames: 81, vw: 1440, vh: 1920, clubLen: 0, points: fx3870.points.slice(0, 1) });
    mockFetch.mockClear();
    const { detectClubPath } = await import('../../services/swing/clubPath');
    const r = await detectClubPath({ videoUri: 'file:///c.mp4', startMs: 5600, endMs: 8300, poseFrames: [0, 1, 2, 3, 4].map((k) => pose(5600 + k * 600)) as never });
    expect(r?.points).toEqual([]);
    expect(r?.rejected?.reason).toBe('too_few');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

describe('a tracked arc replaces an old vision-model arc; a vision arc never replaces a tracked one', () => {
  it('store rules', async () => {
    jest.resetModules();
    jest.dontMock('react-native');
    const { useSwingSessionStore } = await import('../../store/swingSessionStore');
    const three = [{ x: 0.1, y: 0.1, tMs: 0 }, { x: 0.3, y: 0.2, tMs: 33 }, { x: 0.5, y: 0.4, tMs: 66 }];
    useSwingSessionStore.setState({ activeSession: null, sessionHistory: [{ id: 'a1', shots: [{ id: 'sh' }], club_arc: three, club_arc_source: 'vision' }] as never });
    const st = useSwingSessionStore.getState();
    st.setSessionClubArc('a1', [], null, 'tracker');                     // tracked "too few" beats an old vision arc
    expect(useSwingSessionStore.getState().sessionHistory[0].club_arc).toEqual([]);
    st.setSessionClubArc('a1', three, { w: 1, h: 1 }, 'tracker');
    st.setSessionClubArc('a1', [], null, 'vision');                      // a failed vision re-run never erases it
    expect(useSwingSessionStore.getState().sessionHistory[0].club_arc).toEqual(three);
    expect(useSwingSessionStore.getState().sessionHistory[0].club_arc_source).toBe('tracker');
  });

  // 2026-10-05 — the one runner (the orchestrator's shot run) decides what a stored arc is worth.
  it('a stored TRACKED arc is final; a vision arc is re-tracked where the tracker can run', () => {
    const d = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'services/swing/orchestrator/shotDetail.ts'), 'utf8') as string;
    expect(d).toMatch(/if \(src === 'tracker'\) return true;/);
    // a stored VISION answer (arc or honest "no arc") is final where the tracker can't run; where it can,
    // only the free tracker is tried again — never the paid model about the same frames
    expect(d).toMatch(/return src === 'vision' && trackerUnavailable\(\);/);
    expect(d).toMatch(/trackerOnly: !input\.force && \(shot\.club_arc_source \?\? \(first \? s\.club_arc_source : undefined\)\) === 'vision',/);
    const cp = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'services/swing/clubPath.ts'), 'utf8') as string;
    expect(cp).toMatch(/if \(args\.trackerOnly\) \{ sharedCopy\?\.release\(\); return null; \}/);
    // the one arc writer passes the result's source through
    expect(d).toMatch(/store\.setShotClubArc\(input\.sessionId, input\.shotId, pts, frame, arc\.source\);/);
  });
});
