/**
 * 2026-06-13 — Song portal (clean in-app music for Tim/Cecily).
 *
 * "play [song]" → this searches YouTube via our SERVER endpoint (kid-safe
 * safeSearch=strict, embeddable only, key stays server-side) and returns the single
 * best match. The caller opens just that video in the clean embedded player
 * (app/jukebox) — no comments, no suggestions, never leaves the app.
 *
 * Spine-safe (getApiBaseUrl), best-effort: returns null on any failure so the caddie
 * can say "couldn't find that one" instead of going silent. Distinct from singAttempt
 * (the caddie performing). See memory: youtube-song-portal.
 */

import { getApiBaseUrl } from './apiBase';

export interface SongMatch {
  videoId: string;
  title: string;
  channelTitle: string | null;
}

export async function searchSong(query: string): Promise<SongMatch | null> {
  const q = (query ?? '').trim();
  if (!q) return null;
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/youtube-search?q=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { videoId?: string | null; title?: string; channelTitle?: string | null };
    if (!data.videoId) return null;
    return {
      videoId: data.videoId,
      title: typeof data.title === 'string' ? data.title : q,
      channelTitle: data.channelTitle ?? null,
    };
  } catch {
    return null;
  }
}
