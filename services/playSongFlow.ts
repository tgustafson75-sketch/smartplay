/**
 * 2026-06-13 — "play [song]" flow (clean music portal, Tim/Cecily).
 *
 * Detects a play-a-song request, searches the kid-safe server endpoint
 * (services/songPortal), and opens JUST that song in the clean in-app player
 * (app/jukebox) via the imperative router. Returns a spoken line so the caddie
 * confirms it ("Pulling up X 🎵") or honestly says it couldn't find it.
 *
 * Narrow detection: "play"/"put on" as the request verb, with golf "play" phrases
 * (play a round / play golf / play it safe / play through …) explicitly excluded so it
 * never hijacks on-course chatter. Distinct from singAttempt (caddie performs).
 */

import { router } from 'expo-router';
import { searchSong } from './songPortal';
import { detectPlaySongRequest } from './musicIntent';

export { detectPlaySongRequest };

/**
 * If `raw` is a play-song request, search + open the clean player and return the
 * spoken confirmation. Returns null when it isn't a play request (caller continues
 * to the brain). Best-effort: honest line when no match / search fails.
 */
export async function tryPlaySong(raw: string): Promise<{ spoken: string } | null> {
  const req = detectPlaySongRequest(raw);
  if (!req) return null;
  const match = await searchSong(req.query);
  if (!match) {
    return { spoken: `I couldn't find "${req.query}" — try it again with the artist's name too.` };
  }
  try {
    router.push(
      `/jukebox?videoId=${encodeURIComponent(match.videoId)}&title=${encodeURIComponent(match.title)}` as never,
    );
  } catch { /* navigation best-effort; the spoken line still confirms */ }
  return { spoken: `Pulling up ${match.title}. 🎵` };
}
