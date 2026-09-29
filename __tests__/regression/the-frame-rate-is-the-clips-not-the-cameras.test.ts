/**
 * 2026-09-29 — FRAME-RATE TRUTH: every reader asks about the CLIP it is looking at, not the camera.
 *
 * `captureEngineStore.capturedFps` is the rate the camera resolved RIGHT NOW. It is null once the
 * camera unmounts and it describes the next recording, not the one on screen — yet the ball-trace gate
 * and the caddie's capture-quality line both read it while a clip was being reviewed, and the club-path
 * schedule assumed 30fps because its only caller never passed a rate. So:
 *   - a recorded swing stores the rate it was captured at (upload.captured_fps; null for uploads);
 *   - SmartMotion publishes the reviewed clip's rate, and the caddie reads THAT while a clip is up;
 *   - detectClubPath takes the clip's rate and the schedule uses it.
 * Older sessions carry no rate → null → unknown, exactly as an upload is treated today.
 */
import fs from 'fs';
import path from 'path';

const decodedAt: number[] = [];
jest.mock('../../utils/videoThumbnail', () => ({
  getThumbnailAsync: jest.fn(async (_uri: string, opts: { time: number }) => {
    decodedAt.push(opts.time);
    throw new Error('stop here — the schedule is what is under test');
  }),
  serializeMediaRead: (fn: () => unknown) => fn(),
}));
jest.mock('../../services/swing/sharedClipCopy', () => ({
  acquireClipCopy: jest.fn(async () => ({ uri: 'file:///private-copy.mp4', release: () => {} })),
  acquireExistingClipCopy: jest.fn(async () => null),
  isPooledCopy: () => false,
}));

import { capturedFpsForClip, fpsInScope, sessionCapturedFps } from '../../services/capture/clipFps';
import { useCaptureEngineStore } from '../../store/captureEngineStore';
import { buildCaddieRequestBody } from '../../services/caddieRequestBody';
import { detectClubPath } from '../../services/swing/clubPath';

describe('a recorded swing keeps the rate it was captured at', () => {
  it('reads it back from the session, and an old session / upload is unknown', () => {
    expect(sessionCapturedFps({ upload: { captured_fps: 60 } } as never)).toBe(60);
    expect(sessionCapturedFps({ upload: { uploaded_at: 1 } } as never)).toBeNull();
    expect(sessionCapturedFps({} as never)).toBeNull();
    expect(sessionCapturedFps(null)).toBeNull();
    for (const bad of [0, -30, NaN, '60']) expect(sessionCapturedFps({ upload: { captured_fps: bad } } as never)).toBeNull();
  });

  it('finds the rate for the clip on screen by its uri', () => {
    const history = [
      { id: 'a', shots: [{ clipUri: 'file:///a.mp4' }], upload: { captured_fps: 120 } },
      { id: 'b', shots: [{ clipUri: 'file:///b.mp4' }], upload: {} },
    ];
    expect(capturedFpsForClip(history as never, 'file:///a.mp4')).toBe(120);
    expect(capturedFpsForClip(history as never, 'file:///b.mp4')).toBeNull();
    expect(capturedFpsForClip(history as never, 'file:///nope.mp4')).toBeNull();
  });
});

describe('the caddie is told about the clip being reviewed, not the camera', () => {
  const quality = () => buildCaddieRequestBody({ message: '', language: 'en' }).capture_quality;
  afterEach(() => useCaptureEngineStore.setState({ capturedFps: null, reviewingClip: null } as never));

  it('reviewing a 30fps recording with the camera unmounted still names the shortfall', () => {
    useCaptureEngineStore.setState({ capturedFps: null, reviewingClip: { fps: 30 } } as never);
    expect(quality()).toMatch(/30 frames a second/);
  });

  it('reviewing an UPLOAD (unknown rate) says nothing, even if the camera is live at 30', () => {
    useCaptureEngineStore.setState({ capturedFps: 30, reviewingClip: { fps: null } } as never);
    expect(quality()).toBeNull();
  });

  it('with no clip under review the live camera still speaks for the next recording', () => {
    useCaptureEngineStore.setState({ capturedFps: 30, reviewingClip: null } as never);
    expect(quality()).toMatch(/30 frames a second/);
    expect(fpsInScope(null, 30)).toBe(30);
    expect(fpsInScope({ fps: 60 }, 30)).toBe(60);
  });
});

describe('the club-path schedule uses the clip rate', () => {
  const minGap = (ts: number[]) => {
    const s = [...ts].sort((a, b) => a - b);
    return Math.min(...s.slice(1).map((t, i) => t - s[i]));
  };
  const run = async (sourceFps: number | null) => {
    decodedAt.length = 0;
    // A SHORT window, where the frame ceiling binds — the case the 09-19 schedule note measured.
    await detectClubPath({ videoUri: 'file:///clip.mp4', startMs: 1000, endMs: 1400, impactMs: 1200, shouldAbort: () => false, sourceFps });
    return decodedAt.slice();
  };

  it('a 120fps clip gets more distinct frames, closer than a 30fps frame apart; an unknown rate keeps the 30fps floor', async () => {
    const at120 = await run(120);
    const unknown = await run(null);
    expect(unknown.length).toBeGreaterThan(0);
    expect(at120.length).toBeGreaterThan(unknown.length);
    expect(minGap(at120)).toBeLessThan(1000 / 30);
    expect(minGap(unknown)).toBeGreaterThanOrEqual(Math.floor(1000 / 30));
  });
});

describe('SmartMotion reads the reviewed clip, and records the rate with the swing', () => {
  const raw = fs.readFileSync(path.join(__dirname, '../../app/swinglab/smartmotion.tsx'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(?<![:\w])\/\/[^\n]*/g, ' ');

  it('the ball-trace gate reads the reviewed clip rate, not the camera store', () => {
    expect(src).toMatch(/const capturedFps = clipFps;\s*\n\s*if \(capturedFps != null && capturedFps < MIN_TRACE_FPS\) return null;/);
    expect(src).not.toMatch(/const capturedFps = useCaptureEngineStore\.getState\(\)\.capturedFps;/);
  });

  it('the rate is snapshotted when recording starts and saved on the swing', () => {
    expect(src).toMatch(/recordedClipFpsRef\.current = useCaptureEngineStore\.getState\(\)\.capturedFps;/);
    expect(src).toMatch(/captured_fps: clipFpsRef\.current,/);
  });

  it('both SmartMotion club-path reads pass the clip rate', () => {
    expect((src.match(/detectClubPath\(\{[^}]*sourceFps: clipFpsRef\.current/g) ?? []).length).toBe(2);
  });
});
