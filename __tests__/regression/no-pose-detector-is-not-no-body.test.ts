/**
 * 2026-10-13 — the first real field users. One iPhone 13 (iOS, 1.0.2+31) filed pose_zero_frames on
 * every swing with reason 'no_pose_in_frame'. Nothing had looked: iOS has no on-device pose module
 * and the cloud proxy answers { configured: false } while POSE_API_KEY is unset. The reason must name
 * the missing detector, never the player's framing.
 */
import { analyzePoseFromUri, poseDetectorUnavailable } from '../../services/poseAnalysisApi';

// jest hoists this above the import.
const mockMp = { available: false };
jest.mock('../../services/mediaPipePoseService', () => ({
  detectPoseFromUri: jest.fn(async () => null),
  isMediaPipeAvailable: () => mockMp.available,
}));

const answer = (body: unknown) => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({ ok: true, json: async () => body }));
};

describe('no detector is not no body', () => {
  beforeEach(() => { mockMp.available = false; });

  it('no native module + cloud unconfigured → the detector is unavailable', async () => {
    answer({ data: null, configured: false });
    expect(await analyzePoseFromUri('https://x/frame.jpg')).toBeNull();
    expect(poseDetectorUnavailable()).toBe(true);
  });

  it('cloud configured but found nobody → a real no-body read', async () => {
    answer({ data: null, configured: true });
    expect(await analyzePoseFromUri('https://x/frame.jpg')).toBeNull();
    expect(poseDetectorUnavailable()).toBe(false);
  });

  it('the native module ran and found nobody → a real no-body read, whatever the cloud says', async () => {
    mockMp.available = true;
    answer({ data: null, configured: false });
    await analyzePoseFromUri('https://x/frame.jpg');
    expect(poseDetectorUnavailable()).toBe(false);
  });

  it('a network failure is not "unconfigured"', async () => {
    answer({ data: null, configured: false });
    await analyzePoseFromUri('https://x/frame.jpg');
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => { throw new Error('offline'); });
    await analyzePoseFromUri('https://x/frame.jpg');
    expect(poseDetectorUnavailable()).toBe(false);
  });

  it('the frame failure reason uses it', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../../services/poseAnalysisApi.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toContain("lastFrameFailure = poseDetectorUnavailable() ? 'no_pose_detector' : 'no_pose_in_frame';");
  });
});
