/**
 * 2026-08-25 — THE CACHE MUST NEVER HAND OUT THE FILE IT IS KEEPING.
 *
 * Several analysis paths (ballDeparture, clubPath, ballPath) DELETE the frame they were given once
 * they are done with it. The frame cache therefore keeps the decoded original and hands every caller
 * a COPY — if it ever returned the original, the first consumer's cleanup would silently empty the
 * cache, and worse, a later caller could receive a uri whose file no longer exists.
 *
 * The shared expo-file-system stub answers getInfoAsync with {exists:false}, so the cache can never
 * hit under it — which is exactly why this property went uncovered when the cache shipped. This test
 * supplies a real in-memory filesystem so the hit path actually executes.
 */
const files = new Map<string, string>();
let decodes = 0;

jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: '/tmp/',
  documentDirectory: '/tmp/',
  getInfoAsync: async (uri: string) => ({ exists: files.has(uri), uri }),
  copyAsync: async ({ from, to }: { from: string; to: string }) => {
    if (!files.has(from)) throw new Error(`copy from missing file: ${from}`);
    files.set(to, files.get(from)!);
  },
  deleteAsync: async (uri: string) => { files.delete(uri); },
  EncodingType: { Base64: 'base64', UTF8: 'utf8' },
}));

jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: async () => {
    decodes++;
    const uri = `file:///decoded-${decodes}.jpg`;
    files.set(uri, `pixels-${decodes}`);
    return { uri, width: 1920, height: 1080 };
  },
}));

import { getThumbnailAsync, _clearThumbnailCache, _resetThumbnailCacheStats } from '../../utils/videoThumbnail';

const at = (time: number) => getThumbnailAsync('file:///swing.mp4', { time, quality: 0.6 } as never);

describe('the frame cache survives consumers that delete their frames', () => {
  beforeEach(() => { files.clear(); decodes = 0; _clearThumbnailCache(); _resetThumbnailCacheStats(); });

  it('serves a repeat request from cache without decoding again', async () => {
    const a = await at(1000);
    const b = await at(1000);
    expect(decodes).toBe(1);
    // Both callers got real, existing files...
    expect(files.has(a.uri)).toBe(true);
    expect(files.has(b.uri)).toBe(true);
    // ...and NOT the same file, so one caller's cleanup cannot affect the other.
    expect(a.uri).not.toBe(b.uri);
  });

  it('a consumer deleting its frame does not empty the cache for the next caller', async () => {
    const first = await at(1000);
    // ballDeparture/clubPath/ballPath all do exactly this when they are finished.
    files.delete(first.uri);

    const second = await at(1000);
    expect(files.has(second.uri)).toBe(true);   // still usable
    expect(decodes).toBe(1);                     // and it did NOT have to decode again

    // THE SHARP EDGE — this is the case a weaker version of this test missed. Deleting the frame
    // returned by a CACHE HIT must be just as safe as deleting one returned by a miss. If the hit
    // path ever hands back the retained original instead of a copy, this delete destroys the cache
    // entry and the third caller pays for a fresh decode.
    files.delete(second.uri);
    const third = await at(1000);
    expect(files.has(third.uri)).toBe(true);
    expect(decodes).toBe(1);
  });

  it('re-decodes honestly if the kept original itself vanishes', async () => {
    const first = await at(1000);
    // Simulate the OS clearing the cache directory out from under us.
    files.clear();
    void first;

    const second = await at(1000);
    expect(decodes).toBe(2);                     // no stale uri handed back
    expect(files.has(second.uri)).toBe(true);
  });
});
