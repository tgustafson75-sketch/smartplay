/**
 * 2026-06-13 — Song portal (clean in-app music for Tim/Cecily).
 *
 * "play [song]" → this searches YouTube via our SERVER endpoint (kid-safe
 * safeSearch=strict, embeddable only, key stays server-side) and returns the single
 * best match. The caller opens just that video in the clean embedded player
 * (app/jukebox) — no comments, no suggestions, never leaves the app.
 *
 * Spine-safe (getApiBaseUrl). Returns null only when YouTube has no such song; a failure to ask
 * throws SongSearchUnavailable (below) so the caddie never blames the title for the connection.
 * Distinct from singAttempt (the caddie performing). See memory: youtube-song-portal.
 */

import { getApiBaseUrl } from './apiBase';

export interface SongMatch {
  videoId: string;
  title: string;
  channelTitle: string | null;
}

/**
 * 2026-10-28 (Brain review r3) — "no such song" and "could not ask" are different answers. Both came
 * back as null, so offline, every request was answered 'I couldn't find "<song>" — try it again with
 * the artist's name too', which blames the title for a dead connection. A real no-match is still
 * null; anything else throws this, and the caller hands the turn to the one failure owner.
 *
 * `reachedServer` separates the two failures: false = the request never got an answer (the offline
 * case — the brain turn's failure path knows how to say that), true = something answered but it was
 * not a search result (rate limit, not configured, quota, upstream error, a captive portal's page).
 */
export class SongSearchUnavailable extends Error {
  constructor(readonly reachedServer: boolean, readonly reason: string) {
    super(`song search unavailable: ${reason}`);
    this.name = 'SongSearchUnavailable';
  }
}

export async function searchSong(query: string): Promise<SongMatch | null> {
  const q = (query ?? '').trim();
  if (!q) return null;
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/youtube-search?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new SongSearchUnavailable(false, e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) throw new SongSearchUnavailable(true, `http_${res.status}`);
  let data: { videoId?: string | null; title?: string; channelTitle?: string | null; reason?: string };
  try {
    data = (await res.json()) as typeof data;
  } catch {
    throw new SongSearchUnavailable(true, 'bad_json');
  }
  if (!data.videoId) {
    // api/youtube-search says why: only 'no_match' means the song is not there.
    if (data.reason && data.reason !== 'no_match') throw new SongSearchUnavailable(true, data.reason);
    return null;
  }
  return {
    videoId: data.videoId,
    title: typeof data.title === 'string' ? data.title : q,
    channelTitle: data.channelTitle ?? null,
  };
}
