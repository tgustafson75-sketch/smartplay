/**
 * 2026-10-03 — Android's native thumbnail call returns the nearest KEYFRAME (~1s apart), so swing
 * analysis saw two or three distinct pictures. services/frameEngine asks a hidden browser <video> for
 * the exact frame instead (no native change); it is also the pose fallback when the native engine
 * fails at inference. This pins the bridge: requests resolve from the page's replies, and a missing
 * or silent engine rejects so callers fall back to native instead of hanging.
 */
import {
  attachFrameEngine, detachFrameEngine, onFrameEngineMessage, grabExactFrame, detectPoseInBrowser, isFrameEngineReady,
} from '../../services/frameEngine';

afterEach(() => detachFrameEngine());

describe('the browser frame engine bridge', () => {
  it('is not ready until the page says so — and rejects instead of hanging', async () => {
    attachFrameEngine(() => undefined);
    expect(isFrameEngineReady()).toBe(false);
    await expect(grabExactFrame('file:///c.mp4', 6750)).rejects.toThrow(/not ready/);
  });

  it('a grab resolves with the exact frame the page drew', async () => {
    const sent: string[] = [];
    attachFrameEngine((js) => sent.push(js));
    onFrameEngineMessage(JSON.stringify({ type: 'ready' }));
    const p = grabExactFrame('file:///c.mp4', 6751, 640);
    expect(sent[0]).toMatch(/__grab\(\d+, "file:\/\/\/c\.mp4", 6751, 640\)/);
    const id = Number(sent[0].match(/__grab\((\d+)/)![1]);
    onFrameEngineMessage(JSON.stringify({ type: 'frame', id, ok: true, b64: 'AAAA', w: 480, h: 640 }));
    await expect(p).resolves.toEqual({ b64: 'AAAA', width: 480, height: 640 });
  });

  it('a page failure or a silent page rejects, so the caller falls back to native', async () => {
    const sent: string[] = [];
    attachFrameEngine((js) => sent.push(js));
    onFrameEngineMessage(JSON.stringify({ type: 'ready' }));
    const p = grabExactFrame('file:///c.mp4', 100);
    const id = Number(sent[0].match(/__grab\((\d+)/)![1]);
    onFrameEngineMessage(JSON.stringify({ type: 'frame', id, ok: false, error: 'load 4' }));
    await expect(p).rejects.toThrow(/load 4/);
    jest.useFakeTimers();
    const q = grabExactFrame('file:///c.mp4', 200, 640, 1000);
    jest.advanceTimersByTime(1001);
    await expect(q).rejects.toThrow(/timeout/);
    jest.useRealTimers();
  });

  it('browser pose returns the landmarks the page found', async () => {
    const sent: string[] = [];
    attachFrameEngine((js) => sent.push(js));
    onFrameEngineMessage(JSON.stringify({ type: 'ready' }));
    const p = detectPoseInBrowser('BBBB');
    const id = Number(sent[0].match(/__pose\((\d+)/)![1]);
    const lm = [{ x: 0.5, y: 0.5, z: 0, visibility: 0.9, presence: 0.9 }];
    onFrameEngineMessage(JSON.stringify({ type: 'pose', id, ok: true, landmarks: lm }));
    await expect(p).resolves.toEqual(lm);
  });
});
