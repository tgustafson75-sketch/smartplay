/**
 * 2026-10-10 — Sightline slice 1 (Meta glasses, glasses dev variant). The JS loop REUSES Kevin's paths:
 * the voice invocation opens Kevin through the earbud tap's own chokepoint, and a glasses read goes
 * through the TightLie vision path (enrichedLieAnalysis) and is spoken — capture on demand, stream
 * stopped right after, phone camera as the fallback.
 */
const listeners: Record<string, (p: Record<string, unknown>) => void> = {};
const mw = {
  register: jest.fn(),
  getRegistrationState: jest.fn(() => 'REGISTERED'),
  requestCameraPermission: jest.fn(async () => 'GRANTED'),
  startSession: jest.fn(async () => undefined),
  stopSession: jest.fn(),
  startStream: jest.fn(async () => { listeners.onStreamState?.({ state: 'STREAMING' }); }),
  stopStream: jest.fn(),
  capturePhoto: jest.fn(async () => 'file:///cache/glasses-1.jpg'),
  addListener: jest.fn((ev: string, cb: (p: Record<string, unknown>) => void) => { listeners[ev] = cb; return { remove() {} }; }),
};
let mockGate = true;
const mockToggle = jest.fn(async () => undefined);
const mockGoToTab = jest.fn();
const mockSpeak = jest.fn(async () => undefined);
const mockEnriched = jest.fn(async () => ({ voice_summary: 'Light rough, 152 to the middle. Smooth 8 iron.' }));

jest.mock('../../glasses-modules/meta-wearables', () => ({ metaWearables: () => mw }));
jest.mock('../../services/glassesGate', () => ({ isGlassesSurfaceEnabled: () => mockGate }));
jest.mock('../../services/listeningSession', () => ({ toggle: mockToggle, getSessionState: () => 'idle' }));
jest.mock('../../services/safeBack', () => ({ goToTab: mockGoToTab }));
jest.mock('../../services/voiceService', () => ({ speak: mockSpeak }));
jest.mock('../../services/lieAnalysisService', () => ({ enrichedLieAnalysis: mockEnriched }));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: async () => 'BASE64', EncodingType: { Base64: 'base64' } }));

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Sightline reuses Kevin', () => {
  it('"Hey Meta, start SmartPlay Caddie" → the Caddie screen + Kevin listening via the earbud chokepoint', async () => {
    const sl = await import('../../services/sightline');
    sl.startSightline();
    await tick();
    expect(mw.startSession).toHaveBeenCalledTimes(1);   // registered → session up
    listeners.onVoiceInvocation({ action: 'LaunchApp' });
    await tick(); await tick();
    expect(mockGoToTab).toHaveBeenCalledWith('caddie');
    expect(mockToggle).toHaveBeenCalledTimes(1);
  });

  it('"read my lie" with a session: one still → the TightLie vision path → spoken; stream stopped after', async () => {
    const sl = await import('../../services/sightline');
    expect(sl.glassesSessionActive()).toBe(true);
    const handled = await sl.readThroughGlasses();
    expect(handled).toBe(true);
    expect(mw.startStream).toHaveBeenCalledWith({ quality: 'LOW', fps: 2 });
    expect(mw.capturePhoto).toHaveBeenCalledTimes(1);
    expect(mw.stopStream).toHaveBeenCalledTimes(1);
    expect(mockEnriched).toHaveBeenCalledWith(expect.objectContaining({ imageBase64: 'BASE64', imageMediaType: 'image/jpeg' }));
    expect(mockSpeak).toHaveBeenCalledWith('Light rough, 152 to the middle. Smooth 8 iron.', expect.anything(), expect.anything(), expect.anything(), { userInitiated: true });
  });

  it('a failed capture still stops the stream, and hands the read back to the phone camera', async () => {
    const sl = await import('../../services/sightline');
    mw.capturePhoto.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'CAPTURE_FAILED' }));
    mw.stopStream.mockClear();
    expect(await sl.readThroughGlasses()).toBe(false);
    expect(mw.stopStream).toHaveBeenCalledTimes(1);
  });

  it('a device-ended session falls back to the phone', async () => {
    const sl = await import('../../services/sightline');
    listeners.onSessionError({ code: 'SESSION_ENDED_BY_DEVICE' });
    expect(sl.glassesSessionActive()).toBe(false);
    expect(await sl.readThroughGlasses()).toBe(false);
  });

  it('a registration already in flight is not started again (the app ⇄ Meta AI loop)', async () => {
    jest.isolateModules(() => {
      const sl = require('../../services/sightline') as typeof import('../../services/sightline');
      mw.getRegistrationState.mockReturnValue('REGISTERING');
      mw.register.mockClear();
      sl.startSightline();
      expect(mw.register).not.toHaveBeenCalled();
      mw.getRegistrationState.mockReturnValue('REGISTERED');
    });
  });

  it('no new endpoint and no on-device model: only the existing lie-analysis path', () => {
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const src = fs.readFileSync(path.join(__dirname, '../../services/sightline.ts'), 'utf8');
    expect(src).not.toMatch(/fetch\(|['"`]\/api\//);   // the doc comment names /api/lie-analysis; code must not call one
    expect(src).not.toMatch(/yolo|tflite|onnx/i);
    expect(fs.existsSync(path.join(__dirname, '../../api/caddie-advise-live.ts'))).toBe(false);
  });
});
