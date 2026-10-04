/**
 * 2026-10-03 — Tim: "Is all of this being managed by an orchestrator?" It was not: five places started
 * analysis stages and one 6-second upload collided with itself (two reads, a second clip copy, a pose
 * pass fighting the read's frames). services/swing/analysisOrchestrator now owns where the swing is and
 * one read per swing at a time.
 */
import { analyzeOnce, findUploadSwingWindow, pickSwingBurst } from '../../services/swing/analysisOrchestrator';

// jest.mock calls below are hoisted above this import.
const mockPlatform = { OS: 'android' };
jest.mock('react-native', () => ({ Platform: mockPlatform }));
const mockMotion = jest.fn();
jest.mock('../../services/frameEngine', () => ({ ensureFrameEngine: async () => true, findMotionWindow: (...a: unknown[]) => mockMotion(...a) }));
const mockOnDevice = jest.fn();
jest.mock('../../services/swing/onDeviceLocate', () => ({ locateSwingWindowOnDevice: (...a: unknown[]) => mockOnDevice(...a) }));
const mockNetwork = jest.fn();
jest.mock('../../services/poseDetection', () => ({ locateSwingWindow: (...a: unknown[]) => mockNetwork(...a) }));

beforeEach(() => { mockMotion.mockReset(); mockOnDevice.mockReset(); mockNetwork.mockReset(); mockPlatform.OS = 'android'; });

describe('one owner decides where the swing is', () => {
  it('the motion pass answers first — no pose locate, no network', async () => {
    mockMotion.mockResolvedValue({ durationMs: 14500, window: { startMs: 5300, endMs: 7900, peakMs: 6800 } });
    const w = await findUploadSwingWindow('file:///c.mp4', 14.5);
    expect(w).toEqual(expect.objectContaining({ via: 'motion', startSec: 5.3, endSec: 7.9 }));
    expect(mockOnDevice).not.toHaveBeenCalled();
    expect(mockNetwork).not.toHaveBeenCalled();
  });

  it('a short clip with no clear motion is the swing — still no locate', async () => {
    mockMotion.mockResolvedValue({ durationMs: 6000, window: null });
    const w = await findUploadSwingWindow('file:///c.mp4', 6);
    expect(w).toEqual(expect.objectContaining({ via: 'whole_clip', startSec: 0, endSec: 6 }));
    expect(mockOnDevice).not.toHaveBeenCalled();
  });

  it('a long clip falls back to the on-device locate, then the network, then the middle', async () => {
    mockMotion.mockRejectedValue(new Error('engine gone'));
    mockOnDevice.mockResolvedValue(null);
    mockNetwork.mockResolvedValue({ startSec: 6, endSec: 8, swingTimeSec: 7 });
    expect((await findUploadSwingWindow('file:///c.mp4', 30)).via).toBe('network');
    mockNetwork.mockResolvedValue(null);
    expect((await findUploadSwingWindow('file:///c.mp4', 30)).via).toBe('middle');
  });

  it('iOS skips the browser pass (no engine there)', async () => {
    mockPlatform.OS = 'ios';
    mockOnDevice.mockResolvedValue({ startSec: 6, endSec: 8, swingTimeSec: 7 });
    expect((await findUploadSwingWindow('file:///c.mp4', 30)).via).toBe('on_device');
    expect(mockMotion).not.toHaveBeenCalled();
  });
});

describe('motion proposes, pose confirms', () => {
  // Tim's 14.5s clip, real bursts from the emulator: the swing (~7.2s) and turning to watch the ball
  // (~10.5s), which OUT-SCORES the swing on motion.
  const bursts = [
    { startMs: 6161, endMs: 7248, peakMs: 7248, peak: 25 },
    { startMs: 9785, endMs: 10872, peakMs: 10872, peak: 27.5 },
  ];
  it("picks the burst where the hands go above the shoulders, not the bigger one", async () => {
    const read = async (_u: string, t: number) => ({ handsHigh: t > 6500 && t < 7700 });
    await expect(pickSwingBurst('file:///c.mp4', bursts, read)).resolves.toEqual(bursts[0]);
  });
  it('no burst with hands up → no answer (the locate chain takes over)', async () => {
    await expect(pickSwingBurst('file:///c.mp4', bursts, async () => ({ handsHigh: false }))).resolves.toBeNull();
  });
});

describe('one read per swing at a time', () => {
  it('a second trigger joins the running read instead of starting another', async () => {
    let runs = 0;
    let release!: () => void;
    const work = () => { runs++; return new Promise<string>((r) => { release = () => r('done'); }); };
    const a = analyzeOnce('s1', work);
    const b = analyzeOnce('s1', work);
    expect(runs).toBe(1);
    release();
    await expect(Promise.all([a, b])).resolves.toEqual(['done', 'done']);
    // settled → the next explicit re-analyze starts fresh
    const c = analyzeOnce('s1', async () => { runs++; return 'again'; });
    await expect(c).resolves.toBe('again');
    expect(runs).toBe(2);
  });
});
