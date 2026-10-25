/**
 * 2026-10-13 — the first real field users. One iPhone 13 (iOS, 1.0.2+31) filed pose_zero_frames on
 * every swing with reason 'no_pose_in_frame'. Nothing had looked: iOS has no on-device pose module
 * and the cloud proxy answers { configured: false } while POSE_API_KEY is unset. The reason must name
 * the missing detector, never the player's framing.
 */
import { analyzePoseFromUri, poseDetectorUnavailable, extractPoseFramesFromVideo, type PoseReadOutcome } from '../../services/poseAnalysisApi';

// jest hoists this above the import.
const mockMp = { available: false };
jest.mock('../../services/mediaPipePoseService', () => ({
  detectPoseFromUri: jest.fn(async () => null),
  isMediaPipeAvailable: () => mockMp.available,
  getMediaPipeStatus: async () => ({ available: mockMp.available }),
}));
jest.mock('../../utils/videoThumbnail', () => ({
  getThumbnailAsync: jest.fn(async (_u: string, o: { time: number }) => ({ uri: `file:///t${o.time}.jpg`, width: 1080, height: 1920 })),
}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: async () => ({ exists: true, size: 4_000_000 }),
  deleteAsync: async () => undefined,
  readAsStringAsync: async () => 'AAAA',
  EncodingType: { Base64: 'base64' },
}));
jest.mock('../../services/swing/sharedClipCopy', () => ({ acquireClipCopy: async (u: string) => ({ uri: u, release: () => undefined }) }));

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

/**
 * 2026-10-25 (Sentry N4 — iPhone14,5, build 31, 10-19: `pose_zero_frames · no_pose_detector · nativePose
 * false · stoppedEarly true`). The body read came back empty because nothing LOOKED, and the run stored
 * that null as "read, nobody there" — so after the store update that gives the iPhone its pose module,
 * that swing was never read again. The sweep now says whether any detector looked at a frame.
 */
describe('a body read nothing looked at says so', () => {
  const sweep = async () => {
    const outcome: PoseReadOutcome = {};
    const frames = await extractPoseFramesFromVideo('file:///rec-4000.mp4', 4000, true, { startMs: 0, endMs: 4000 }, null, undefined, 0, outcome);
    return { frames, outcome };
  };
  beforeEach(() => { mockMp.available = false; });

  it('no native module and the cloud unconfigured → unanswered', async () => {
    answer({ data: null, configured: false });
    const { frames, outcome } = await sweep();
    expect(frames).toBeNull();
    expect(outcome.unanswered).toBe(true);
  });

  it('no native module and the cloud unreachable → unanswered (nothing could have seen him)', async () => {
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => { throw new Error('Network request failed'); });
    const { outcome } = await sweep();
    expect(outcome.unanswered).toBe(true);
  });

  it('the cloud looked and found nobody → an answer', async () => {
    answer({ data: null, configured: true });
    const { frames, outcome } = await sweep();
    expect(frames).toBeNull();
    expect(outcome.unanswered).toBe(false);
  });

  it('the on-device engine looked and found nobody → an answer, whatever the cloud says', async () => {
    mockMp.available = true;
    answer({ data: null, configured: false });
    const { outcome } = await sweep();
    expect(outcome.unanswered).toBe(false);
  });
});

