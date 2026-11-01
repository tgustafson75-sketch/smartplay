/**
 * 2026-10-31 (caddie-voice CAD-VOICE-2) — THE CUSTOM CADDIE'S RECORDED CLIPS PLAY ONLY WHEN IT IS THE ONE SPEAKING.
 *
 * speak() checked only profile.useCustomCaddie, which is true whenever the GLOBAL caddie is the custom one. A pillar
 * can assign Serena (or Kevin) while it stays on, and then a catalog phrase such as the opener's "Welcome back.
 * Let's play some golf." played in the custom caddie's recorded voice while every other line spoke as Serena.
 * The clip gate now reads the same resolver as the persona that speaks (activeVoice).
 *
 * Driven for real: the real speak() with the recorded-clip lookup, the audio player and the cloud voice stubbed at
 * their edges. The assertion is which source the player was handed.
 */
const playedSources: unknown[] = [];
let activePersona = 'serena';

jest.mock('expo-av', () => {
  const leaf = new Proxy({}, { get: (_t, p) => String(p) });
  return {
    __esModule: true,
    InterruptionModeIOS: leaf,
    InterruptionModeAndroid: leaf,
    Audio: {
      AndroidOutputFormat: leaf, AndroidAudioEncoder: leaf, IOSOutputFormat: leaf, IOSAudioQuality: leaf,
      setAudioModeAsync: async () => undefined,
      Sound: {
        createAsync: async (source: unknown) => {
          playedSources.push(source);
          const sound = {
            setOnPlaybackStatusUpdate: (cb: (s: { isLoaded: boolean; didJustFinish: boolean }) => void) => {
              if (typeof cb === 'function') setImmediate(() => cb({ isLoaded: true, didJustFinish: true }));
            },
            unloadAsync: async () => undefined,
            stopAsync: async () => undefined,
            playAsync: async () => undefined,
          };
          return { sound, status: { isLoaded: true, durationMillis: 500 } };
        },
      },
    },
  };
});
// One factory covers both specifiers: the logic project maps 'expo-file-system' and '/legacy' to one stub file.
jest.mock('expo-file-system', () => ({
  __esModule: true, File: class {}, Paths: { cache: '/tmp', document: '/tmp' },
  getInfoAsync: async () => ({ exists: true, size: 4000 }), cacheDirectory: '/tmp/', documentDirectory: '/tmp/',
}));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn(), isSpeakingAsync: async () => false }));
jest.mock('../../services/caddieResolver', () => ({ getActiveCaddie: () => activePersona }));
jest.mock('../../services/customCaddieClips', () => ({ lookupClipUri: () => 'file:///clips/welcome-back.m4a' }));
jest.mock('../../store/playerProfileStore', () => ({
  usePlayerProfileStore: { getState: () => ({ useCustomCaddie: true, customCaddieClips: {}, customCaddieVoice: null, customCaddieBasePersona: 'serena' }) },
}));
jest.mock('../../store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ voiceEnabled: true, localMode: false, voiceGender: 'female', language: 'en', caddiePersonality: 'serena', caddieAssignments: {} }) },
}));
jest.mock('../../store/trustLevelStore', () => ({ useTrustLevelStore: { getState: () => ({ level: 3 }) } }));
jest.mock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'http://localhost:9', isEndpointWarmed: () => true, markEndpointWarmed: () => undefined }));

const LINE = "Welcome back. Let's play some golf.";
const flush = async (n = 40) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

jest.setTimeout(60_000);

describe('a recorded custom-caddie clip plays only when the custom caddie is the one speaking', () => {
  const realFetch = (globalThis as { fetch?: unknown }).fetch;
  beforeEach(() => {
    playedSources.length = 0;
    // The cloud voice is not reached in these tests; a failed request ends the line on the device voice.
    (globalThis as { fetch?: unknown }).fetch = jest.fn(() => Promise.reject(new Error('offline in test')));
  });
  afterEach(() => { (globalThis as { fetch?: unknown }).fetch = realFetch; });

  it('THE BUG: a Serena line that matches a recorded catalog phrase does not play the custom caddie clip', async () => {
    activePersona = 'serena';
    const vs = jest.requireActual('../../services/voiceService') as typeof import('../../services/voiceService');
    await vs.speak(LINE, 'female', 'en', 'http://localhost:9', { userInitiated: true });
    await flush();
    expect(playedSources).not.toContainEqual({ uri: 'file:///clips/welcome-back.m4a' });
  });

  it('the custom caddie speaking still plays its own recorded clip', async () => {
    activePersona = 'custom';
    const vs = jest.requireActual('../../services/voiceService') as typeof import('../../services/voiceService');
    await vs.speak(LINE, 'female', 'en', 'http://localhost:9', { userInitiated: true });
    await flush();
    expect(playedSources).toContainEqual({ uri: 'file:///clips/welcome-back.m4a' });
  });
});
