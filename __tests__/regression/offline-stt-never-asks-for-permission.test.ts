/**
 * 2026-10-15 (review) — THE OFFLINE TRANSCRIPT NEVER RAISES A PERMISSION DIALOG.
 *
 * services/onDeviceSTT.recognizeOnceOnDevice called requestPermissionsAsync, and nothing else in the
 * app asks for speech-recognition permission — so on iOS the first offline turn threw a surprise
 * "Allow Speech Recognition?" system dialog mid-round (the 5.1.1 request-in-context problem 1.0 was
 * rejected for). It must only READ the permission, and run only when it is already granted.
 *
 * BEHAVIOURAL: the real module against a mocked native recogniser.
 */
function load(granted: boolean | 'throws' | 'missing') {
  const native = {
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
    addListener: jest.fn((event: string, cb: (e: unknown) => void) => {
      if (event === 'result') setTimeout(() => cb({ results: [{ transcript: 'how far to the pin' }], isFinal: true }), 0);
      return { remove: () => undefined };
    }),
    isRecognitionAvailable: () => true,
    supportsOnDeviceRecognition: () => true,
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    getPermissionsAsync: granted === 'missing'
      ? undefined
      : jest.fn(async () => { if (granted === 'throws') throw new Error('x'); return { granted }; }),
  };
  jest.resetModules();
  jest.doMock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: native }));
  const stt = require('../../services/onDeviceSTT') as typeof import('../../services/onDeviceSTT');
  return { stt, native };
}

afterEach(() => jest.dontMock('expo-speech-recognition'));

describe('the caller can ask BEFORE it speaks "say that again"', () => {
  it('hasOnDeviceSTTPermission reflects the read permission, and never requests', async () => {
    for (const g of [false, 'throws', 'missing', true] as const) {
      const { stt, native } = load(g);
      const has = (stt as unknown as { hasOnDeviceSTTPermission?: () => Promise<boolean> }).hasOnDeviceSTTPermission;
      expect(typeof has).toBe('function');
      expect(await has!()).toBe(g === true);
      expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    }
  });
});

describe('on-device STT reads the permission and never requests it', () => {
  it.each([false, 'throws', 'missing'] as const)('permission %s → no dialog, no recognition, null', async (g) => {
    const { stt, native } = load(g);
    expect(await stt.recognizeOnceOnDevice('en', { timeoutMs: 200 })).toBeNull();
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(native.start).not.toHaveBeenCalled();
  });

  it('already granted → it recognises, still without asking', async () => {
    const { stt, native } = load(true);
    expect(await stt.recognizeOnceOnDevice('en', { timeoutMs: 500 })).toBe('how far to the pin');
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
  });
});
