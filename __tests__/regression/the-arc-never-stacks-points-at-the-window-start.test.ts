/**
 * 2026-10-26 (club-line diagnosis, step 4) — the tracker keeps clubhead detections up to 120ms BEFORE the
 * arc window, and every one of them was clamped to tMs 0. Two or three different clubhead positions then
 * shared the window's first instant, so the first stretch of the arc was drawn at the wrong time against
 * the body read (and the overlay pinned the head there). A detection before the window is outside it:
 * dropped, never re-timed.
 *
 * Driven through the real detectClubPath with the in-browser tracker stubbed to return Tim's 3870 track.
 */
import fx3870 from '../fixtures/clubtrack-3870.json';

const mockTrack = jest.fn();
beforeAll(() => {
  jest.resetModules();
  jest.doMock('react-native', () => ({ Platform: { OS: 'android' } }));
  jest.doMock('../../services/frameEngine', () => ({ ensureFrameEngine: async () => true, trackClubInBrowser: (...a: unknown[]) => mockTrack(...a) }));
  jest.doMock('../../services/swing/sharedClipCopy', () => ({ acquireClipCopy: async () => ({ uri: 'file:///copy.mp4', release: () => undefined }) }));
  jest.doMock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'https://api.test' }));
});

const pose = (t: number) => ({ timestampMs: t, keypoints: [
  { name: 'left_wrist', x: 0.5, y: 0.6, score: 0.9 }, { name: 'left_shoulder', x: 0.47, y: 0.5, score: 0.9 },
  { name: 'left_hip', x: 0.46, y: 0.62, score: 0.9 }, { name: 'left_ankle', x: 0.46, y: 0.78, score: 0.9 }, { name: 'nose', x: 0.5, y: 0.45, score: 0.9 },
] });

it('detections before the window start are dropped, so no two arc points share an instant', async () => {
  // The track's first two detections (6167, 6200ms) are inside the old 120ms slack before 6250.
  mockTrack.mockResolvedValue({ frames: 81, vw: 1440, vh: 1920, clubLen: 0.18, points: fx3870.points });
  const { detectClubPath } = await import('../../services/swing/clubPath');
  const startMs = 6250;
  const r = await detectClubPath({ videoUri: 'file:///c.mp4', startMs, endMs: 8300, trackerOnly: true, poseFrames: [0, 1, 2, 3, 4].map((k) => pose(6000 + k * 500)) as never });
  const ts = (r?.points ?? []).map((p) => p.tMs);
  expect(ts.length).toBeGreaterThanOrEqual(10);
  expect(new Set(ts).size).toBe(ts.length);          // never two clubhead positions at one instant
  expect(Math.min(...ts)).toBeGreaterThan(0);        // the first kept detection (6333ms) is 83ms in, not 0
  // and each point keeps its own time: the tracked t, window-relative
  const real = new Set((fx3870.points as ({ t: number } | null)[]).filter(Boolean).map((p) => p!.t - startMs));
  for (const t of ts) expect(real.has(t)).toBe(true);
});
