/**
 * 2026-10-25 (Sentry MM → MQ → MS, one Fold3 turn on 10-17) — THE MIC WORKED; THE UPLOAD DIDN'T.
 *
 * MM: capture_utterance — "all attempts failed — AbortError: Aborted". Both transcribe upload races
 * died (no signal). captureUtteranceDetailed's outer catch filed that throw as bail 'error' — "the
 * microphone died" — so listeningSession RETRIED THE CAPTURE (MQ, listen_capture_retry bail:error),
 * re-opening the mic and making the player say it all again into a network that was still down
 * (MS: 8s of speech, nothing back), and then spoke the mic-trouble line about a mic that was fine.
 *
 * The real captureUtteranceDetailed, native edges stubbed (expo-av, file system, network).
 */
const mockRec = { cb: null as null | ((s: { isRecording: boolean; metering?: number }) => void), startedAt: 0 };

jest.mock('expo-av', () => {
  const leaf = new Proxy({}, { get: (_t, p) => String(p) });
  return {
    __esModule: true,
    InterruptionModeIOS: leaf,
    InterruptionModeAndroid: leaf,
    Audio: {
      AndroidOutputFormat: leaf, AndroidAudioEncoder: leaf, IOSOutputFormat: leaf, IOSAudioQuality: leaf,
      requestPermissionsAsync: async () => ({ granted: true }),
      setAudioModeAsync: async () => undefined,
      Sound: { createAsync: async () => ({ sound: { unloadAsync: async () => undefined, stopAsync: async () => undefined } }) },
      Recording: {
        createAsync: async (_o: unknown, cb: typeof mockRec.cb) => {
          mockRec.cb = cb;
          mockRec.startedAt = Date.now();
          return {
            recording: {
              getURI: () => 'file:///capture.m4a',
              getStatusAsync: async () => ({ durationMillis: Date.now() - mockRec.startedAt }),
              stopAndUnloadAsync: async () => undefined,
            },
          };
        },
      },
    },
  };
});
jest.mock('expo-file-system/legacy', () => ({ getInfoAsync: async () => ({ exists: true, size: 40_000 }) }));

import { captureUtteranceDetailed } from '../../services/voiceService';
import { responseForCaptureBail, shouldRetryCapture } from '../../services/voice/captureBail';

beforeEach(() => {
  mockRec.cb = null;
  // No signal: every upload attempt aborts, exactly the MM payload.
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => {
    const e = new Error('Aborted');
    e.name = 'AbortError';
    throw e;
  });
});
afterEach(() => jest.useRealTimers());

async function speakThenSilence() {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
  const p = captureUtteranceDetailed(8_000, 'https://api.test');
  for (let i = 0; i < 50 && !mockRec.cb; i++) await jest.advanceTimersByTimeAsync(10);
  expect(mockRec.cb).not.toBeNull();
  // ~2s of a clear voice, then quiet — the endpointer ends it and the upload is attempted.
  for (let i = 0; i < 20; i++) { mockRec.cb!({ isRecording: true, metering: -8 }); await jest.advanceTimersByTimeAsync(100); }
  for (let i = 0; i < 60; i++) { mockRec.cb!({ isRecording: true, metering: -45 }); await jest.advanceTimersByTimeAsync(100); }
  await jest.advanceTimersByTimeAsync(60_000);
  return p;
}

describe('a capture whose upload fails is a connection failure, not a mic failure', () => {
  it('THE BUG: both upload attempts abort → bail is transcribe_failed, not error', async () => {
    const r = await speakThenSilence();
    expect(r.heardSpeech).toBe(true);
    expect(r.bail).toBe('transcribe_failed');
    expect(r.bail).not.toBe('error');
  });

  it('so the session does not reopen the mic, and says the connection line, not the mic-trouble line', async () => {
    const r = await speakThenSilence();
    expect(shouldRetryCapture(r.bail)).toBe(false);
    expect(responseForCaptureBail(r.bail)).toBe('connection');
  });
});
