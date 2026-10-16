/**
 * 2026-10-15 (review G2, finding 7) — TWO CADDIES IN ONE TURN.
 *
 * The brain's payload names the ACTIVE per-pillar caddie (caddieRequestBody → getActiveCaddie). The
 * phone's voice — speak(), the cached-clip lookup and the clip warm — read the global
 * `caddiePersonality`. With Serena assigned to the Round pillar and Kevin as the global pick, the
 * brain wrote Serena's reply and the phone read it out in Kevin's voice (and offline played Kevin's
 * recordings). The voice now resolves the same active caddie the brain uses.
 */
const mockExists = { fn: (_name: string) => false };
jest.mock('expo-file-system', () => {
  class File {
    name: string; uri: string;
    constructor(_dir: unknown, name: string) { this.name = name; this.uri = `file:///cache/${name}`; }
    get exists() { return mockExists.fn(this.name); }
    get size() { return mockExists.fn(this.name) ? 24_000 : 0; }
    write() { /* not needed */ }
  }
  return { File, Paths: { cache: {} } };
});
const mockPlayed: string[] = [];
jest.mock('expo-av', () => {
  const base = jest.requireActual('../mocks/expoAv.js');
  const sound = {
    playAsync: async () => ({ isLoaded: true }),
    stopAsync: async () => undefined,
    unloadAsync: async () => undefined,
    setPositionAsync: async () => undefined,
    setVolumeAsync: async () => undefined,
    getStatusAsync: async () => ({ isLoaded: true, durationMillis: 800, didJustFinish: true }),
    setOnPlaybackStatusUpdate: (cb: ((s: unknown) => void) | null) => { if (cb) setTimeout(() => cb({ isLoaded: true, didJustFinish: true, durationMillis: 800 }), 0); },
  };
  const Sound = { createAsync: async (src: { uri?: string } | number) => {
    mockPlayed.push(typeof src === 'object' && src ? String(src.uri) : String(src));
    return { sound, status: { isLoaded: true, durationMillis: 800 } };
  } };
  const Audio = new Proxy(base.Audio, { get: (t, prop) => (prop === 'Sound' ? Sound : t[prop]) });
  return new Proxy(base, { get: (t, prop) => (prop === 'Audio' ? Audio : t[prop]) });
});
jest.mock('../../store/issueLogStore', () => ({
  useIssueLogStore: { getState: () => ({ addAppEvent: () => undefined, addVoiceEvent: () => undefined }) },
}));
jest.mock('../../services/activeSurfaceRegistry', () => ({ getActiveSurface: () => 'caddie' }));

import { speak } from '../../services/voiceService';
import { useSettingsStore } from '../../store/settingsStore';
import { __resetOfflineVoiceCache } from '../../services/offlineVoiceCache';
import { CADDIE_NOTICE_CONNECTION } from '../../services/caddieAckLines';

const voiceBodies: Array<{ persona?: string; gender?: string }> = [];

beforeEach(() => {
  __resetOfflineVoiceCache();
  mockPlayed.length = 0;
  voiceBodies.length = 0;
  mockExists.fn = () => false;
  // Kevin is the global pick; Serena owns the Round pillar — the caddie the brain speaks as here.
  useSettingsStore.setState({
    caddiePersonality: 'kevin',
    voiceGender: 'male',
    caddieAssignments: { round: 'serena', practice: 'kevin', drills: 'kevin', play: 'kevin' },
    voiceEnabled: true,
  } as never);
  global.fetch = jest.fn((url: string, init?: { body?: string }) => {
    if (String(url).includes('/api/voice')) {
      try { voiceBodies.push(JSON.parse(String(init?.body ?? '{}'))); } catch { /* not json */ }
    }
    return Promise.reject(new TypeError('Network request failed'));
  }) as unknown as typeof fetch;
});

describe('the voice is the caddie the brain spoke as', () => {
  it('speak() asks /api/voice for the ACTIVE caddie (Serena), in her voice', async () => {
    await speak('Smooth eight iron, aim center.', 'male', 'en', 'http://localhost:9', { userInitiated: true });
    expect(voiceBodies.length).toBeGreaterThan(0);
    expect(voiceBodies[0].persona).toBe('serena');
    expect(voiceBodies[0].gender).toBe('female');
  }, 20_000);

  it("offline, the ACTIVE caddie's recording plays — not the global pick's", async () => {
    mockExists.fn = (n) => n.startsWith('offline_voice_serena_female_notice_connection_en_')
      || n.startsWith('offline_voice_kevin_male_notice_connection_en_');
    await speak(CADDIE_NOTICE_CONNECTION.en, 'male', 'en', 'http://localhost:9', { userInitiated: true });
    expect(mockPlayed.some((u) => /offline_voice_serena_female_notice_connection_en_/.test(u))).toBe(true);
    expect(mockPlayed.some((u) => /offline_voice_kevin_male_/.test(u))).toBe(false);
  }, 20_000);
});
