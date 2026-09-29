/**
 * 2026-09-29 — THE SWING READ SEES THE SWING.
 *
 * Tim's reference clip: 30fps, 1080x1920 portrait, 5.5s, one full swing. Before this change the app
 * sent three frames at 10/55/85% of the window, 512px WIDE (a 512x910 portrait frame), and a clip of
 * 2.5-6s skipped locating entirely and fell to "the last five seconds" — for a 5.5s clip, the whole
 * recording, so address and the walk-off took most of the three frames.
 *
 * Driven through the real analyzeSwing with only the native edges stubbed (thumbnail decode, image
 * resize, the private clip copy, the duration probe's decoder, the on-device locate, fetch). The
 * assertions are on what actually leaves the phone.
 */
const decodedAt: number[] = [];
const resizes: unknown[] = [];

jest.mock('../../utils/videoThumbnail', () => ({
  getThumbnailAsync: jest.fn(async (_uri: string, opts: { time: number }) => {
    decodedAt.push(opts.time);
    return { uri: `file:///thumb_${opts.time}.jpg`, width: 1080, height: 1920 };
  }),
  serializeMediaRead: (fn: () => unknown) => fn(),
  thumbnailCacheStats: () => ({ hits: 0, misses: 0 }),
  wedgedDecodeCount: () => 0,
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  manipulateAsync: jest.fn(async (_uri: string, actions: unknown[]) => {
    resizes.push(actions);
    return { uri: 'file:///small.jpg', width: 432, height: 768, base64: 'QUJDRA==' };
  }),
}));
jest.mock('../../services/swing/sharedClipCopy', () => ({
  acquireClipCopy: jest.fn(async () => ({ uri: 'file:///private-copy.mp4', release: () => {} })),
  acquireExistingClipCopy: jest.fn(async () => null),
  isPooledCopy: () => false,
}));
jest.mock('expo-av', () => ({
  Audio: {
    Sound: {
      createAsync: jest.fn(async () => ({
        sound: { unloadAsync: async () => {} },
        status: { isLoaded: true, durationMillis: 5533 },
      })),
    },
  },
}));
const onDeviceWindow = jest.fn();
jest.mock('../../services/swing/onDeviceLocate', () => ({
  locateSwingWindowOnDevice: (...a: unknown[]) => onDeviceWindow(...a),
}));

import { analyzeSwing } from '../../services/poseDetection';

type Posted = { frames: { b64: string; media_type: string; t_ms?: number }[]; mode?: string };

function stubServer(): Posted[] {
  const posted: Posted[] = [];
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async (_url: string, init: { body: string }) => {
    posted.push(JSON.parse(init.body) as Posted);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        detected_issue: 'none', severity: 'none', confidence: 'high', observation: 'ok',
        fault_frame_index: -1, primary_fault: 'no_dominant_fault',
        phases_visible: { address: true, top: true, impact: true, finish: true },
      }),
      text: async () => '',
    };
  });
  return posted;
}

beforeEach(() => {
  decodedAt.length = 0;
  resizes.length = 0;
  onDeviceWindow.mockReset();
});

describe("Tim's 5.5s full-swing clip", () => {
  it('is located on the device, and nine frames are spread across the swing it found', async () => {
    onDeviceWindow.mockResolvedValue({ startSec: 1.2, endSec: 2.8, swingTimeSec: 2.3 });
    const posted = stubServer();
    const r = await analyzeSwing('file:///clip-5500.mp4', { club: '7i', swing_number: 1, tier: 'quick' });

    expect(onDeviceWindow).toHaveBeenCalledTimes(1);
    expect(r.kind).toBe('ok');
    // exactly one request, and it is the analysis — no network locate for a short clip
    expect(posted).toHaveLength(1);
    expect(posted[0].mode).toBeUndefined();

    const frames = posted[0].frames;
    expect(frames).toHaveLength(9);
    const times = frames.map((f) => f.t_ms);
    for (const t of times) {
      expect(typeof t).toBe('number');
      expect(t!).toBeGreaterThanOrEqual(1200);
      expect(t!).toBeLessThanOrEqual(2800);
    }
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    expect(times[0]).toBe(1200);
    expect(times[8]).toBe(2800);
  });

  it('each frame is resized by its LONG edge — a portrait frame is 768 tall, not 512 wide', async () => {
    onDeviceWindow.mockResolvedValue({ startSec: 1.2, endSec: 2.8, swingTimeSec: 2.3 });
    stubServer();
    await analyzeSwing('file:///clip-5500b.mp4', { club: '7i', swing_number: 1, tier: 'quick' });
    expect(resizes).toHaveLength(9);
    for (const a of resizes) expect(a).toEqual([{ resize: { height: 768 } }]);
  });

  it('the review can say where the frames came from', async () => {
    onDeviceWindow.mockResolvedValue({ startSec: 1.2, endSec: 2.8, swingTimeSec: 2.3 });
    stubServer();
    const r = await analyzeSwing('file:///clip-5500c.mp4', { club: '7i', swing_number: 1, tier: 'quick' });
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.analysis.sample_coverage).toEqual({ start_sec: 1.2, end_sec: 2.8, frames: 9, whole_clip: false });
  });

  it('when the device cannot find it, the read still gets nine frames — and no network locate, no rough flag', async () => {
    onDeviceWindow.mockResolvedValue(null);
    const posted = stubServer();
    const r = await analyzeSwing('file:///clip-5500d.mp4', { club: '7i', swing_number: 1, tier: 'quick' });
    expect(posted).toHaveLength(1);
    expect(posted[0].frames).toHaveLength(9);
    if (r.kind !== 'ok') throw new Error('expected ok');
    expect(r.locate_degraded).toBeNull();
    expect(r.analysis.sample_coverage!.whole_clip).toBe(true);
  });
});

describe('a caller-supplied window (the acoustic strike segment) gets the same nine', () => {
  it('nine evenly spaced frames inside the window, both tiers', async () => {
    for (const tier of ['quick', 'full'] as const) {
      const posted = stubServer();
      await analyzeSwing(`file:///clip-bounded-${tier}.mp4`, { club: '7i', swing_number: 1, tier }, { startSec: 2, endSec: 3.6 });
      expect(onDeviceWindow).not.toHaveBeenCalled();
      const times = posted[0].frames.map((f) => f.t_ms!);
      expect(times).toEqual([2000, 2200, 2400, 2600, 2800, 3000, 3200, 3400, 3600]);
    }
  });
});
