/**
 * 2026-08-25 (Tim — "I've actually never waited for the analysis… everything needs to be as
 * streamlined as possible").
 *
 * Seven analysis paths pull frames from the same clip and several ask for the same instant, because
 * they are all anchored on the same impact. Every one was a fresh native decode, and decodes are
 * serialized app-wide (the MediaMetadataRetriever crash guard), so each redundant one is wall-clock
 * the player waits through.
 *
 * The bucketing is the part worth pinning: two requests a few milliseconds apart on a 30fps video
 * resolve to the SAME physical frame, so they must share a decode — and two genuinely different
 * frames, or two different qualities, must not.
 */
import { thumbnailCacheKey } from '../../utils/videoThumbnail';

const K = (uri: string, time?: number, quality?: number) =>
  thumbnailCacheKey(uri, { time, quality } as never);

describe('one decode per physical frame', () => {
  it('two requests inside the same 30fps frame share a decode', () => {
    // 990 and 1000 both fall in bucket 30 (33ms wide) — the same physical frame, one decode.
    expect(K('a.mp4', 990, 0.6)).toBe(K('a.mp4', 1000, 0.6));
  });

  it('near a bucket boundary they may still decode twice — and that is fine', () => {
    /**
     * Bucketing cannot make two times either side of a boundary agree, and chasing that would mean
     * a fuzzy nearest-match cache that could hand back the WRONG frame. The failure mode here is
     * simply today's behaviour — one extra decode — never a wrong image. Documented rather than
     * papered over: my first version of this test asserted the impossible.
     */
    expect(K('a.mp4', 1000, 0.6)).not.toBe(K('a.mp4', 1030, 0.6));
  });

  it('genuinely different frames do NOT share a decode', () => {
    expect(K('a.mp4', 1000, 0.6)).not.toBe(K('a.mp4', 1200, 0.6));
  });

  it('different quality is a different decode — a 0.3 crop is not a 0.8 read', () => {
    expect(K('a.mp4', 1000, 0.3)).not.toBe(K('a.mp4', 1000, 0.8));
  });

  it('different clips never collide', () => {
    expect(K('a.mp4', 1000, 0.6)).not.toBe(K('b.mp4', 1000, 0.6));
  });

  it('a request with no time is keyed separately, not folded onto frame zero', () => {
    expect(K('a.mp4', undefined, 0.6)).not.toBe(K('a.mp4', 0, 0.6));
  });

  it('handles junk without throwing or collapsing everything to one key', () => {
    expect(K('a.mp4', NaN, 0.6)).not.toBe(K('a.mp4', 1000, 0.6));
    expect(() => K('a.mp4')).not.toThrow();
  });
});
