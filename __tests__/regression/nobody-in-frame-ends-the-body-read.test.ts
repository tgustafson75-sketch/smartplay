/**
 * 2026-10-17 — Tim's range session, 1792269387918_369ror_cage: a 3.8s capture with nobody in shot.
 *
 *   pose frames · requested=20 got=0 window=0-3832ms
 *   pose_zero_frames · reason=no_pose_in_frame
 *   shot pose: failed · ms=120022 error=budget
 *
 * Every empty frame fell through to the cloud proxy, and the sweep asked for every one of twenty frames
 * plus two nudges per anchor — so an empty tee box held the decoder for its whole 120s budget, through
 * the NEXT capture's analysis. Nobody in frame is an answer: the sweep stops once address, takeaway and
 * top have all come back empty.
 */
import { extractPoseFramesFromVideo } from '../../services/poseAnalysisApi';

const mockReads: number[] = [];
let mockBodyFrom = Infinity;   // a body appears at or after this time (ms)
jest.mock('../../services/mediaPipePoseService', () => ({
  detectPoseFromUri: jest.fn(async (_u: string, _o: unknown, t: number) => (t >= mockBodyFrom
    ? { timestampMs: t, keypoints: [{ name: 'left_wrist', x: 0.5, y: 0.6, score: 0.9 }, { name: 'right_wrist', x: 0.5, y: 0.6, score: 0.9 }] }
    : null)),
  isMediaPipeAvailable: () => true,
  getMediaPipeStatus: async () => ({ available: true }),
}));
jest.mock('../../utils/videoThumbnail', () => ({
  getThumbnailAsync: jest.fn(async (_u: string, o: { time: number }) => { mockReads.push(o.time); return { uri: `file:///t${o.time}.jpg`, width: 1080, height: 1920 }; }),
}));
jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: async () => ({ exists: true, size: 4_000_000 }),
  deleteAsync: async () => undefined,
  readAsStringAsync: async () => 'AAAA',
  EncodingType: { Base64: 'base64' },
}));
jest.mock('../../services/swing/sharedClipCopy', () => ({ acquireClipCopy: async (u: string) => ({ uri: u, release: () => undefined }) }));

beforeEach(() => {
  mockReads.length = 0;
  mockBodyFrom = Infinity;
  // The cloud proxy answers "configured, nobody there" for every frame the device found nobody in.
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ data: null, configured: true }) }));
});

describe('nobody in frame ends the body read', () => {
  it('the 3.8s empty capture stops after address, takeaway and top — not twenty frames and their nudges', async () => {
    const frames = await extractPoseFramesFromVideo('file:///rec-3832.mp4', 3832, true, { startMs: 0, endMs: 3832 }, null);
    expect(frames).toBeNull();
    // Before the fix: every one of the ~20 sample times plus two nudges per missed anchor (~30 reads,
    // each a cloud call) — the 120s budget. Now: three anchors and their nudges.
    expect(mockReads.length).toBeLessThanOrEqual(9);
  });

  it('a swing with a body in it still reads every frame', async () => {
    mockBodyFrom = 0;
    const frames = await extractPoseFramesFromVideo('file:///rec-3832.mp4', 3832, true, { startMs: 0, endMs: 3832 }, null);
    expect(frames?.length ?? 0).toBeGreaterThanOrEqual(15);
  });

  it('a player who walks in after address is still found (the first anchor misses, a later one reads)', async () => {
    mockBodyFrom = 1200;
    const frames = await extractPoseFramesFromVideo('file:///rec-3832.mp4', 3832, true, { startMs: 0, endMs: 3832 }, null);
    expect(frames?.length ?? 0).toBeGreaterThan(5);
  });
});

/**
 * 2026-10-17 (review of F2a) — the 15s stop counted CLOUD time. Every frame the device finds nobody in
 * falls through to the cloud proxy, 5-15s each: one missed address frame and its two nudges passed 15s
 * and the sweep stopped before takeaway or top were tried — a golfer who walked in late lost his read.
 */
describe('a slow cloud does not end the search for a golfer who walks in late', () => {
  let clock = 1_000_000;
  let nowSpy: jest.SpyInstance;
  beforeEach(() => {
    clock = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => clock);
    // Each cloud call takes 8s and finds nobody.
    (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => { clock += 8_000; return { ok: true, json: async () => ({ data: null, configured: true }) }; });
  });
  afterEach(() => nowSpy.mockRestore());

  it('address and takeaway are empty (cloud asked, slowly); the body at the top is still found', async () => {
    mockBodyFrom = 1500;   // in place by the top (1916ms), not at address (192) or takeaway (958)
    const frames = await extractPoseFramesFromVideo('file:///rec-3832.mp4', 3832, true, { startMs: 0, endMs: 3832 }, null);
    expect(frames?.length ?? 0).toBeGreaterThan(3);
  });

  it('while nobody has been seen, a nudge asks the device only', async () => {
    mockBodyFrom = 1500;
    await extractPoseFramesFromVideo('file:///rec-3832.mp4', 3832, true, { startMs: 0, endMs: 3832 }, null);
    // address and takeaway each asked the cloud once; their four nudges did not
    expect((global as unknown as { fetch: jest.Mock }).fetch.mock.calls.length).toBe(2);
  });
});
