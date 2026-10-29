/**
 * 2026-10-28 (recheck VC-2) — ONE TURN, TWO VOICES.
 *
 * A custom caddie speaks its replies in its photo-matched or hand-picked voice (customCaddieVoice),
 * else its base persona's (Harry → fable): voiceService.speak sends that as `voice`. The pre-rendered
 * clips around the reply — the listening cue/opener, the got-it cue, acks, "Didn't catch that", the
 * mic-trouble lines, the offline notices — came from offlineVoiceCache.ensureOfflineClipsCached, which
 * POSTed {text, gender, language, persona} and NO voice. api/voice has no 'custom' persona entry, so
 * it fell to the gender default: "Yeah?" in Kevin's onyx, the answer in sage, the failure line back in
 * onyx. The cache key left the voice out too, so re-matching the voice never re-rendered anything.
 *
 * Behavioural: the real warm runs against a recording fetch and an in-memory file system.
 */
const mockDisk = new Map<string, number>();
// One factory for both specifiers: the logic project's moduleNameMapper sends 'expo-file-system' and
// 'expo-file-system/legacy' to the same stub file, so a second jest.mock would replace the first.
jest.mock('expo-file-system', () => {
  class File {
    name: string;
    uri: string;
    constructor(_dir: unknown, name: string) { this.name = name; this.uri = `file:///cache/${name}`; }
    get exists() { return mockDisk.has(this.name); }
    get size() { return mockDisk.get(this.name) ?? 0; }
    write(bytes: Uint8Array) { mockDisk.set(this.name, bytes.byteLength); }
  }
  return {
    File,
    Paths: { cache: '/cache' },
    cacheDirectory: '/cache/',
    readDirectoryAsync: async () => [...mockDisk.keys()],
    deleteAsync: async (p: string) => { mockDisk.delete(p.replace('/cache/', '')); },
  };
});
jest.mock('../../services/apiBase', () => ({ getApiBaseUrl: () => 'http://localhost:9' }));

type Cache = typeof import('../../services/offlineVoiceCache');
type Profile = typeof import('../../store/playerProfileStore');

jest.setTimeout(120_000);

let bodies: Array<Record<string, unknown>> = [];
let cache: Cache;
let profile: Profile['usePlayerProfileStore'];

beforeEach(() => {
  jest.resetModules();
  mockDisk.clear();
  bodies = [];
  (global as { fetch?: unknown }).fetch = jest.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(2000) };
  });
  cache = require('../../services/offlineVoiceCache') as Cache;
  profile = (require('../../store/playerProfileStore') as Profile).usePlayerProfileStore;
  profile.setState({ customCaddieVoice: null, customCaddieBasePersona: 'kevin' });
});

describe('the cached cues speak in the voice the replies use', () => {
  it('THE BUG: a photo-matched custom caddie\'s clips are rendered in ITS voice, every one', async () => {
    profile.setState({ customCaddieVoice: 'sage' });
    await cache.ensureOfflineClipsCached('male', 'custom');
    expect(bodies.length).toBe(cache.OFFLINE_LINES.length);
    expect(new Set(bodies.map((b) => b.voice))).toEqual(new Set(['sage']));
  });

  it('a Harry-based custom caddie with no match uses fable, as speak() does — not the onyx default', async () => {
    profile.setState({ customCaddieBasePersona: 'harry' });
    await cache.ensureOfflineClipsCached('male', 'custom');
    expect(new Set(bodies.map((b) => b.voice))).toEqual(new Set(['fable']));
  });

  it('speak() and the warm ask the SAME owner', () => {
    const { ttsVoiceForPersona } = require('../../services/caddieGender') as typeof import('../../services/caddieGender');
    profile.setState({ customCaddieVoice: 'ash' });
    expect(ttsVoiceForPersona('custom')).toBe('ash');
    profile.setState({ customCaddieVoice: null, customCaddieBasePersona: 'serena' });
    expect(ttsVoiceForPersona('custom')).toBe('nova');
    // Built-ins send nothing: the server's persona map owns their voice.
    expect(ttsVoiceForPersona('kevin')).toBeNull();
    const fs = require('fs') as typeof import('fs');
    const path = require('path') as typeof import('path');
    const voice = fs.readFileSync(path.resolve(__dirname, '../../services/voiceService.ts'), 'utf-8');
    expect(voice).toContain('customVoice = cg.ttsVoiceForPersona(persona);');
  });

  it('a built-in persona\'s clips are unchanged — no voice sent, same filenames as before', async () => {
    await cache.ensureOfflineClipsCached('male', 'kevin');
    expect(new Set(bodies.map((b) => b.voice ?? null))).toEqual(new Set([null]));
    for (const name of mockDisk.keys()) expect(name).toMatch(/^offline_voice_kevin_male_[a-z0-9_]+\.mp3$/);
    for (const name of mockDisk.keys()) expect(name).not.toMatch(/_male_v(alloy|ash|coral|echo|fable|nova|onyx|sage|shimmer|verse)_/);
  });

  it('re-matching the voice is a new clip, not a replay of the old voice', async () => {
    profile.setState({ customCaddieVoice: 'sage' });
    await cache.ensureOfflineClipsCached('male', 'custom');
    const line = cache.OFFLINE_LINES[0];
    const sageUri = cache.resolveCachedOfflineClipUri(line.text, 'male', 'custom');
    expect(sageUri).toMatch(/_vsage_/);

    profile.setState({ customCaddieVoice: 'ash' });
    // Before the re-warm, the sage clip must NOT answer for the ash caddie.
    expect(cache.resolveCachedOfflineClipUri(line.text, 'male', 'custom')).toBeNull();
    bodies = [];
    await cache.ensureOfflineClipsCached('male', 'custom');
    expect(bodies.length).toBe(cache.OFFLINE_LINES.length);
    expect(new Set(bodies.map((b) => b.voice))).toEqual(new Set(['ash']));
    expect(cache.resolveCachedOfflineClipUri(line.text, 'male', 'custom')).toMatch(/_vash_/);
    // and the superseded sage clips are swept off disk
    for (const name of mockDisk.keys()) expect(name).not.toMatch(/_vsage_/);
  });

  it('changing the custom voice or base persona re-warms the clips', () => {
    const vs = require('../../services/voiceService') as { prewarmOfflineVoiceClips: () => Promise<void> };
    const spy = jest.spyOn(vs, 'prewarmOfflineVoiceClips').mockImplementation(async () => undefined);
    profile.getState().setCustomCaddieVoice('coral');
    profile.getState().setCustomCaddieBasePersona('harry');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
