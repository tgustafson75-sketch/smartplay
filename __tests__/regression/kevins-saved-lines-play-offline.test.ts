/**
 * 2026-10-15 (offline audit) — ~46 fixed lines are recorded in the caddie's real voice on every phone,
 * and offline they were still silent:
 *   1. speak()'s failure branches went straight to deviceSpeakFallback, which never looked at the
 *      recordings — so "I'm having trouble connecting" stayed mute with its clip on disk;
 *   2. a recording only counted once the warm pass registered it, and that pass runs 45s+ after a
 *      warmup — so a phone reopened on the course with no signal had nothing registered.
 * The no-robot-voice rule is untouched: a line with no recording is still silent.
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
    // The player detaches its listener with null on finish; only a real listener is called back.
    setOnPlaybackStatusUpdate: (cb: ((s: unknown) => void) | null) => { if (cb) setTimeout(() => cb({ isLoaded: true, didJustFinish: true, durationMillis: 800 }), 0); },
  };
  const Sound = { createAsync: async (src: { uri?: string } | number) => {
    mockPlayed.push(typeof src === 'object' && src ? String(src.uri) : String(src));
    return { sound, status: { isLoaded: true, durationMillis: 800 } };
  } };
  const Audio = new Proxy(base.Audio, { get: (t, prop) => (prop === 'Sound' ? Sound : t[prop]) });
  return new Proxy(base, { get: (t, prop) => (prop === 'Audio' ? Audio : t[prop]) });
});
const mockEvents: { stage: string }[] = [];
jest.mock('../../store/issueLogStore', () => ({
  useIssueLogStore: { getState: () => ({ addAppEvent: (stage: string) => mockEvents.push({ stage }) }) },
}));

import { resolveCachedOfflineClipUri, __resetOfflineVoiceCache, OFFLINE_LINES } from '../../services/offlineVoiceCache';
import { speak } from '../../services/voiceService';
import { CADDIE_NOTICE_CONNECTION } from '../../services/caddieAckLines';
// Loaded loosely so the pre-fix code fails on behaviour, not on a missing export.
const FIXED_OFFLINE_REPLIES_EN: { slug: string; text: string }[] =
  (require('../../services/localStatusResponder') as Record<string, unknown>).FIXED_OFFLINE_REPLIES_EN as { slug: string; text: string }[] ?? [];

const CONNECTION = CADDIE_NOTICE_CONNECTION.en;

beforeEach(() => {
  __resetOfflineVoiceCache();
  mockEvents.length = 0;
  mockPlayed.length = 0;
  mockExists.fn = () => false;
  global.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed'))) as unknown as typeof fetch;
});

describe("Kevin's recorded lines offline", () => {
  it('THE BUG: a recording on disk is found after a cold start, with no warm pass', () => {
    mockExists.fn = (n) => n.startsWith('offline_voice_kevin_male_notice_connection_en_');
    expect(resolveCachedOfflineClipUri(CONNECTION, 'male', 'kevin')).toMatch(/notice_connection_en/);
  });

  it('THE BUG: when the cloud voice fails, speak() plays the recording instead of going silent', async () => {
    mockExists.fn = (n) => n.startsWith('offline_voice_kevin_male_notice_connection_en_');
    await speak(CONNECTION, 'male', 'en', 'http://localhost:9', { userInitiated: true });
    expect(mockPlayed.some((u) => /offline_voice_kevin_male_notice_connection_en_/.test(u))).toBe(true);
    expect(mockEvents.map((e) => e.stage)).not.toContain('voice_device_tts_suppressed');
  }, 20_000);

  it('a line with NO recording stays silent — the device voice never speaks', async () => {
    await speak('152 yards to the middle of the green.', 'male', 'en', 'http://localhost:9', { userInitiated: true });
    expect(mockPlayed).toEqual([]);
    expect(mockEvents.map((e) => e.stage)).toContain('voice_device_tts_suppressed');
  }, 20_000);

  it('the honest-failure notices and the fixed offline replies are recorded', () => {
    const texts = new Set(OFFLINE_LINES.map((l) => l.text));
    expect(texts.has(CONNECTION)).toBe(true);
    expect(FIXED_OFFLINE_REPLIES_EN.length).toBeGreaterThanOrEqual(10);
    for (const r of FIXED_OFFLINE_REPLIES_EN) expect(texts.has(r.text)).toBe(true);
    expect(FIXED_OFFLINE_REPLIES_EN.map((r) => r.text)).toContain('No GPS lock yet — give it a few seconds and try again.');
  });

  it('every recording has a unique slug (a duplicate would overwrite a different line)', () => {
    const slugs = OFFLINE_LINES.map((l) => `${l.language}:${l.slug}`);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});
