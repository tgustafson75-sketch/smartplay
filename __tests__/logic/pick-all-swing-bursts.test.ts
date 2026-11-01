/**
 * Every swing in a long clip (Tim 11-01): the burst picker confirms each motion burst with the pose read, not only
 * the first one. The pose reader is injected, so this runs without a device.
 */
import { pickAllSwingBursts, MAX_SWING_CANDIDATES } from '../../services/swing/analysisOrchestrator';

jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
jest.mock('../../services/frameEngine', () => ({ ensureFrameEngine: async () => true, findMotionWindow: async () => ({ durationMs: 0, window: null, bursts: [] }) }));
jest.mock('../../services/swing/sharedClipCopy', () => ({ acquireClipCopy: async (u: string) => ({ uri: u, release: () => undefined }) }));
jest.mock('../../utils/videoThumbnail', () => ({ getThumbnailAsync: async () => { throw new Error('no frame'); } }));
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: async () => null }));
jest.mock('../../services/poseDetection', () => ({ locateSwingWindow: async () => null }));

/** A hands-high reading near each swing's peak, nothing elsewhere. */
const handsHighAt = (peaks: number[]) => async (_uri: string, t: number) => ({ handsHigh: peaks.some((p) => Math.abs(t - p) <= 400) });
const burst = (peakMs: number, peak = 1) => ({ startMs: peakMs - 1000, endMs: peakMs + 1000, peakMs, peak });

describe('pickAllSwingBursts', () => {
  it('returns every confirmed swing, in time order', async () => {
    const bursts = [burst(12_000, 0.9), burst(2_000, 0.5), burst(7_000, 0.7)];
    const found = await pickAllSwingBursts('file:///c.mp4', bursts, handsHighAt([2_000, 7_000, 12_000]));
    expect(found.map((f) => f.peakMs)).toEqual([2_000, 7_000, 12_000]);
  });

  it('leaves out a burst where the hands never rise (walking, a practice waggle)', async () => {
    const bursts = [burst(2_000), burst(9_000)];
    const found = await pickAllSwingBursts('file:///c.mp4', bursts, handsHighAt([2_000]));
    expect(found.map((f) => f.peakMs)).toEqual([2_000]);
  });

  it('counts a swing once when the motion pass split it into two overlapping bursts', async () => {
    const bursts = [burst(5_000, 0.9), { startMs: 4_500, endMs: 6_500, peakMs: 5_600, peak: 0.6 }];
    const found = await pickAllSwingBursts('file:///c.mp4', bursts, handsHighAt([5_000]));
    expect(found).toHaveLength(1);
  });

  it('returns what it has confirmed when the time budget runs out, not nothing', async () => {
    let now = 0;
    const clock = () => now;
    const bursts = [burst(2_000, 0.9), burst(7_000, 0.5)];
    const read = async (_uri: string, t: number) => {
      now += 6_000; // each read costs time, so the second burst is never reached
      return { handsHigh: Math.abs(t - 2_000) <= 400 };
    };
    const found = await pickAllSwingBursts('file:///c.mp4', bursts, read, 8_000, clock);
    expect(found.map((f) => f.peakMs)).toEqual([2_000]);
  });

  it('considers only the strongest few bursts', async () => {
    const bursts = Array.from({ length: MAX_SWING_CANDIDATES + 5 }, (_, i) => burst(1_000 + i * 3_000, 1 - i * 0.01));
    const found = await pickAllSwingBursts('file:///c.mp4', bursts, async () => ({ handsHigh: false }));
    expect(found).toEqual([]);
    expect(MAX_SWING_CANDIDATES).toBeLessThan(bursts.length);
  });
});
