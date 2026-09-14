/**
 * 2026-09-13 (Tim: "Finish all no device test items") — COVERAGE FOR THE THIRD OF THREE UNGUARDED
 * INTENT HANDLERS.
 *
 * docs/audit-unguarded-inventory.md flagged `services/intents/*Handler.ts` as the place to start among
 * 91 unguarded logic files, because every one of them is a thing a player can SAY — so an untested
 * handler is an untested sentence out of the caddie's mouth. Two of the three had real defects:
 * `handicapQueryHandler` passed a hole number where WHS wants a stroke index, and
 * `confirmPositionHandler` read the hole number as the yardage. Both are fixed and guarded separately.
 *
 * `openExternalHandler` had none, and saying so plainly is the point of an audit — the query is properly
 * `encodeURIComponent`-ed, every service in the union is handled, an unrecognised service falls back
 * rather than throwing, and both failure paths return success:false with an honest line instead of
 * pretending the app opened something. This locks that in rather than reporting a defect that is not
 * there.
 */
import { openExternalHandler } from '../../services/intents/openExternalHandler';
import { Linking } from 'react-native';
import type { VoiceIntent } from '../../types/voiceIntent';

const run = (parameters: Record<string, unknown>) =>
  openExternalHandler.execute(
    { intent_type: 'open_external', raw_text: '', parameters } as unknown as VoiceIntent,
    {} as never,
  );

let opened: string[] = [];
beforeEach(() => {
  opened = [];
  jest.spyOn(Linking, 'openURL').mockImplementation(async (url: string) => { opened.push(url); return true; });
});
afterEach(() => { jest.restoreAllMocks(); });

describe('the music request opens the right service', () => {
  it.each([
    ['youtube', 'https://www.youtube.com/'],
    ['youtube_music', 'https://music.youtube.com/'],
    ['spotify', 'https://open.spotify.com/'],
    ['apple_music', 'https://music.apple.com/'],
  ])('%s with no query opens its home', async (service, expected) => {
    const res = await run({ service });
    expect(res.success).toBe(true);
    expect(opened).toEqual([expected]);
  });

  it('an unrecognised service falls back rather than throwing', async () => {
    const res = await run({ service: 'winamp' });
    expect(res.success).toBe(true);
    expect(opened[0]).toContain('music.youtube.com');
  });

  it('a spoken alias resolves — "yt music", "applemusic", "music"', async () => {
    for (const [alias, host] of [['yt music', 'music.youtube.com'], ['applemusic', 'music.apple.com'], ['music', 'music.apple.com']] as const) {
      opened = [];
      await run({ service: alias });
      expect(opened[0]).toContain(host);
    }
  });
});

describe('a query never breaks the URL', () => {
  it('is percent-encoded, so an ampersand cannot truncate it', async () => {
    await run({ service: 'youtube', query: 'AC/DC & friends #1' });
    expect(opened[0]).toContain(encodeURIComponent('AC/DC & friends #1'));
    // the raw characters must not survive into the query string
    expect(opened[0]).not.toMatch(/search_query=.*[&#]/);
  });

  it('a whitespace-only query is treated as no query', async () => {
    await run({ service: 'spotify', query: '   ' });
    expect(opened).toEqual(['https://open.spotify.com/']);
  });

  it('the spoken confirmation names the service and tells the player how to get back', async () => {
    const res = await run({ service: 'spotify', query: 'Zeppelin' });
    expect(res.voice_response).toMatch(/Spotify/);
    expect(res.voice_response).toMatch(/stop/i);
  });
});

describe('a golf-instruction ask beats the music service', () => {
  it('a curated video wins over whatever the classifier guessed', async () => {
    const res = await run({ service: 'spotify', query: 'how to stop slicing my driver' });
    // Either a curated video or a focused golf search — never Spotify.
    expect(opened[0]).not.toContain('spotify');
    expect(res.success).toBe(true);
  });
});

describe('a failure is reported, never swallowed', () => {
  it('a refused open returns success:false and says so', async () => {
    jest.spyOn(Linking, 'openURL').mockImplementation(async () => { throw new Error('no handler'); });
    const res = await run({ service: 'youtube' });
    expect(res.success).toBe(false);
    expect(res.voice_response).toMatch(/Couldn't open YouTube/);
    expect(res.side_effects).toContain('open_external:failed:youtube');
  });

  it('and it does not claim to be playing anything', async () => {
    jest.spyOn(Linking, 'openURL').mockImplementation(async () => { throw new Error('no handler'); });
    const res = await run({ service: 'spotify', query: 'Zeppelin' });
    expect(res.voice_response).not.toMatch(/Playing/i);
  });
});
