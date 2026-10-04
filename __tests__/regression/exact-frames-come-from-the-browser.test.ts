/**
 * 2026-10-03 — Android's native thumbnail call returns the nearest KEYFRAME (~1s apart), so swing
 * analysis saw two or three distinct pictures. services/frameEngine asks a hidden browser <video> for
 * the exact frame instead (no native change); it is also the pose fallback when the native engine
 * fails at inference. This pins the bridge: requests resolve from the page's replies, and a missing
 * or silent engine rejects so callers fall back to native instead of hanging.
 */
import {
  attachFrameEngine, detachFrameEngine, onFrameEngineMessage, grabExactFrame, detectPoseInBrowser, isFrameEngineReady,
  findMotionWindow, frameEngineState, _resetFrameEngineForTest,
} from '../../services/frameEngine';

afterEach(() => { detachFrameEngine(); _resetFrameEngineForTest(); });

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
    // 2026-10-04 (sweep) — the clock starts when the page STARTS the job ('start' ack).
    const q = grabExactFrame('file:///c.mp4', 200, 640, 1000);
    const qid = Number(sent[sent.length - 1].match(/__grab\((\d+)/)![1]);
    onFrameEngineMessage(JSON.stringify({ type: 'start', id: qid }));
    jest.advanceTimersByTime(1001);
    await expect(q).rejects.toThrow(/frame engine timeout/);
    jest.useRealTimers();
  });

  it('a job still QUEUED behind other work is not timed as if it were running, and never resets the page', async () => {
    const sent: string[] = [];
    attachFrameEngine((js) => sent.push(js));
    onFrameEngineMessage(JSON.stringify({ type: 'ready' }));
    jest.useFakeTimers();
    const gen0 = frameEngineState().generation;
    const q = grabExactFrame('file:///c.mp4', 200, 640, 1000);
    jest.advanceTimersByTime(5_000);                 // well past the 1s work limit, but never started
    expect(frameEngineState().generation).toBe(gen0);
    jest.advanceTimersByTime(60_000);
    await expect(q).rejects.toThrow(/queue timeout/);
    expect(frameEngineState().generation).toBe(gen0); // queue wait is load, not a dead page
    jest.useRealTimers();
  });

  it('a slow motion pass is CANCELLED in the page, not answered with a page reset', async () => {
    const sent: string[] = [];
    attachFrameEngine((js) => sent.push(js));
    onFrameEngineMessage(JSON.stringify({ type: 'ready' }));
    jest.useFakeTimers();
    const gen0 = frameEngineState().generation;
    const m = findMotionWindow('file:///c.mp4', 1000);
    const mid = Number(sent[sent.length - 1].match(/__motion\((\d+)/)![1]);
    onFrameEngineMessage(JSON.stringify({ type: 'start', id: mid }));
    jest.advanceTimersByTime(1001);
    await expect(m).rejects.toThrow(/motion window timeout/);
    expect(sent[sent.length - 1]).toMatch(new RegExp(`__cancel\\(${mid}\\)`));
    expect(frameEngineState().generation).toBe(gen0);
    jest.useRealTimers();
  });

  it('browser pose remembers a LOAD failure, not an engine that was still warming up', async () => {
    const sent: string[] = [];
    attachFrameEngine((js) => sent.push(js));
    onFrameEngineMessage(JSON.stringify({ type: 'ready' }));
    const p = detectPoseInBrowser('AAAA');
    const id = Number(sent[sent.length - 1].match(/__pose\((\d+)/)![1]);
    onFrameEngineMessage(JSON.stringify({ type: 'pose', id, ok: false, error: 'image decode' }));
    await expect(p).rejects.toThrow(/image decode/);
    // a bad frame did not switch it off: the next request still goes to the page
    const p2 = detectPoseInBrowser('BBBB');
    const id2 = Number(sent[sent.length - 1].match(/__pose\((\d+)/)![1]);
    expect(id2).toBeGreaterThan(id);
    onFrameEngineMessage(JSON.stringify({ type: 'pose', id: id2, ok: false, error: 'pose load: pose runtime timeout' }));
    await expect(p2).rejects.toThrow(/pose load/);
    await expect(detectPoseInBrowser('CCCC')).rejects.toThrow(/recent load failure/);
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

  it('a page reset makes the next pose call COLD again (no warm-timeout reset loop)', async () => {
    const sent: string[] = [];
    attachFrameEngine((js) => sent.push(js));
    onFrameEngineMessage(JSON.stringify({ type: 'ready' }));
    const p = detectPoseInBrowser('AAAA');
    const id = Number(sent[sent.length - 1].match(/__pose\((\d+)/)![1]);
    onFrameEngineMessage(JSON.stringify({ type: 'pose', id, ok: true, landmarks: [{ x: 0, y: 0, z: 0, visibility: 1, presence: 1 }] }));
    await p;                                                      // warm now
    const { resetFrameEngine } = await import('../../services/frameEngine');
    resetFrameEngine('test');
    attachFrameEngine((js) => sent.push(js));
    onFrameEngineMessage(JSON.stringify({ type: 'ready' }));
    jest.useFakeTimers();
    const q = detectPoseInBrowser('BBBB');
    const qid = Number(sent[sent.length - 1].match(/__pose\((\d+)/)![1]);
    onFrameEngineMessage(JSON.stringify({ type: 'start', id: qid }));
    let settled = false;
    q.then(() => { settled = true; }, () => { settled = true; });
    jest.advanceTimersByTime(9_000);                              // past the WARM 8s, inside the cold 35s
    await Promise.resolve();
    expect(settled).toBe(false);
    onFrameEngineMessage(JSON.stringify({ type: 'pose', id: qid, ok: true, landmarks: [] }));
    jest.useRealTimers();
    await q;
  });
});

describe('the page itself', () => {
  const page = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'components/FrameEngineHost.tsx'), 'utf8') as string;
  it('acks each job when it STARTS, and releases the decoder only when nothing is queued', () => {
    expect(page).toMatch(/function begin\(id\) \{[\s\S]{0,120}?post\(\{ type: 'start', id: id \}\)/);
    expect(page).toMatch(/function settle\(\) \{ queued--;[^}]*idle = queued > 0 \? null : setTimeout\(release, 8000\)/);
    expect((page.match(/queued\+\+;/g) ?? []).length).toBe(2);      // grab + motion
  });
  it('a motion pass stops when the app cancels it', () => {
    expect(page).toMatch(/if \(cancelled\[id\]\) return Promise\.reject\(new Error\('cancelled'\)\);/);
  });
});

